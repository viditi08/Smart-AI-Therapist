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
from openai import APIStatusError
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

# Give LiveKit a deeper playback queue so brief TTS gaps do not become glitches.
_ORIG_AUDIO_SOURCE_INIT = livekit_rtc.AudioSource.__init__


def _audio_source_init(self, *args, **kwargs):
    kwargs.setdefault("queue_size_ms", 2000)
    return _ORIG_AUDIO_SOURCE_INIT(self, *args, **kwargs)


livekit_rtc.AudioSource.__init__ = _audio_source_init

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
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
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport
from pipecat.turns.user_mute import (
    BaseUserMuteStrategy,
    MuteUntilFirstBotCompleteUserMuteStrategy,
)
from pipecat.turns.user_start import (
    TranscriptionUserTurnStartStrategy,
    VADUserTurnStartStrategy,
)
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.utils.errors import ErrorCategory
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
REQUIRED = (*COMMON_REQUIRED, "GEMINI_API_KEY")
ORIGINS = [value.strip() for value in os.getenv(
    "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",") if value.strip()]
# Preview and production Vercel URLs share this suffix.
VERCEL_ORIGIN = re.compile(r"^https://([a-z0-9-]+\.)*vercel\.app$")
tasks: set[asyncio.Task] = set()
rejoin_tasks: set[asyncio.Task] = set()
session_lock = asyncio.Lock()
_silero_ready = False
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
# 2.5-flash is retired for new API keys (404/400). 3.1-flash-lite still 503s
# under load, so prefer current Flash-Lite and keep 3.1 as a fallback.
DEFAULT_GEMINI_FALLBACKS = (
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",
)
RETIRED_GEMINI_MODELS = frozenset({
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
})
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
SILENT_MIC_PEAK = 400
# 20 ms frames, so this is roughly fifteen seconds of listening.
QUIET_MIC_CHUNKS = 750
VOICE_MAX_TOKENS = 96
# Watchdog only; Pipecat's default is 5s. A short value finalizes the turn
# before Deepgram's transcript arrives, so Emma never generates a reply.
USER_TURN_STOP_TIMEOUT_SECS = 5.0
USER_SPEECH_TIMEOUT_SECS = 0.6
VAD_START_SECS = 0.32
VAD_STOP_SECS = 0.2
VAD_INTERRUPT_CONFIDENCE = 0.82
DEEPGRAM_TTFS_P99_LATENCY = 0.7
DEEPGRAM_ENDPOINTING_MS = 450
LIVEKIT_AUDIO_OUT_10MS_CHUNKS = 20
USER_REJOIN_GRACE_SECS = 12
ELEVENLABS_MODEL = "eleven_turbo_v2"
ELEVENLABS_STABILITY = 0.9


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
        self._logged_playback = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStoppedSpeakingFrame):
            self._turn_ended_at = time.monotonic()
        elif isinstance(frame, TTSAudioRawFrame):
            if not self._logged_playback:
                self._logged_playback = True
                logger.info("Emma's voice is playing.")
            if self._turn_ended_at is not None:
                now = time.monotonic()
                logger.info("Provider reply latency {:.2f}s.", now - self._turn_ended_at)
                self._turn_ended_at = None
        await self.push_frame(frame, direction)


class MuteWhileBotSpeakingUserMuteStrategy(BaseUserMuteStrategy):
    """Drop mic/VAD frames while Emma is talking so speaker echo cannot cancel her."""

    def __init__(self):
        super().__init__()
        self._bot_speaking = False

    async def process_frame(self, frame: Frame) -> bool:
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
        return self._bot_speaking


class EchoTranscriptFilter(FrameProcessor):
    """Drop Deepgram transcripts of Emma's own playback so they do not become user turns."""

    def __init__(self):
        super().__init__()
        self._bot_speaking = False
        self._ignored = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
        if (
            self._bot_speaking
            and direction == FrameDirection.DOWNSTREAM
            and isinstance(frame, (TranscriptionFrame, InterimTranscriptionFrame))
            and getattr(frame, "text", "").strip()
        ):
            self._ignored += 1
            if self._ignored == 1:
                logger.info("Ignoring Deepgram transcripts while Emma is speaking.")
            return
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


def google_api_key() -> str:
    return (
        os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )


def missing_settings():
    required = list(COMMON_REQUIRED)
    provider = llm_provider()
    if provider != "google":
        return ["LLM_PROVIDER (use google)"]
    if not google_api_key():
        required.append("GEMINI_API_KEY")
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
            "Introduce yourself as Emma and ask what is on my mind. "
            "Do not ask my name or what you should call me."
        )
    first_name = name.split()[0]
    return (
        f"Open this voice conversation with one warm, natural sentence for {first_name}. "
        "Introduce yourself as Emma and ask what is on their mind."
    )


def introduction_speech_for(user_name: str | None) -> str:
    name = normalize_person_name(user_name)
    if not name:
        return "Hi, I'm Emma. What's on your mind today?"
    first_name = name.split()[0]
    return f"Hi {first_name}, I'm Emma. What's on your mind today?"


def llm_provider() -> str:
    configured = os.getenv("LLM_PROVIDER", "").strip().lower()
    if configured in ("", "gemini", "google"):
        return "google"
    return configured


def gemini_model_chain() -> list[str]:
    primary = (
        os.getenv("GEMINI_MODEL", "").strip()
        or os.getenv("GOOGLE_MODEL", "").strip()
        or DEFAULT_GEMINI_MODEL
    )
    if primary.lower() in RETIRED_GEMINI_MODELS:
        primary = DEFAULT_GEMINI_MODEL
    configured = [
        value.strip()
        for value in os.getenv("GEMINI_FALLBACK_MODELS", "").split(",")
        if value.strip()
    ]
    extras = configured or list(DEFAULT_GEMINI_FALLBACKS)
    models: list[str] = []
    for model in (primary, *extras, DEFAULT_GEMINI_MODEL, *DEFAULT_GEMINI_FALLBACKS):
        if not model or model in models:
            continue
        if model.lower() in RETIRED_GEMINI_MODELS:
            continue
        models.append(model)
    return models or [DEFAULT_GEMINI_MODEL]


def _gemini_settings(model: str, system_instruction: str) -> OpenAILLMService.Settings:
    name = model.lower()
    extra: dict = {}
    if name.startswith("gemini-2.5") or name.startswith("gemini-2.0"):
        # 2.5 Flash thinks by default and can sit silent for several seconds.
        extra = {
            "reasoning_effort": "none",
            "extra_body": {
                "google": {"thinking_config": {"thinking_budget": 0}},
            },
        }
    elif name.startswith("gemini-3"):
        extra = {
            "reasoning_effort": "minimal",
            "extra_body": {
                "google": {"thinking_config": {"thinking_level": "minimal"}},
            },
        }
    return OpenAILLMService.Settings(
        model=model,
        system_instruction=system_instruction,
        max_tokens=VOICE_MAX_TOKENS,
        temperature=0.7,
        top_p=0.9,
        extra=extra,
    )


def _http_status(exc: BaseException) -> int | None:
    status = getattr(exc, "status_code", None)
    return status if isinstance(status, int) else None


def _is_capacity_error(exc: BaseException) -> bool:
    status = _http_status(exc)
    if status in (429, 503):
        return True
    text = str(exc).lower()
    return any(
        marker in text
        for marker in ("503", "429", "high demand", "overloaded", "unavailable")
    )


def _is_skippable_model_error(exc: BaseException) -> bool:
    status = _http_status(exc)
    if status in (400, 404, 429, 503):
        return True
    return _is_capacity_error(exc)


class EmmaGeminiLLMService(OpenAILLMService):
    """Retries Gemini 503/429 and falls back to another Flash model."""

    def __init__(self, *, models: list[str], system_instruction: str, **kwargs):
        self._models = models
        self._system_instruction = system_instruction
        super().__init__(
            settings=_gemini_settings(models[0], system_instruction),
            **kwargs,
        )

    def _use_model(self, model: str):
        next_settings = _gemini_settings(model, self._system_instruction)
        self._settings.model = next_settings.model
        self._settings.extra = next_settings.extra

    def _classify_error(self, exception: Exception) -> ErrorCategory | None:
        # A 404 on one fallback model must not disable the LLM for the session.
        if _is_skippable_model_error(exception):
            return ErrorCategory.SERVER
        return super()._classify_error(exception)

    async def _process_context(self, context):
        last_error: BaseException | None = None
        for model in self._models:
            self._use_model(model)
            try:
                logger.info("Asking Gemini {} for a reply.", model)
                result = await super()._process_context(context)
                if model != self._models[0]:
                    logger.info("Gemini fell back to {} after earlier model errors.", model)
                await self.set_usable(True)
                return result
            except APIStatusError as exc:
                last_error = exc
                if not _is_skippable_model_error(exc):
                    raise
                logger.warning(
                    "Gemini {} returned {}. Trying the next model.",
                    model,
                    exc.status_code,
                )
                await asyncio.sleep(0.25)
            except Exception as exc:
                last_error = exc
                if not _is_skippable_model_error(exc):
                    raise
                logger.warning("Gemini {} unavailable: {}. Trying the next model.", model, exc)
                await asyncio.sleep(0.25)
        await self.set_usable(True)
        raise RuntimeError(
            "Gemini is temporarily unavailable on every configured model"
        ) from last_error


def create_llm(system_instruction: str):
    models = gemini_model_chain()
    return (
        EmmaGeminiLLMService(
            models=models,
            system_instruction=system_instruction,
            api_key=google_api_key(),
            base_url=GEMINI_BASE_URL,
        ),
        "google",
        models[0],
    )


def voice_user_params() -> LLMUserAggregatorParams:
    """Interrupt Emma as soon as the user starts speaking, then wait for the added sentence."""
    return LLMUserAggregatorParams(
        # VAD stops Emma immediately on barge-in. Transcripts still end the
        # turn so a mid-sentence pause, addition, or rephrase can finish first.
        # Volume/confidence stay high so Emma's own playback is less likely to
        # look like the user speaking.
        vad_analyzer=SileroVADAnalyzer(
            sample_rate=16000,
            params=VADParams(
                confidence=VAD_INTERRUPT_CONFIDENCE,
                start_secs=VAD_START_SECS,
                stop_secs=VAD_STOP_SECS,
                min_volume=0.7,
            ),
        ),
        user_turn_stop_timeout=USER_TURN_STOP_TIMEOUT_SECS,
        user_mute_strategies=[
            MuteUntilFirstBotCompleteUserMuteStrategy(),
            MuteWhileBotSpeakingUserMuteStrategy(),
        ],
        user_turn_strategies=UserTurnStrategies(
            start=[
                VADUserTurnStartStrategy(),
                TranscriptionUserTurnStartStrategy(use_interim=True),
            ],
            stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=USER_SPEECH_TIMEOUT_SECS)],
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
    waiting = [task for task in list(rejoin_tasks) if not task.done()]
    for task in waiting:
        task.cancel()
    if waiting:
        await asyncio.gather(*waiting, return_exceptions=True)
    rejoin_tasks.clear()
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
    intro_speech = introduction_speech_for(person_name)
    name_instruction = (
        f"The person's preferred name is {person_name}. Use their name naturally and sparingly. "
        if person_name
        else "Do not ask the person's name or what you should call them. "
    )
    system_instruction = (
        (ROOT / "emma-prompt.txt").read_text()
        + "\nKeep every voice reply under 45 words and at most two short sentences. "
        + "Start with a brief complete sentence so speech can begin promptly. "
        + "Do not use markdown or emojis. "
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
            audio_out_10ms_chunks=LIVEKIT_AUDIO_OUT_10MS_CHUNKS,
            audio_out_auto_silence=False,
        ),
    )
    logger.info("Voice dialogue provider/model: {}/{}", provider, dialogue_model)
    stt = EmmaDeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        ttfs_p99_latency=DEEPGRAM_TTFS_P99_LATENCY,
        settings=DeepgramSTTService.Settings(
            model="nova-3",
            language="en",
            interim_results=True,
            endpointing=DEEPGRAM_ENDPOINTING_MS,
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
            model=ELEVENLABS_MODEL,
            stability=ELEVENLABS_STABILITY,
            similarity_boost=0.8,
            speed=1.0,
        ),
    )
    # Speak a canned intro over the already-open ElevenLabs socket so the
    # greeting does not wait on Gemini. The first user turn is the first LLM call.
    context = LLMContext(messages=[])
    user, assistant = LLMContextAggregatorPair(
        context,
        user_params=voice_user_params(),
    )

    @user.event_handler("on_user_turn_stopped")
    async def on_user_turn_stopped(aggregator, strategy, message):
        content = (getattr(message, "content", None) or "").strip()
        if content:
            logger.info("User turn ended; generating Emma's reply.")
        else:
            logger.info("User turn ended without speech; waiting.")
    worker = PipelineWorker(
        Pipeline([
            transport.input(),
            MicAudioProbe(),
            stt,
            EchoTranscriptFilter(),
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
    pipeline_ready = False
    rejoin_task: asyncio.Task | None = None

    async def speak_intro():
        nonlocal introduced
        if introduced or not pipeline_ready:
            return
        introduced = True
        logger.info("Speaking Emma's intro.")
        await worker.queue_frames([TTSSpeakFrame(text=intro_speech)])

    @worker.event_handler("on_pipeline_started")
    async def on_pipeline_started(started_worker, frame):
        nonlocal pipeline_ready
        pipeline_ready = True
        await speak_intro()

    def cancel_rejoin_wait():
        nonlocal rejoin_task
        if rejoin_task and not rejoin_task.done():
            rejoin_task.cancel()
        rejoin_task = None

    @transport.event_handler("on_first_participant_joined")
    async def first_participant_joined(transport, participant_id):
        cancel_rejoin_wait()
        logger.info("Participant joined: {}", participant_id)
        await speak_intro()

    @transport.event_handler("on_client_connected")
    async def client_connected(transport, participant):
        cancel_rejoin_wait()
        await speak_intro()

    @transport.event_handler("on_participant_disconnected")
    async def disconnected(transport, participant_id):
        nonlocal rejoin_task
        identity = str(participant_id)
        logger.info("Participant left: {}", identity)
        if not identity.startswith("user-"):
            return

        async def end_if_user_stays_gone():
            try:
                await asyncio.sleep(USER_REJOIN_GRACE_SECS)
            except asyncio.CancelledError:
                return
            logger.info("User did not rejoin; ending the voice session.")
            await runner.cancel()

        cancel_rejoin_wait()
        rejoin_task = asyncio.create_task(end_if_user_stays_gone())
        rejoin_tasks.add(rejoin_task)
        rejoin_task.add_done_callback(rejoin_tasks.discard)

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
        finally:
            cancel_rejoin_wait()

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
    global _silero_ready
    if not _silero_ready:
        SileroVADAnalyzer(sample_rate=16000)
        _silero_ready = True
        logger.info("Silero VAD is ready.")
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
    # Render and other hosts probe 0.0.0.0. Binding 127.0.0.1 makes the
    # service look like it never opened a port.
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", "7860")),
    )
