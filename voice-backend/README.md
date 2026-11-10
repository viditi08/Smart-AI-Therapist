# Emma LiveKit voice backend

Emma's Next.js interface joins a private LiveKit room with this Python/Pipecat
worker. The spoken pipeline is Deepgram Nova-3 → Gemini Flash-Lite →
ElevenLabs Flash v2.5. LiveKit carries browser and bot audio.

## Required accounts and environment variables

Create a LiveKit Cloud project. Copy the WebSocket URL, API key, and API secret
from its project settings into `voice-backend/.env` together with the provider
keys:

```env
LLM_PROVIDER=google
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
VOICE_BACKEND_SECRET=
PORT=7860
```

Never put API secrets in a `NEXT_PUBLIC_` variable. The Next.js app creates the
room through `/api/voice/session` and forwards `VOICE_BACKEND_SECRET`. The
browser receives only a temporary LiveKit participant token.

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
microphone. The Next.js app asks this server for a LiveKit room, then the
browser and Pipecat worker both join that room.

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
`requirements.txt`, and set **Start Command** to:

```sh
python -m uvicorn server:app --host 0.0.0.0 --port $PORT
```

Do **not** set `HOST=127.0.0.1`; Render health checks only see `0.0.0.0`. Add all provider and LiveKit variables shown above. Set
`FRONTEND_ORIGINS` to the exact Vercel origin, for example
`https://smart-ai-therapist.vercel.app`.

On Vercel, set the server-side backend URL and the same secret as Render:

```env
PIPECAT_BACKEND_URL=https://emma-voice.onrender.com
VOICE_BACKEND_SECRET=choose-a-long-random-string
```

On Vercel, put only the URL in the **value** field: `https://emma-voice.onrender.com`. Do not include `PIPECAT_BACKEND_URL=` or a leading `=`.

Redeploy both services after changing variables. Render free instances can take
time to wake after inactivity.

Implementation references: [LiveKit transport](https://docs.pipecat.ai/api-reference/server/services/transport/livekit),
[Deepgram](https://docs.pipecat.ai/api-reference/server/services/stt/deepgram),
[OpenAI-compatible LLM](https://docs.pipecat.ai/api-reference/server/services/llm/openai), and
[ElevenLabs](https://docs.pipecat.ai/api-reference/server/services/tts/elevenlabs).
