"""Emma voice backend using LiveKit. Run with .venv/bin/python server.py."""

import asyncio
import os
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from livekit import api as livekit_api
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.nvidia.llm import NvidiaLLMService
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport
from pipecat.workers.runner import WorkerRunner

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
# Avoid debug-level provider messages and conversation text in local logs.
logger.remove()
logger.add(sys.stderr, level="WARNING")
REQUIRED = (
    "NVIDIA_API_KEY", "NVIDIA_MODEL", "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID",
    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
)
ORIGINS = [value.strip() for value in os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",") if value.strip()]
tasks: set[asyncio.Task] = set()


def missing_settings():
    return [key for key in REQUIRED if not os.getenv(key, "").strip()]


def make_livekit_token(room_name: str, identity: str, name: str) -> str:
    return (
        livekit_api.AccessToken(
            os.environ["LIVEKIT_API_KEY"],
            os.environ["LIVEKIT_API_SECRET"],
        )
        .with_identity(identity)
        .with_name(name)
        .with_ttl(timedelta(minutes=30))
        .with_grants(livekit_api.VideoGrants(room_join=True, room=room_name))
        .to_jwt()
    )


def create_worker(room_name: str, bot_token: str):
    transport = LiveKitTransport(
        url=os.environ["LIVEKIT_URL"].strip(),
        token=bot_token,
        room_name=room_name,
        params=LiveKitParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )
    stt = DeepgramFluxSTTService(api_key=os.environ["DEEPGRAM_API_KEY"])
    llm = NvidiaLLMService(
        api_key=os.environ["NVIDIA_API_KEY"],
        settings=NvidiaLLMService.Settings(
            model=os.environ["NVIDIA_MODEL"].strip(),
            system_instruction=(ROOT / "emma-prompt.txt").read_text()
            + "\nUse short spoken turns, without markdown or emojis.",
        ),
    )
    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=os.environ["ELEVENLABS_VOICE_ID"].strip(),
            model="eleven_flash_v2_5",
        ),
    )
    context = LLMContext()
    user, assistant = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(
        vad_analyzer=SileroVADAnalyzer(),
    ))
    worker = PipelineWorker(
        Pipeline([transport.input(), stt, user, llm, tts, transport.output(), assistant]),
        params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=24000),
        idle_timeout_secs=120,
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )
    runner = WorkerRunner(handle_sigint=False)

    introduced = False

    @transport.event_handler("on_first_participant_joined")
    async def first_participant_joined(transport, participant_id):
        nonlocal introduced
        if introduced:
            return
        introduced = True
        context.add_message({"role": "user", "content": "Please introduce yourself briefly."})
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_participant_disconnected")
    async def disconnected(transport, participant_id):
        await runner.cancel()

    async def run():
        try:
            await runner.add_workers(worker)
            # Bound abandoned sessions even if transport disconnect is lost.
            await asyncio.wait_for(runner.run(), timeout=1800)
        except asyncio.TimeoutError:
            await runner.cancel()
        except asyncio.CancelledError:
            await runner.cancel()
            raise
        except Exception:
            # Keep credentials and conversation text out of logs, but retain
            # the provider error so hosted deployments can be diagnosed.
            logger.exception("Voice session failed; check provider configuration and quota.")

    return run


@asynccontextmanager
async def lifespan(app):
    yield
    pending = list(tasks)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.middleware("http")
async def local_browser_only(request: Request, call_next):
    # CORS alone does not reject cross-origin POSTs. Reject before allocating a bot.
    origin = request.headers.get("origin")
    if request.method == "POST" and origin not in ORIGINS:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Local frontend origin required."}, status_code=403)
    return await call_next(request)


@app.get("/health")
async def health():
    missing = missing_settings()
    return {"ready": not missing, "missing": missing}


@app.get("/")
async def root():
    return {
        "service": "Emma Pipecat voice backend",
        "status": "ok",
        "health": "/health",
    }


@app.post("/api/session")
async def create_session():
    if missing := missing_settings():
        raise HTTPException(503, "Configure voice-backend/.env: " + ", ".join(missing))

    session_id = secrets.token_urlsafe(12)
    room_name = f"emma-{session_id}"
    user_token = make_livekit_token(room_name, f"user-{session_id}", "Emma user")
    bot_token = make_livekit_token(room_name, f"emma-{session_id}", "Emma")
    run = create_worker(room_name, bot_token)
    task = asyncio.create_task(run())
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return {
        "url": os.environ["LIVEKIT_URL"].strip(),
        "token": user_token,
        "room_name": room_name,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "7860")),
    )
