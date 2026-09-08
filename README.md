# Emma — AI Therapist (landing + voice)

Conversational, therapy-style support with **Emma**: voice-to-voice sessions powered by **Pipecat, Deepgram, NVIDIA, and ElevenLabs**, **Google sign-in** (Auth.js), and **saved conversations** backed by **PostgreSQL** (Prisma).

**Repository:** [github.com/viditi08/Smart-AI-Therapist](https://github.com/viditi08/Smart-AI-Therapist)  
**Live site:** [https://smart-ai-therapist.vercel.app](https://smart-ai-therapist.vercel.app)

Emma is **not** a substitute for emergency services, diagnosis, or care from a licensed clinician.

---



---

## Stack

- [Next.js](https://nextjs.org/) 15 (App Router)
- [React](https://react.dev/) 19
- [Auth.js / NextAuth](https://authjs.dev/) v5 — Google OAuth, JWT sessions, optional [Prisma](https://www.prisma.io/) adapter when `DATABASE_URL` is set
- [Prisma](https://www.prisma.io/) + PostgreSQL — users (via adapter) + `ChatSession` transcripts
- Python + Pipecat — Deepgram transcription, NVIDIA dialogue, and ElevenLabs speech

---

## Requirements

- **Node.js** ≥ 18.18  
- **PostgreSQL** — hosted (e.g. [Neon](https://neon.tech)) for production; locally optional via [Docker](https://www.docker.com/) (`docker-compose.yml` maps host port **5433**)
- **Google Cloud** — OAuth 2.0 **Web** client (Client ID + secret)
- **Google AI Studio** — `GEMINI_API_KEY` for Live API

---

## Local development

For the default **Deepgram Flux + NVIDIA + ElevenLabs** local voice experience,
see [voice-backend/README.md](./voice-backend/README.md).

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy env template and fill in secrets (never commit `.env.local`):

   ```bash
   cp .env.example .env.local
   ```

   See [.env.example](./.env.example) for every variable and OAuth redirect notes.

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

4. Run the app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

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

## Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → your **Web application** OAuth client:

- **Authorized JavaScript origins** — e.g. `https://smart-ai-therapist.vercel.app`, `http://localhost:3000`
- **Authorized redirect URIs** — must include **exactly**:

  `https://smart-ai-therapist.vercel.app/api/auth/callback/google`

  and for local dev:

  `http://localhost:3000/api/auth/callback/google`

Wrong path or trailing slash on the wrong segment causes **`redirect_uri_mismatch`**.

---

## Deploy (Vercel)

Project is configured for Vercel via [`vercel.json`](./vercel.json) (`buildCommand`: `npm run build:production`).

1. Connect the GitHub repo and import the project on [Vercel](https://vercel.com).
2. Set **Environment variables** (Production — add Preview if needed):

   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | Neon (or other) Postgres URL; include `sslmode=require` when required |
   | `AUTH_SECRET` | Strong random secret (e.g. `openssl rand -base64 32`) |
   | `AUTH_GOOGLE_ID` | Google OAuth Client ID |
   | `AUTH_GOOGLE_SECRET` | Google OAuth Client secret |
   | `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/apikey) |
   | `AUTH_URL` | `https://smart-ai-therapist.vercel.app` (no trailing slash) |
   | `AUTH_TRUST_HOST` | `true` |

3. Run **Neon migrations** before or on first deploy (`npm run db:migrate:neon` locally against Neon, or rely on `build:production` if `DATABASE_URL` is set in Vercel).

4. Align **Google OAuth** redirect URIs with the real Vercel host, then **Redeploy** after env changes.

### Redeploy on Vercel

**Deployments** → open the latest deployment → **⋯** → **Redeploy** (needed after changing environment variables or OAuth settings).

---

## Project layout (high level)

- `app/` — routes (marketing `/`, `/session`, `/login`, dashboard `/account`, API routes)
- `auth.ts` / `auth.config.ts` — Auth.js + optional Prisma adapter
- `components/` — UI (voice session, dashboard shell, auth)
- `prisma/` — schema + migrations
- `lib/` — Prisma client, auth helpers, chat validation

---

## License / privacy

Treat API keys and `.env.local` as **secret**. Do not commit real credentials. Review Google’s and your host’s terms for production use of Gemini and OAuth.
