import { synthesizeSpeech } from "@/lib/text-to-speech";
import { allowPipelineAnon, resolvePipelineUserId } from "@/lib/pipeline-session-store";

export const runtime = "nodejs";

const MAX_TTS_CHARS = 1_200;

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
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) {
    return Response.json({ error: "text required" }, { status: 400 });
  }
  if (text.length > MAX_TTS_CHARS) {
    return Response.json({ error: "Text too long for speech" }, { status: 400 });
  }

  const started = performance.now();
  try {
    const audio = await synthesizeSpeech(text);
    return Response.json({
      mimeType: audio.mimeType,
      audio: audio.base64,
      ttsMs: Math.round(performance.now() - started),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Text-to-speech failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
