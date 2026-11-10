import { auth } from "@/auth";

export const runtime = "nodejs";

function backendUrl(): string {
  const configured = (process.env.PIPECAT_BACKEND_URL || "")
    .trim()
    .replace(/^[=]+/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    return "https://smart-ai-therapist.onrender.com";
  }
  return "http://127.0.0.1:7860";
}

function isLocalBackend(url: string): boolean {
  return url.includes("127.0.0.1") || url.includes("localhost");
}

export async function POST(request: Request) {
  const backend = backendUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.VOICE_BACKEND_SECRET?.trim();
  if (secret) {
    headers["X-Voice-Secret"] = secret;
  }
  const origin =
    request.headers.get("origin") ||
    process.env.AUTH_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  headers.Origin = origin;
  const session = await auth();
  const userName = session?.user?.name?.trim() || null;

  try {
    const response = await fetch(`${backend}/api/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_name: userName }),
    });
    const body = (await response.json().catch(() => null)) as {
      detail?: unknown;
      url?: string;
      token?: string;
      room_name?: string;
    } | null;
    if (!response.ok) {
      const rawDetail = body?.detail;
      const backendDetail =
        typeof rawDetail === "string"
          ? rawDetail
          : Array.isArray(rawDetail)
            ? rawDetail.map((item) => String(item)).join(", ")
            : "";
      if (response.status === 404 && !backendDetail) {
        return Response.json(
          {
            detail: `Voice server at ${backend} is not running. On Vercel set PIPECAT_BACKEND_URL to https://smart-ai-therapist.onrender.com`,
          },
          { status: 502 },
        );
      }
      return Response.json(
        { detail: backendDetail || `Could not create a LiveKit session (${response.status}).` },
        { status: response.status },
      );
    }
    return Response.json(body);
  } catch {
    return Response.json(
      {
        detail: isLocalBackend(backend)
          ? "Start the local voice backend on port 7860, then try again."
          : `Cannot reach the voice server at ${backend}. Start that host and check /health.`,
      },
      { status: 502 },
    );
  }
}
