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

export const DEFAULT_TEXT_MODEL = "gemini-2.0-flash";

export function getTextModel(): string {
  return process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}
