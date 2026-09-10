import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

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

    def test_missing_keys_do_not_allocate_connection(self):
        with patch.object(server.handler, "handle_web_request", new_callable=AsyncMock) as handler:
            response = self.client.post("/api/offer", headers=self.origin,
                                        json={"sdp": "test", "type": "offer"})
            self.assertEqual(response.status_code, 503)
            handler.assert_not_called()

    def test_foreign_and_absent_origins_are_rejected(self):
        for headers in ({}, {"Origin": "https://untrusted.example"}):
            response = self.client.post("/api/offer", headers=headers,
                                        json={"sdp": "test", "type": "offer"})
            self.assertEqual(response.status_code, 403)

    def test_local_preflight(self):
        response = self.client.options("/api/offer", headers={
            **self.origin, "Access-Control-Request-Method": "POST",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], self.origin["Origin"])

    def test_invalid_offer_is_rejected(self):
        response = self.client.post("/api/offer", headers=self.origin,
                                    json={"sdp": "", "type": "answer"})
        self.assertEqual(response.status_code, 422)

    def test_pipeline_constructs_with_installed_services(self):
        from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

        async def build():
            connection = SmallWebRTCConnection(ice_servers=[])
            try:
                self.assertTrue(callable(server.create_worker(connection)))
            finally:
                await connection.disconnect()

        with patch.dict(os.environ, {key: "test-placeholder" for key in server.REQUIRED}):
            asyncio.run(build())


if __name__ == "__main__":
    unittest.main()
