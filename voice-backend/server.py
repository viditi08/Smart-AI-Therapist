"""Emma voice backend using LiveKit. Run with .venv/bin/python server.py."""

import audioop
import asyncio
import os
import re
import secrets
import sys
import time
import warnings
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from livekit import api as livekit_api
from livekit import rtc as livekit_rtc
from loguru import logger
from pydantic import BaseModel

# Pipecat opens LiveKit AudioStream at 48 kHz, then resamples to 16 kHz with
# very-high-quality SOXR. On a laptop that starves playback and can feed
# Deepgram near-silent audio. Ask LiveKit for 16 kHz mono instead.
_ORIG_AUDIO_STREAM_INIT = livekit_rtc.AudioStream.__init__


def _audio_stream_init(self, track, *args, **kwargs):
    kwargs.setdefault("sample_rate", 16000)
    kwargs.setdefault("num_channels", 1)
    kwargs.setdefault("frame_size_ms", 20)
    return _ORIG_AUDIO_STREAM_INIT(self, track, *args, **kwargs)


livekit_rtc.AudioStream.__init__ = _audio_stream_init

from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    LLMRunFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.nvidia.llm import NvidiaLLMService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport
from pipecat.turns.user_start import TranscriptionUserTurnStartStrategy
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
# Avoid debug-level provider messages and conversation text in local logs.
logger.remove()
logger.add(sys.stderr, level="INFO")
COMMON_REQUIRED = (
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID",
    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
)
# Kept for tests and backwards-compatible NVIDIA deployments.
REQUIRED = ("NVIDIA_API_KEY", "NVIDIA_MODEL", *COMMON_REQUIRED)
ORIGINS = [value.strip() for value in os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",") if value.strip()]
# Preview and production Vercel URLs share this suffix.
VERCEL_ORIGIN = re.compile(r"^https://([a-z0-9-]+\.)*vercel\.app$")
tasks: set[asyncio.Task] = set()
session_lock = asyncio.Lock()
LEGACY_REASONING_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
FAST_DIALOGUE_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
SILENT_MIC_PEAK = 400
# 20 ms frames, so this is roughly fifteen seconds of listening.
QUIET_MIC_CHUNKS = 750


class EmmaDeepgramSTTService(DeepgramSTTService):
    """Logs whether Deepgram actually accepted audio, without printing speech."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._logged_open = False
        self._logged_missing = False

    async def run_stt(self, audio: bytes):
        if self._connection and not self._logged_open:
            self._logged_open = True
            logger.info("Deepgram is listening.")
        elif not self._connection and not self._logged_missing:
            self._logged_missing = True
            logger.warning("Deepgram is not connected; spoken audio cannot be transcribed yet.")
        async for frame in super().run_stt(audio):
            yield frame


class MicAudioProbe(FrameProcessor):
    """Downmix stereo LiveKit audio and confirm the mic is actually reaching STT."""

    def __init__(self):
        super().__init__()
        self._chunks = 0
        self._peak = 0
        self._logged_audio = False
        self._logged_speech = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        outgoing = frame
        if (
            direction == FrameDirection.DOWNSTREAM
            and isinstance(frame, InputAudioRawFrame)
            and frame.audio
        ):
            if frame.num_channels > 1:
                try:
                    frame.audio = audioop.tomono(frame.audio, 2, 0.5, 0.5)
                    frame.num_channels = 1
                except Exception:
                    pass
            outgoing = frame
            self._chunks += 1
            self._peak = max(self._peak, audioop.max(outgoing.audio, 2))
            if not self._logged_audio and self._peak >= SILENT_MIC_PEAK:
                self._logged_audio = True
                logger.info("Microphone audio is reaching Emma (peak {}).", self._peak)
            elif not self._logged_audio and self._chunks >= QUIET_MIC_CHUNKS:
                self._logged_audio = True
                logger.warning(
                    "Microphone audio stayed nearly silent (peak {}). "
                    "Allow the mic, use headphones, and close extra talk tabs.",
                    self._peak,
                )
        elif (
            isinstance(frame, TranscriptionFrame)
            and frame.text.strip()
            and not self._logged_speech
        ):
            self._logged_speech = True
            logger.info("Deepgram heard the user.")
        await self.push_frame(outgoing, direction)


class ReplyLatencyProbe(FrameProcessor):
    """Reports provider latency after a finalized user turn."""

    def __init__(self):
        super().__init__()
        self._turn_ended_at: float | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStoppedSpeakingFrame):
            self._turn_ended_at = time.monotonic()
        elif isinstance(frame, TTSAudioRawFrame) and self._turn_ended_at is not None:
            now = time.monotonic()
            logger.info("Provider reply latency {:.2f}s.", now - self._turn_ended_at)
            self._turn_ended_at = None
        await self.push_frame(frame, direction)


class TranscriptProbe(FrameProcessor):
    """Confirm finalized speech reaches turn detection without logging its text."""

    def __init__(self):
        super().__init__()
        self._count = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            self._count += 1
            logger.info("Deepgram finalized transcript #{}.", self._count)
        await self.push_frame(frame, direction)

# Render's shared parent directory triggers this warning even though the app
# only loads Pipecat's packaged local model data.
warnings.filterwarnings(
    "ignore",
    message="NLTK will not authorize the non-private download directory.*",
    category=UserWarning,
    module="nltk.downloader",
)


def missing_settings():
    required = list(COMMON_REQUIRED)
    provider = llm_provider()
    if provider == "groq":
        required.append("GROQ_API_KEY")
    elif provider == "nvidia":
        required.extend(("NVIDIA_API_KEY", "NVIDIA_MODEL"))
    else:
        return ["LLM_PROVIDER (use groq or nvidia)"]
    return [key for key in required if not os.getenv(key, "").strip()]


class SessionRequest(BaseModel):
    user_name: str | None = None


def normalize_person_name(value: str | None) -> str | None:
    if not value:
        return None
    name = " ".join(value.split()).strip()
    return name[:60] or None


def introduction_prompt_for(user_name: str | None) -> str:
    name = normalize_person_name(user_name)
    if not name:
        return (
            "Open this voice conversation with one warm, natural sentence. "
            "Introduce yourself as Emma and ask what I would like you to call me."
        )
    first_name = name.split()[0]
    return (
        f"Open this voice conversation with one warm, natural sentence for {first_name}. "
        "Introduce yourself as Emma and ask what is on their mind."
    )


def nvidia_extra_parameters(model: str) -> dict:
    if "nemotron" not in model:
        return {}
    # Pipecat expands Settings.extra into OpenAI SDK keyword arguments.
    # NVIDIA-specific request fields therefore belong under extra_body.
    return {
        "extra_body": {
            "chat_template_kwargs": {"enable_thinking": False},
        },
    }


def llm_provider() -> str:
    configured = os.getenv("LLM_PROVIDER", "").strip().lower()
    if configured:
        return configured
    return "groq" if os.getenv("GROQ_API_KEY", "").strip() else "nvidia"


def create_llm(system_instruction: str):
    provider = llm_provider()
    if provider == "groq":
        model = os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL).strip() or DEFAULT_GROQ_MODEL
        settings = OpenAILLMService.Settings(
            model=model,
            system_instruction=system_instruction,
            max_tokens=160,
            temperature=0.6,
            top_p=0.9,
            extra={
                "reasoning_effort": "low",
                "extra_body": {"include_reasoning": False},
            },
        )
        return (
            OpenAILLMService(
                api_key=os.environ["GROQ_API_KEY"].strip(),
                base_url=GROQ_BASE_URL,
                settings=settings,
            ),
            provider,
            model,
        )

    configured_model = os.environ["NVIDIA_MODEL"].strip()
    model = FAST_DIALOGUE_MODEL if configured_model == LEGACY_REASONING_MODEL else configured_model
    settings = {
        "model": model,
        "system_instruction": system_instruction,
        "max_tokens": 160,
        "temperature": 1.0,
        "top_k": 1,
    }
    if "nemotron" in model:
        settings["extra"] = nvidia_extra_parameters(model)
    return (
        NvidiaLLMService(
            api_key=os.environ["NVIDIA_API_KEY"].strip(),
            settings=NvidiaLLMService.Settings(**settings),
        ),
        provider,
        model,
    )


def voice_user_params() -> LLMUserAggregatorParams:
    """Use finalized transcripts for reliable consecutive voice turns."""
    return LLMUserAggregatorParams(
        # Deepgram final transcripts drive turns directly. VAD could stay
        # stuck in SPEAKING when speaker echo reached the microphone, causing
        # the next finalized sentence to be discarded.
        vad_analyzer=None,
        user_turn_stop_timeout=0.9,
        user_turn_strategies=UserTurnStrategies(
            start=[TranscriptionUserTurnStartStrategy(use_interim=True)],
            stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=0.2)],
        ),
    )


def origin_allowed(origin: str | None) -> bool:
    if not origin:
        return False
    if origin in ORIGINS:
        return True
    return bool(VERCEL_ORIGIN.fullmatch(origin))


def session_allowed(request: Request) -> bool:
    secret = os.getenv("VOICE_BACKEND_SECRET", "").strip()
    provided = request.headers.get("x-voice-secret", "")
    if secret:
        return secrets.compare_digest(provided, secret)
    return origin_allowed(request.headers.get("origin"))


async def drop_existing_session():
    pending = [task for task in list(tasks) if not task.done()]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    tasks.clear()


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


def create_worker(room_name: str, bot_token: str, user_name: str | None = None):
    person_name = normalize_person_name(user_name)
    intro_prompt = introduction_prompt_for(person_name)
    name_instruction = (
        f"The person's preferred name is {person_name}. Use their name naturally and sparingly. "
        if person_name
        else "Begin by asking what they would like to be called. Remember the name they give you and use it naturally and sparingly. "
    )
    system_instruction = (
        (ROOT / "emma-prompt.txt").read_text()
        + "\nUse short spoken turns, without markdown or emojis. "
        + name_instruction
        + "Never address the person as 'user'."
    )
    llm, provider, dialogue_model = create_llm(system_instruction)
    transport = LiveKitTransport(
        url=os.environ["LIVEKIT_URL"].strip(),
        token=bot_token,
        room_name=room_name,
        params=LiveKitParams(
            audio_in_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_enabled=True,
            audio_out_sample_rate=24000,
            audio_out_10ms_chunks=8,
        ),
    )
    logger.info("Voice dialogue provider/model: {}/{}", provider, dialogue_model)
    stt = EmmaDeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        ttfs_p99_latency=0.35,
        settings=DeepgramSTTService.Settings(
            model="nova-3",
            language="en",
            interim_results=True,
            endpointing=200,
            punctuate=True,
            smart_format=True,
        ),
    )
    # The WebSocket service holds one connection open for the whole session, so
    # a reply does not pay for a fresh HTTPS handshake on every turn.
    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        sample_rate=24000,
        settings=ElevenLabsTTSService.Settings(
            voice=os.environ["ELEVENLABS_VOICE_ID"].strip(),
            model="eleven_flash_v2_5",
        ),
    )
    # The opening line goes through the same LLM and TTS pipeline as every
    # later answer. It is an instruction, not prerecorded or fixed reply text.
    context = LLMContext(messages=[{"role": "user", "content": intro_prompt}])
    user, assistant = LLMContextAggregatorPair(
        context,
        user_params=voice_user_params(),
    )
    worker = PipelineWorker(
        Pipeline([
            transport.input(),
            MicAudioProbe(),
            stt,
            TranscriptProbe(),
            user,
            llm,
            tts,
            ReplyLatencyProbe(),
            transport.output(),
            assistant,
        ]),
        params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=24000),
        idle_timeout_secs=300,
        processor_unusable_policy=ProcessorUnusablePolicy.CONTINUE,
    )
    runner = WorkerRunner(handle_sigint=False)

    introduced = False

    async def speak_intro():
        nonlocal introduced
        if introduced:
            return
        introduced = True
        # Let LiveKit finish publishing the bot audio track first.
        await asyncio.sleep(0.2)
        logger.info("Speaking Emma's intro.")
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_first_participant_joined")
    async def first_participant_joined(transport, participant_id):
        logger.info("Participant joined: {}", participant_id)
        await speak_intro()

    @transport.event_handler("on_client_connected")
    async def client_connected(transport, participant):
        await speak_intro()

    @transport.event_handler("on_participant_disconnected")
    async def disconnected(transport, participant_id):
        identity = str(participant_id)
        logger.info("Participant left: {}", identity)
        if identity.startswith("user-"):
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


async def run_session_worker(
    room_name: str,
    bot_token: str,
    user_name: str | None = None,
):
    """Initialize providers outside the session-token request path."""
    try:
        run = create_worker(room_name, bot_token, user_name)
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_origin_regex=r"https://([a-z0-9-]+\.)*vercel\.app",
    allow_methods=["GET", "POST", "HEAD"],
    allow_headers=["Content-Type", "X-Voice-Secret"],
)


@app.middleware("http")
async def authorize_session_create(request: Request, call_next):
    # CORS alone does not reject POSTs. Gate room creation before a bot starts.
    if request.method == "POST" and request.url.path == "/api/session":
        if not session_allowed(request):
            return JSONResponse(
                {"detail": "Voice session is not authorized for this client."},
                status_code=403,
            )
    return await call_next(request)


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    missing = missing_settings()
    return {
        "ready": not missing,
        "missing": missing,
        "active_sessions": sum(not task.done() for task in tasks),
    }


@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {
        "service": "Emma Pipecat voice backend",
        "status": "ok",
        "health": "/health",
    }


@app.post("/api/session")
async def create_session(payload: SessionRequest | None = None):
    if missing := missing_settings():
        raise HTTPException(503, "Configure voice-backend/.env: " + ", ".join(missing))

    async with session_lock:
        await drop_existing_session()
        session_id = secrets.token_urlsafe(12)
        room_name = f"emma-{session_id}"
        user_token = make_livekit_token(room_name, f"user-{session_id}", "Emma user")
        bot_token = make_livekit_token(room_name, f"emma-{session_id}", "Emma")
        user_name = normalize_person_name(payload.user_name if payload else None)
        task = asyncio.create_task(run_session_worker(room_name, bot_token, user_name))
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
