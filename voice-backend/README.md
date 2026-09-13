# Emma LiveKit voice backend

Emma's Next.js interface joins a private LiveKit room with this Python/Pipecat
worker. The spoken pipeline is Deepgram Flux → NVIDIA-hosted dialogue model →
ElevenLabs Flash v2.5. LiveKit carries browser and bot audio, so this project no
longer needs custom Metered TURN or SmallWebRTC configuration.

## Required accounts and environment variables

Create a LiveKit Cloud project. Copy the WebSocket URL, API key, and API secret
from its project settings into `voice-backend/.env` together with the provider
keys:

```env
NVIDIA_API_KEY=
NVIDIA_MODEL=
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PORT=7860
```

Never put API secrets in a `NEXT_PUBLIC_` variable. The backend creates short-lived
LiveKit room tokens; the browser receives only its temporary participant token.

## Run locally

From the project root:

```sh
cp voice-backend/.env.example voice-backend/.env
voice-backend/.venv/bin/python voice-backend/server.py
```

In another terminal:

```sh
npm run dev
```

Open `http://localhost:3000/session/voice`, click **Start talking**, and allow the
microphone. The frontend checks `/health`, asks `/api/session` for a LiveKit room,
then connects the browser and Pipecat worker to that room.

## Fresh installation and verification

```sh
python3.11 -m venv voice-backend/.venv
voice-backend/.venv/bin/pip install -r voice-backend/requirements.txt
npm ci
node scripts/export-emma-prompt.cjs
cd voice-backend
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest -v
```

The tests verify configuration, origin protection, token/session creation, and
pipeline construction without contacting paid providers. A browser conversation
with valid credentials is still required to verify audio, latency, and quotas.

## Deploy

On Render, keep the service root at `voice-backend`, install from
`requirements.txt`, and start it with `python server.py`. Add all provider and
LiveKit variables shown above. Set `FRONTEND_ORIGINS` to the exact Vercel origin,
for example `https://smart-ai-therapist.vercel.app`.

On Vercel, set only this voice connection variable:

```env
NEXT_PUBLIC_PIPECAT_BACKEND_URL=https://smart-ai-therapist.onrender.com
```

Redeploy both services after changing variables. `ICE_SERVERS` and
`NEXT_PUBLIC_PIPECAT_ICE_SERVERS` can be deleted because LiveKit manages WebRTC
connectivity. Render free instances can take time to wake after inactivity.

Implementation references: [LiveKit transport](https://docs.pipecat.ai/api-reference/server/services/transport/livekit),
[Deepgram](https://docs.pipecat.ai/api-reference/server/services/stt/deepgram),
[NVIDIA](https://docs.pipecat.ai/api-reference/server/services/llm/nvidia), and
[ElevenLabs](https://docs.pipecat.ai/api-reference/server/services/tts/elevenlabs).
