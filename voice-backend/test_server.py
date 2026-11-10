import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from pipecat.services.elevenlabs.tts import ElevenLabsHttpTTSService
from pipecat.services.tts_service import TTSService

import server


class VoiceServerTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.client = TestClient(server.app)
        self.origin = {"Origin": "http://localhost:3000"}

    def tearDown(self):
        for task in list(server.tasks):
            task.cancel()
        server.tasks.clear()
        self.client.close()
        self.env.stop()

    def test_health_reports_names_without_secrets(self):
        os.environ["GEMINI_API_KEY"] = "private-test-value"
        response = self.client.get("/health")
        self.assertFalse(response.json()["ready"])
        self.assertNotIn("GEMINI_API_KEY", response.json()["missing"])
        self.assertNotIn("private-test-value", response.text)

    def test_missing_keys_do_not_create_worker(self):
        with patch.object(server, "create_worker") as create_worker:
            response = self.client.post("/api/session", headers=self.origin)
            self.assertEqual(response.status_code, 503)
            create_worker.assert_not_called()

    def test_google_provider_requires_only_its_llm_key(self):
        settings = {key: "test-placeholder" for key in server.COMMON_REQUIRED}
        settings.update({
            "LLM_PROVIDER": "google",
            "GEMINI_API_KEY": "test-gemini-key",
            "GEMINI_MODEL": "gemini-3.1-flash-lite",
        })
        with patch.dict(os.environ, settings, clear=True):
            self.assertEqual(server.missing_settings(), [])
            llm, provider, model = server.create_llm("Test Emma prompt")
            self.assertEqual(
                server.gemini_model_chain()[:2],
                ["gemini-3.1-flash-lite", "gemini-flash-lite-latest"],
            )
        self.assertEqual(provider, "google")
        self.assertEqual(model, "gemini-3.1-flash-lite")
        self.assertIsInstance(llm, server.EmmaGeminiLLMService)
        self.assertIn("generativelanguage.googleapis.com", str(llm._client.base_url))
        self.assertEqual(llm._settings.extra.get("reasoning_effort"), "minimal")

    def test_default_gemini_model_avoids_overloaded_flash_lite(self):
        self.assertEqual(server.DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite")
        self.assertEqual(server.gemini_model_chain()[0], "gemini-3.5-flash-lite")
        settings = server._gemini_settings("gemini-3.5-flash-lite", "Test Emma prompt")
        self.assertEqual(settings.extra.get("reasoning_effort"), "minimal")
        self.assertEqual(
            settings.extra.get("extra_body"),
            {"google": {"thinking_config": {"thinking_level": "minimal"}}},
        )
        flash25 = server._gemini_settings("gemini-2.5-flash", "Test Emma prompt")
        self.assertEqual(flash25.extra.get("reasoning_effort"), "none")

    def test_gemini_fallback_skips_duplicates(self):
        with patch.dict(
            os.environ,
            {
                "GEMINI_MODEL": "gemini-3.5-flash-lite",
                "GEMINI_FALLBACK_MODELS": "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
            },
            clear=False,
        ):
            self.assertEqual(
                server.gemini_model_chain()[:2],
                ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
            )

    def test_retired_gemini_env_model_is_skipped(self):
        with patch.dict(os.environ, {"GEMINI_MODEL": "gemini-2.5-flash"}, clear=False):
            chain = server.gemini_model_chain()
        self.assertNotIn("gemini-2.5-flash", chain)
        self.assertEqual(chain[0], "gemini-3.5-flash-lite")

    def test_gemini_capacity_errors_are_skippable(self):
        overloaded = RuntimeError("This model is currently experiencing high demand")
        missing = type("Status", (), {"status_code": 404})()
        self.assertTrue(server._is_capacity_error(overloaded))
        self.assertTrue(server._is_skippable_model_error(missing))
        self.assertFalse(server._is_skippable_model_error(RuntimeError("mic failed")))

    def test_unknown_llm_provider_is_reported(self):
        with patch.dict(os.environ, {"LLM_PROVIDER": "unknown"}, clear=True):
            self.assertEqual(
                server.missing_settings(),
                ["LLM_PROVIDER (use google)"],
            )

    def test_foreign_and_absent_origins_are_rejected(self):
        for headers in ({}, {"Origin": "https://untrusted.example"}):
            response = self.client.post("/api/session", headers=headers)
            self.assertEqual(response.status_code, 403)

    def test_local_preflight(self):
        response = self.client.options("/api/session", headers={
            **self.origin, "Access-Control-Request-Method": "POST",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], self.origin["Origin"])

    def test_session_returns_livekit_connection(self):
        async def idle_worker():
            await asyncio.sleep(0)

        settings = {key: "test-placeholder" for key in server.REQUIRED}
        settings["LIVEKIT_URL"] = "wss://example.livekit.cloud"
        with patch.dict(os.environ, settings), patch.object(
            server, "create_worker", return_value=idle_worker
        ) as create_worker:
            response = self.client.post("/api/session", headers=self.origin)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["url"], settings["LIVEKIT_URL"])
        self.assertTrue(body["room_name"].startswith("emma-"))
        self.assertGreater(len(body["token"]), 20)
        create_worker.assert_called_once()

    def test_health_and_root_accept_head(self):
        self.assertEqual(self.client.head("/health").status_code, 200)
        self.assertEqual(self.client.head("/").status_code, 200)

    def test_vercel_origin_can_create_a_session(self):
        async def idle_worker():
            await asyncio.sleep(0)

        settings = {key: "test-placeholder" for key in server.REQUIRED}
        settings["LIVEKIT_URL"] = "wss://example.livekit.cloud"
        with patch.dict(os.environ, settings), patch.object(
            server, "create_worker", return_value=idle_worker
        ):
            response = self.client.post(
                "/api/session",
                headers={"Origin": "https://smart-ai-therapist.vercel.app"},
            )
        self.assertEqual(response.status_code, 200)

    def test_secret_allows_server_proxy_without_origin(self):
        async def idle_worker():
            await asyncio.sleep(0)

        settings = {key: "test-placeholder" for key in server.REQUIRED}
        settings["LIVEKIT_URL"] = "wss://example.livekit.cloud"
        settings["VOICE_BACKEND_SECRET"] = "test-secret"
        with patch.dict(os.environ, settings), patch.object(
            server, "create_worker", return_value=idle_worker
        ):
            denied = self.client.post("/api/session", headers=self.origin)
            allowed = self.client.post(
                "/api/session",
                headers={"X-Voice-Secret": "test-secret"},
            )
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed.status_code, 200)

    def test_second_session_replaces_the_first(self):
        async def hang_worker():
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                raise

        settings = {key: "test-placeholder" for key in server.REQUIRED}
        settings["LIVEKIT_URL"] = "wss://example.livekit.cloud"
        with patch.dict(os.environ, settings), patch.object(
            server, "create_worker", return_value=hang_worker
        ):
            first = self.client.post("/api/session", headers=self.origin)
            second = self.client.post("/api/session", headers=self.origin)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(first.json()["room_name"], second.json()["room_name"])

    def test_prompt_includes_crisis_guidance(self):
        prompt = (server.ROOT / "emma-prompt.txt").read_text()
        self.assertIn("988", prompt)
        self.assertIn("not a licensed clinician", prompt.lower())

    def test_pipeline_constructs_with_installed_services(self):
        settings = {key: "test-placeholder" for key in server.REQUIRED}
        settings["LIVEKIT_URL"] = "wss://example.livekit.cloud"

        async def build():
            token = server.make_livekit_token("test-room", "test-user", "Test")
            self.assertGreater(len(token), 20)
            self.assertTrue(callable(server.create_worker("test-room", token)))

        with patch.dict(os.environ, settings):
            asyncio.run(build())

    def test_intro_and_probes_are_defined(self):
        guest_prompt = server.introduction_prompt_for(None)
        named_prompt = server.introduction_prompt_for("Maya Patel")
        self.assertIn("Emma", guest_prompt)
        self.assertIn("what is on my mind", guest_prompt)
        self.assertIn("Do not ask my name", guest_prompt)
        self.assertNotIn("what I would like you to call me", guest_prompt)
        self.assertIn("Maya", named_prompt)
        self.assertIn("what is on their mind", named_prompt)
        self.assertEqual(server.introduction_speech_for(None), "Hi, I'm Emma. What's on your mind today?")
        self.assertIn("Maya", server.introduction_speech_for("Maya Patel"))
        self.assertEqual(server.normalize_person_name("  Maya   Patel  "), "Maya Patel")
        mic = server.MicAudioProbe()
        self.assertTrue(callable(mic.process_frame))
        self.assertEqual(mic._chunks, 0)
        latency = server.ReplyLatencyProbe()
        self.assertTrue(callable(latency.process_frame))
        self.assertIsNone(latency._turn_ended_at)
        transcript = server.TranscriptProbe()
        self.assertTrue(callable(transcript.process_frame))
        self.assertEqual(transcript._count, 0)
        echo = server.EchoTranscriptFilter()
        self.assertFalse(echo._hold.holding())
        self.assertEqual(echo._ignored, 0)
        hold = server.PlaybackEchoHold(hangover_secs=1.2)
        self.assertFalse(hold.holding())
        hold.note(server.BotStartedSpeakingFrame())
        self.assertTrue(hold.holding())
        hold.note(server.BotStoppedSpeakingFrame())
        self.assertTrue(hold.holding())
        gate = server.EchoAudioGate()
        self.assertTrue(callable(gate.process_frame))
        self.assertTrue(issubclass(server.EmmaDeepgramSTTService, server.DeepgramSTTService))

    def test_tts_keeps_one_streaming_connection(self):
        # HTTP synthesis pays a fresh handshake per reply, which shows up as a
        # pause before Emma speaks.
        self.assertTrue(issubclass(server.ElevenLabsTTSService, TTSService))
        self.assertFalse(issubclass(server.ElevenLabsTTSService, ElevenLabsHttpTTSService))

    def test_consecutive_turns_are_driven_by_transcripts(self):
        params = server.voice_user_params()
        self.assertIsNotNone(params.vad_analyzer)
        self.assertEqual(
            params.user_turn_stop_timeout,
            server.USER_TURN_STOP_TIMEOUT_SECS,
        )
        self.assertGreaterEqual(
            params.user_turn_strategies.stop[0]._user_speech_timeout,
            0.5,
        )
        self.assertGreaterEqual(server.USER_TURN_STOP_TIMEOUT_SECS, 5.0)
        self.assertEqual(len(params.user_mute_strategies), 2)
        self.assertIsInstance(
            params.user_mute_strategies[0],
            server.MuteUntilFirstBotCompleteUserMuteStrategy,
        )
        self.assertIsInstance(
            params.user_mute_strategies[1],
            server.MuteWhileBotSpeakingUserMuteStrategy,
        )
        self.assertGreater(
            server.USER_TURN_STOP_TIMEOUT_SECS,
            server.USER_SPEECH_TIMEOUT_SECS,
        )
        self.assertEqual(params.vad_analyzer._params.stop_secs, 0.2)
        self.assertEqual(params.vad_analyzer._params.stop_secs, server.VAD_STOP_SECS)
        self.assertLess(server.VAD_STOP_SECS, server.DEEPGRAM_TTFS_P99_LATENCY)
        self.assertGreaterEqual(params.vad_analyzer._params.confidence, 0.7)
        self.assertLessEqual(params.vad_analyzer._params.confidence, 0.85)
        self.assertLess(server.DEEPGRAM_ENDPOINTING_MS, 600)
        self.assertEqual(server.ELEVENLABS_MODEL, "eleven_turbo_v2")
        self.assertAlmostEqual(server.ELEVENLABS_STABILITY, 0.9)
        self.assertGreaterEqual(server.LIVEKIT_AUDIO_OUT_10MS_CHUNKS, 16)
        self.assertGreaterEqual(server.VAD_START_SECS, 0.3)
        self.assertGreaterEqual(server.USER_REJOIN_GRACE_SECS, 8)
        self.assertLessEqual(server.VOICE_MAX_TOKENS, 100)
        self.assertEqual(len(params.user_turn_strategies.start), 2)
        self.assertIsInstance(
            params.user_turn_strategies.start[0],
            server.VADUserTurnStartStrategy,
        )
        self.assertFalse(params.user_turn_strategies.start[0]._enable_interruptions)
        self.assertFalse(params.user_turn_strategies.start[1]._enable_interruptions)
        self.assertGreaterEqual(server.ECHO_HANGOVER_SECS, 1.0)
        self.assertIsInstance(
            params.user_turn_strategies.start[1],
            server.TranscriptionUserTurnStartStrategy,
        )
        self.assertIsInstance(
            params.user_turn_strategies.stop[0],
            server.SpeechTimeoutUserTurnStopStrategy,
        )


if __name__ == "__main__":
    unittest.main()
