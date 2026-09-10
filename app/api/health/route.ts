import { NextResponse } from "next/server";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

export function GET() {
  const hasLlm = Boolean(
    process.env.NVIDIA_API_KEY?.trim() ||
      process.env.LLM_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
  const hasStt = Boolean(process.env.DEEPGRAM_API_KEY?.trim());
  const hasTts = Boolean(
    process.env.ELEVENLABS_API_KEY?.trim() || process.env.ELEVEN_LABS_API_KEY?.trim(),
  );
  const hasDb = isDatabaseUrlConfigured();

  const missing = [
    !hasLlm ? "NVIDIA_API_KEY" : null,
    !hasStt ? "DEEPGRAM_API_KEY" : null,
    !hasTts ? "ELEVENLABS_API_KEY" : null,
  ].filter(Boolean);

  return NextResponse.json({
    ok: hasLlm,
    service: "emma",
    runtime: "nodejs",
    time: new Date().toISOString(),
    checks: {
      llm: hasLlm,
      stt: hasStt,
      tts: hasTts,
      database: hasDb,
      pipeline: hasLlm,
      voicePipeline: hasLlm && hasStt && hasTts,
    },
    hint: missing.length
      ? `Add ${missing.join(", ")} to .env.local and restart npm run dev`
      : undefined,
  });
}
