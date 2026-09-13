"""Emma voice backend using LiveKit. Run with .venv/bin/python server.py."""

import asyncio
import os
import secrets
import sys
import warnings
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from livekit import api as livekit_api
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsHttpTTSService
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
LEGACY_REASONING_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
FAST_DIALOGUE_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"

# Render's shared parent directory triggers this warning even though the app
# only loads Pipecat's packaged local model data.
warnings.filterwarnings(
    "ignore",
    message="NLTK will not authorize the non-private download directory.*",
    category=UserWarning,
    module="nltk.downloader",
)


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


def create_worker(
    room_name: str,
    bot_token: str,
    http_session: aiohttp.ClientSession,
):
    configured_model = os.environ["NVIDIA_MODEL"].strip()
    dialogue_model = (
        FAST_DIALOGUE_MODEL
        if configured_model == LEGACY_REASONING_MODEL
        else configured_model
    )
    transport = LiveKitTransport(
        url=os.environ["LIVEKIT_URL"].strip(),
        token=bot_token,
        room_name=room_name,
        params=LiveKitParams(
            audio_in_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_enabled=True,
            audio_out_sample_rate=24000,
            audio_out_10ms_chunks=10,
        ),
    )
    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        settings=DeepgramSTTService.Settings(
            model="nova-3-general",
            language="en-US",
            interim_results=True,
            endpointing=300,
            utterance_end_ms=1000,
            punctuate=True,
            smart_format=True,
        ),
    )
    llm = NvidiaLLMService(
        api_key=os.environ["NVIDIA_API_KEY"],
        settings=NvidiaLLMService.Settings(
            model=dialogue_model,
            system_instruction=(ROOT / "emma-prompt.txt").read_text()
            + "\nUse short spoken turns, without markdown or emojis.",
            max_tokens=160,
            temperature=1.0,
            top_k=1,
            extra={"chat_template_kwargs": {"enable_thinking": False}},
        ),
    )
    tts = ElevenLabsHttpTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        aiohttp_session=http_session,
        settings=ElevenLabsHttpTTSService.Settings(
            voice=os.environ["ELEVENLABS_VOICE_ID"].strip(),
            model="eleven_flash_v2_5",
            optimize_streaming_latency=3,
        ),
    )
    context = LLMContext()
    user, assistant = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(
                confidence=0.65,
                start_secs=0.15,
                stop_secs=0.2,
                min_volume=0.5,
            )),
            audio_idle_timeout=3.0,
            user_turn_stop_timeout=1.5,
        ),
    )
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
        await worker.queue_frames([
            TTSSpeakFrame("Hi, I'm Emma. I'm here with you. What's on your mind?")
        ])

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


async def run_session_worker(room_name: str, bot_token: str):
    """Initialize providers outside the session-token request path."""
    try:
        async with aiohttp.ClientSession() as http_session:
            run = create_worker(room_name, bot_token, http_session)
            await run()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Voice worker failed to initialize; check provider configuration.")


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
    if any(not task.done() for task in tasks):
        raise HTTPException(
            409,
            "A voice session is already open. Wait for it to close, then try again.",
        )

    session_id = secrets.token_urlsafe(12)
    room_name = f"emma-{session_id}"
    user_token = make_livekit_token(room_name, f"user-{session_id}", "Emma user")
    bot_token = make_livekit_token(room_name, f"emma-{session_id}", "Emma")
    task = asyncio.create_task(run_session_worker(room_name, bot_token))
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
