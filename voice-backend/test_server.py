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
        os.environ["NVIDIA_API_KEY"] = "private-test-value"
        response = self.client.get("/health")
        self.assertFalse(response.json()["ready"])
        self.assertNotIn("NVIDIA_API_KEY", response.json()["missing"])
        self.assertNotIn("private-test-value", response.text)

    def test_missing_keys_do_not_create_worker(self):
        with patch.object(server, "create_worker") as create_worker:
            response = self.client.post("/api/session", headers=self.origin)
            self.assertEqual(response.status_code, 503)
            create_worker.assert_not_called()

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
        self.assertIn("what I would like you to call me", guest_prompt)
        self.assertIn("Maya", named_prompt)
        self.assertIn("what is on their mind", named_prompt)
        self.assertEqual(server.normalize_person_name("  Maya   Patel  "), "Maya Patel")
        self.assertEqual(
            server.nvidia_extra_parameters("nvidia/nemotron-3.5-lightning-30b-a3b"),
            {
                "extra_body": {
                    "chat_template_kwargs": {"enable_thinking": False},
                },
            },
        )
        mic = server.MicAudioProbe()
        self.assertTrue(callable(mic.process_frame))
        self.assertEqual(mic._chunks, 0)
        latency = server.ReplyLatencyProbe()
        self.assertTrue(callable(latency.process_frame))
        self.assertIsNone(latency._turn_ended_at)
        transcript = server.TranscriptProbe()
        self.assertTrue(callable(transcript.process_frame))
        self.assertEqual(transcript._count, 0)
        self.assertTrue(issubclass(server.EmmaDeepgramSTTService, server.DeepgramSTTService))

    def test_tts_keeps_one_streaming_connection(self):
        # HTTP synthesis pays a fresh handshake per reply, which shows up as a
        # pause before Emma speaks.
        self.assertTrue(issubclass(server.ElevenLabsTTSService, TTSService))
        self.assertFalse(issubclass(server.ElevenLabsTTSService, ElevenLabsHttpTTSService))

    def test_consecutive_turns_are_driven_by_transcripts(self):
        params = server.voice_user_params()
        self.assertIsNone(params.vad_analyzer)
        self.assertEqual(len(params.user_turn_strategies.start), 1)
        self.assertIsInstance(
            params.user_turn_strategies.start[0],
            server.TranscriptionUserTurnStartStrategy,
        )
        self.assertIsInstance(
            params.user_turn_strategies.stop[0],
            server.SpeechTimeoutUserTurnStopStrategy,
        )


if __name__ == "__main__":
    unittest.main()
