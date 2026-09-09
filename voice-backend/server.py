"""Local Emma voice prototype. Run with .venv/bin/python server.py."""

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pydantic import BaseModel, Field

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
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.request_handler import (
    ConnectionMode,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
    SmallWebRTCPatchRequest,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
# Avoid debug-level provider messages and conversation text in local logs.
logger.remove()
logger.add(sys.stderr, level="WARNING")
REQUIRED = (
    "NVIDIA_API_KEY", "NVIDIA_MODEL", "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID",
)
ORIGINS = [value.strip() for value in os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",") if value.strip()]
handler = SmallWebRTCRequestHandler(connection_mode=ConnectionMode.SINGLE)
tasks: set[asyncio.Task] = set()
offer_lock = asyncio.Lock()


def missing_settings():
    return [key for key in REQUIRED if not os.getenv(key, "").strip()]


def create_worker(connection):
    transport = SmallWebRTCTransport(connection, TransportParams(
        audio_in_enabled=True, audio_out_enabled=True,
    ))
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

    @worker.rtvi.event_handler("on_client_ready")
    async def ready(rtvi):
        context.add_message({"role": "user", "content": "Please introduce yourself briefly."})
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def disconnected(transport, client):
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
            logger.warning("Voice session failed; check provider configuration and quota.")
        finally:
            await connection.disconnect()

    return run


@asynccontextmanager
async def lifespan(app):
    yield
    await handler.close()
    pending = list(tasks)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS,
                   allow_methods=["GET", "POST", "PATCH"], allow_headers=["Content-Type"])


@app.middleware("http")
async def local_browser_only(request: Request, call_next):
    # CORS alone does not reject cross-origin POSTs. Reject before allocating a bot.
    origin = request.headers.get("origin")
    if request.method in {"POST", "PATCH"} and origin not in ORIGINS:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Local frontend origin required."}, status_code=403)
    return await call_next(request)


@app.get("/health")
async def health():
    missing = missing_settings()
    return {"ready": not missing, "missing": missing}


class Offer(BaseModel):
    sdp: str = Field(min_length=1, max_length=100_000)
    type: str = Field(pattern="^offer$")
    pc_id: str | None = None
    restart_pc: bool | None = None


@app.post("/api/offer")
async def offer(body: Offer):
    if missing := missing_settings():
        raise HTTPException(503, "Configure voice-backend/.env: " + ", ".join(missing))

    async def connected(connection):
        run = create_worker(connection)
        task = asyncio.create_task(run())
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    async with offer_lock:
        return await handler.handle_web_request(
            SmallWebRTCRequest(**body.model_dump()), connected,
        )


@app.patch("/api/offer")
async def patch_offer(body: SmallWebRTCPatchRequest):
    await handler.handle_patch_request(body)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "7860")),
    )
