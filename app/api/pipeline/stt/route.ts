import { transcribeAudio } from "@/lib/speech-to-text";
import { allowPipelineAnon, resolvePipelineUserId } from "@/lib/pipeline-session-store";

export const runtime = "nodejs";

const MAX_AUDIO_CHARS = 12_000_000;

export async function POST(req: Request) {
  const userId = await resolvePipelineUserId();
  if (!userId && !allowPipelineAnon()) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const mimeType = typeof o.mimeType === "string" ? o.mimeType.trim() : "";
  const base64 = typeof o.audio === "string" ? o.audio.trim() : "";

  if (!mimeType.startsWith("audio/")) {
    return Response.json({ error: "audio mimeType required" }, { status: 400 });
  }
  if (!base64) {
    return Response.json({ error: "audio required" }, { status: 400 });
  }
  if (base64.length > MAX_AUDIO_CHARS) {
    return Response.json({ error: "Audio clip is too long" }, { status: 400 });
  }

  const started = performance.now();
  try {
    const transcript = await transcribeAudio({ mimeType, base64 });
    return Response.json({
      transcript,
      sttMs: Math.round(performance.now() - started),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Speech-to-text failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
