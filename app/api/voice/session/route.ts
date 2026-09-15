export const runtime = "nodejs";

function backendUrl(): string {
  const configured = (process.env.PIPECAT_BACKEND_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
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

  try {
    const response = await fetch(`${backend}/api/session`, {
      method: "POST",
      headers,
    });
    const body = (await response.json().catch(() => null)) as {
      detail?: string;
      url?: string;
      token?: string;
      room_name?: string;
    } | null;
    if (!response.ok) {
      return Response.json(
        { detail: body?.detail ?? "Could not create a LiveKit session." },
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
