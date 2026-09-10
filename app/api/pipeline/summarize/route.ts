import { generateAssistantText } from "@/lib/llm-stream";
import { formatMessagesForDisplay } from "@/lib/emma-text-pipeline";
import { allowPipelineAnon, resolvePipelineUserId } from "@/lib/pipeline-session-store";
import type { PipelineMessage } from "@/lib/pipeline-types";

export const runtime = "nodejs";

function parseTranscript(raw: unknown): PipelineMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: PipelineMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const role = o.role === "assistant" || o.role === "emma" ? "assistant" : o.role;
    if (role !== "user" && role !== "assistant") continue;
    const content =
      typeof o.content === "string"
        ? o.content
        : typeof o.text === "string"
          ? o.text
          : "";
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({ role, content: trimmed });
  }
  return out;
}

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

  const transcript = parseTranscript(
    body && typeof body === "object"
      ? (body as Record<string, unknown>).transcript
      : undefined,
  );

  if (transcript.length === 0) {
    return Response.json({
      summary: "This session was brief — not much was discussed this time.",
    });
  }

  try {
    const summary = await generateAssistantText(
      "You summarize a therapy-style session for the client to read afterward. Write 2-3 warm, plain, non-clinical sentences about what they explored and how they seemed to feel. Speak gently. Do not give advice or diagnoses.",
      `Summarize this session:\n\n${formatMessagesForDisplay(transcript)}`,
    );
    return Response.json({
      summary: summary || "A summary couldn't be generated for this session.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Summarize failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
