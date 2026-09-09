# Local Pipecat voice prototype

Emma's Next.js interface connects directly over SmallWebRTC to this Python/FastAPI
process: Deepgram Flux → NVIDIA-hosted dialogue model → ElevenLabs Flash v2.5.
Silero VAD works with Pipecat's user aggregator; Flux supplies its turn events.
Pipecat handles streaming and interruptions. No local NVIDIA GPU is needed.

## Start on this Mac

The dependencies are installed in `.venv` using Python 3.11. From the project root:

```sh
cp voice-backend/.env.example voice-backend/.env
```

Edit `voice-backend/.env` locally. Fill in the three API keys, the exact NVIDIA
dialogue model ID you have access to, and your ElevenLabs voice ID. This file is
gitignored. Never put provider keys in a `NEXT_PUBLIC_` variable.

In one terminal, from the project root:

```sh
voice-backend/.venv/bin/python voice-backend/server.py
```

In a second terminal:

```sh
npm run dev
```

Open **http://localhost:3000/session**, click **Start session**, and
allow the microphone. This is the default voice experience at `/session` in development.
The UI checks `/health` before requesting the microphone. Health readiness checks
configuration presence; it does not verify credentials, endpoint access, or quota.

Say something, wait for Emma's answer, then speak during an answer to test
interruption. Try thoughtful pauses and check whether turn-taking feels natural.
Use **End session** to disconnect; **Mute microphone** only mutes your input.
Save uses the existing account storage when signed in, or device storage otherwise.
Sessions use microphone input and spoken replies, with live transcripts and saving.

## Fresh installation

Use Python 3.11 (tested here), then run from the project root:

```sh
python3.11 -m venv voice-backend/.venv
voice-backend/.venv/bin/pip install -r voice-backend/requirements.txt
npm ci
node scripts/export-emma-prompt.cjs
```

`emma-prompt.txt` is generated from `lib/emma-therapist-profile.ts`. Re-run the export
after changing that profile and restart Python. Both modes then use the same prompt.

## Verification

```sh
voice-backend/.venv/bin/pip install -r voice-backend/requirements-dev.txt
cd voice-backend
.venv/bin/python -m unittest -v
```

Tests cover configuration reporting, origin checks, invalid signaling input, and
pipeline construction without contacting paid providers. Audio quality, latency,
credentials, and real interruptions require a browser conversation with valid keys.

## Scope

The server binds to `127.0.0.1:7860`, allows one connection, and accepts signaling
only from configured local frontend origins. Sessions have a 30-minute maximum and
a 120-second idle timeout. The local mode is disabled in production Next.js builds.
This backend is not an authenticated public service. Hosting it publicly requires
authentication tied to the existing user session, usage limits, HTTPS, and a
transport deployment suited to the target network. Vercel's existing Next.js
deployment does not run this Python process.

If Next.js uses another port, update `FRONTEND_ORIGINS` and restart Python. For a
hosted backend, set `NEXT_PUBLIC_PIPECAT_BACKEND_URL` in Vercel to its HTTPS URL.
If audio playback is blocked, use the visible audio play control. Provider errors
can indicate invalid keys, inaccessible model/voice IDs, or exhausted quota.

Implementation references: [SmallWebRTC](https://docs.pipecat.ai/api-reference/server/services/transport/small-webrtc),
[Deepgram](https://docs.pipecat.ai/api-reference/server/services/stt/deepgram),
[NVIDIA](https://docs.pipecat.ai/api-reference/server/services/llm/nvidia),
[ElevenLabs](https://docs.pipecat.ai/api-reference/server/services/tts/elevenlabs).
