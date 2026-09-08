import { buildTherapistLiveSystemInstruction } from "@/lib/emma-therapist-profile";
import { generateGeminiText } from "@/lib/gemini-text-stream";
import type { PipelineMessage } from "@/lib/pipeline-types";
import {
  KEEP_RAW_TURNS_AFTER_SUMMARY,
  SUMMARIZE_EVERY_N_TURNS,
} from "@/lib/pipeline-types";

/** Emma system prompt for text pipeline turns (same profile as Live voice). */
export function getEmmaTextSystemInstruction(): string {
  const base = buildTherapistLiveSystemInstruction();
  return `${base}

You are in a text chat (not voice). You may use a short paragraph when helpful, but stay concise and conversational.`;
}

export function buildContextPrefix(summary: string | null): string | undefined {
  if (!summary?.trim()) return undefined;
  return `[Earlier in this conversation — summary for context]\n${summary.trim()}`;
}

export function formatMessagesForDisplay(messages: PipelineMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Emma"}: ${m.content}`)
    .join("\n\n");
}

/**
 * After every N turns, compress older messages into a rolling summary
 * and keep only the most recent raw turns.
 */
export async function maybeRollSummary(
  turnCount: number,
  summary: string | null,
  messages: PipelineMessage[],
): Promise<{ summary: string | null; messages: PipelineMessage[]; updated: boolean }> {
  if (turnCount === 0 || turnCount % SUMMARIZE_EVERY_N_TURNS !== 0) {
    return { summary, messages, updated: false };
  }

  const maxRawMessages = KEEP_RAW_TURNS_AFTER_SUMMARY * 2;
  if (messages.length <= maxRawMessages) {
    return { summary, messages, updated: false };
  }

  const toSummarize = messages.slice(0, messages.length - maxRawMessages);
  const kept = messages.slice(messages.length - maxRawMessages);

  const transcript = formatMessagesForDisplay(toSummarize);
  const prior = summary?.trim()
    ? `Previous summary:\n${summary.trim()}\n\n`
    : "";

  const newSummary = await generateGeminiText(
    "You compress therapy-style chat transcripts into brief, neutral summaries. Preserve emotional themes, goals, and key facts. No diagnosis. Under 200 words.",
    `${prior}New transcript to fold in:\n\n${transcript}\n\nWrite an updated rolling summary.`,
  );

  return {
    summary: newSummary || summary,
    messages: kept,
    updated: true,
  };
}
