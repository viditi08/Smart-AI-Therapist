# Emma — AI Therapist (landing + Pipecat voice)

Conversational, therapy-style support with **Emma**: a **Pipecat** voice agent (**Deepgram** STT → **Gemini** LLM → **ElevenLabs** TTS over LiveKit), **username/password sign-in**, and **saved conversations** in **PostgreSQL**.

**Repository:** [github.com/viditi08/Smart-AI-Therapist](https://github.com/viditi08/Smart-AI-Therapist)  
**Live site:** [https://smart-ai-therapist.vercel.app](https://smart-ai-therapist.vercel.app)

Emma is **not** a substitute for emergency services, diagnosis, or care from a licensed clinician.

---

## Pipeline

**Voice (`/session/voice`)** is a Pipecat process (Python). The browser opens a WebRTC line to it:

```
Mic  ──►  LiveKit  ──►  Pipecat (Deepgram → Gemini → ElevenLabs)  ──►  Speaker
                        voice-backend on port 7860
```

Pipecat handles turn-taking, interruptions, and streaming audio. Vercel does **not** run this Python process — run it locally or host it on Render, Railway, Fly, or a VM, then set `PIPECAT_BACKEND_URL`.

`/session/pipeline` redirects to `/session/voice`.

---

## Stack

- [Next.js](https://nextjs.org/) 15 (App Router)
- [React](https://react.dev/) 19
- [Auth.js / NextAuth](https://authjs.dev/) v5 — username/password credentials and JWT sessions
- [Prisma](https://www.prisma.io/) + PostgreSQL — users and saved session transcripts
- [Pipecat](https://www.pipecat.ai/) — live voice (Python `voice-backend`)
- [Deepgram](https://deepgram.com/) — speech-to-text
- [Google Gemini](https://ai.google.dev/) — voice dialogue LLM
- [NVIDIA NIM](https://build.nvidia.com/) — optional text LLM
- [ElevenLabs](https://elevenlabs.io/) `eleven_flash_v2_5` — text-to-speech

---

## Requirements

- **Python 3.11** — for the Pipecat voice backend
- **Node.js** ≥ 18.18  
- **PostgreSQL** — hosted (e.g. [Neon](https://neon.tech)) for production; locally optional via [Docker](https://www.docker.com/) (`docker-compose.yml` maps host port **5433**)
- **Provider keys** — `NVIDIA_API_KEY` for text, plus `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and LiveKit credentials for voice

---

## Local development

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy env template and fill in secrets (never commit `.env.local`):

   ```bash
   cp .env.example .env.local
   ```

   See [.env.example](./.env.example) for every variable.

3. **Database**

   - **Docker (local):** start Postgres, then migrate:

     ```bash
     npm run db:up
     npm run db:migrate
     ```

   - **Neon only:** add `DATABASE_URL` to `.env.neon` (gitignored) or set it in `.env.local`, then:

     ```bash
     npm run db:migrate:neon
     # or: npm run db:migrate
     ```

4. **Pipecat voice backend** (required for `/session/voice`):

   ```bash
   python3.11 -m venv voice-backend/.venv
   voice-backend/.venv/bin/pip install -r voice-backend/requirements.txt
   cp voice-backend/.env.example voice-backend/.env
   ```

   Put the Deepgram, Gemini, ElevenLabs, and LiveKit credentials in `voice-backend/.env`. Then:

   ```bash
   npm run export:emma-prompt
   voice-backend/.venv/bin/python voice-backend/server.py
   ```

   Details: [voice-backend/README.md](./voice-backend/README.md).

5. Run the Next.js app in a second terminal:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000/session/voice](http://localhost:3000/session/voice).

### Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` | `prisma generate` + `next build` (no migrate) |
| `npm run build:production` | `prisma migrate deploy` + generate + build (used on Vercel) |
| `npm run start` | Production server after `next build` |
| `npm run db:up` / `db:down` | Start/stop local Postgres (Docker) |
| `npm run db:migrate` | Apply migrations using `.env.local` |
| `npm run db:migrate:neon` | Apply migrations using `.env.neon` |
| `npm run db:studio` | Prisma Studio |

---

## Deploy (Vercel)

Project is configured for Vercel via [`vercel.json`](./vercel.json) (`buildCommand`: `npm run build:production`).

1. Connect the GitHub repo and import the project on [Vercel](https://vercel.com).
2. Set **Environment variables** (Production — add Preview if needed):

   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | Neon (or other) Postgres URL; include `sslmode=require` when required |
   | `AUTH_SECRET` | Strong random secret (e.g. `openssl rand -base64 32`) |
   | `DEEPGRAM_API_KEY` | From [Deepgram Console](https://console.deepgram.com) |
   | `NVIDIA_API_KEY` | From [build.nvidia.com](https://build.nvidia.com) |
   | `ELEVENLABS_API_KEY` | From [ElevenLabs](https://elevenlabs.io/app/settings/api-keys) |
   | `ELEVENLABS_VOICE_ID` | Optional; defaults to `21m00Tcm4TlvDq8ikWAM` |
   | `AUTH_TRUST_HOST` | `true` |
   | `PIPECAT_BACKEND_URL` | Public HTTPS origin of the Python Pipecat server (not Vercel) |
   | `VOICE_BACKEND_SECRET` | Same random string as on the Python host |

Voice will not work on Vercel alone. Host `voice-backend/` on Render, Railway, Fly.io, or a VM with LiveKit Cloud credentials, set `VOICE_BACKEND_SECRET` on both hosts, then set `PIPECAT_BACKEND_URL` to the Python URL.

3. Run **Neon migrations** before or on first deploy (`npm run db:migrate:neon` locally against Neon, or rely on `build:production` if `DATABASE_URL` is set in Vercel).

4. Redeploy after changing environment variables.

### Redeploy on Vercel

**Deployments** → open the latest deployment → **⋯** → **Redeploy** (needed after changing environment variables or OAuth settings).

---

## Project layout (high level)

- `voice-backend/` — Pipecat FastAPI server (Deepgram → Gemini → ElevenLabs)
- `app/` — routes (marketing `/`, `/session/voice`, `/login`, dashboard `/account`)
- `auth.ts` / `auth.config.ts` — Auth.js username/password authentication
- `components/session/` — Pipecat voice UI and onboarding
- `prisma/` — schema + migrations
- `lib/` — crisis detection, Prisma/auth helpers

---

## License / privacy

Treat API keys and `.env.local` as **secret**. Do not commit real credentials. Review the terms of Deepgram, Gemini, ElevenLabs, LiveKit, and your host before production use.
