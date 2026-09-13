import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import server


class VoiceServerTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.client = TestClient(server.app)
        self.origin = {"Origin": "http://localhost:3000"}

    def tearDown(self):
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

    def test_pipeline_constructs_with_installed_services(self):
        settings = {key: "test-placeholder" for key in server.REQUIRED}
        settings["LIVEKIT_URL"] = "wss://example.livekit.cloud"

        async def build():
            token = server.make_livekit_token("test-room", "test-user", "Test")
            self.assertGreater(len(token), 20)
            self.assertTrue(callable(server.create_worker("test-room", token)))

        with patch.dict(os.environ, settings):
            asyncio.run(build())


if __name__ == "__main__":
    unittest.main()
