/** Shared types for the text/voice pipeline (Phase 1+). */

export type PipelineRole = "user" | "assistant";

export interface PipelineMessage {
  role: PipelineRole;
  content: string;
}

export type CrisisLevel = "none" | "elevated" | "imminent";

export interface TurnMetrics {
  turnNumber: number;
  crisisLevel: CrisisLevel;
  llmTtftMs: number | null;
  llmTotalMs: number | null;
  totalMs: number | null;
  sttMs?: number | null;
  ttsMs?: number | null;
}

export interface PipelineSessionState {
  id: string;
  turnCount: number;
  summary: string | null;
  messages: PipelineMessage[];
}

export const SUMMARIZE_EVERY_N_TURNS = 6;
/** User+assistant pairs kept verbatim after a rolling summary. */
export const KEEP_RAW_TURNS_AFTER_SUMMARY = 6;

/** Fastest model verified on this NVIDIA account; used when none is configured. */
export const DEFAULT_TEXT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

/**
 * Tried in order when the configured model keeps failing — NIM returns 503 when a
 * model's workers are saturated, and not every catalog model is enabled per account.
 * Faster models first so a busy primary does not stall the conversation.
 */
export const FALLBACK_TEXT_MODELS = [
  "meta/llama-3.2-11b-vision-instruct",
  "nvidia/nemotron-3-super-120b-a12b",
];

export function getTextModel(): string {
  return (
    process.env.LLM_MODEL?.trim() ||
    process.env.NVIDIA_MODEL?.trim() ||
    DEFAULT_TEXT_MODEL
  );
}
