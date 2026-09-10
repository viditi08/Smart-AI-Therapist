import { NextResponse } from "next/server";
import { isDatabaseUrlConfigured } from "@/lib/database-env";

export function GET() {
  const hasLlm = Boolean(
    process.env.NVIDIA_API_KEY?.trim() ||
      process.env.LLM_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
  const hasDb = isDatabaseUrlConfigured();

  return NextResponse.json({
    ok: hasLlm,
    service: "emma",
    runtime: "nodejs",
    time: new Date().toISOString(),
    checks: {
      llm: hasLlm,
      database: hasDb,
      textPipeline: hasLlm,
    },
    hint: hasLlm
      ? undefined
      : "Add NVIDIA_API_KEY to .env.local and restart npm run dev. Voice keys live in voice-backend/.env.",
  });
}
