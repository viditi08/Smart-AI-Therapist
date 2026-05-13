import {
  buildTherapistLiveSystemInstruction,
  DEFAULT_EMMA_THERAPIST_PROFILE,
} from "@/lib/emma-therapist-profile";

export type {
  EmmaTherapistAssistProfile,
  EmmaVoicePersona,
} from "@/lib/emma-therapist-profile";
export {
  buildTherapistLiveSystemInstruction,
  DEFAULT_EMMA_THERAPIST_PROFILE,
} from "@/lib/emma-therapist-profile";

/** Gemini Live model — matches Google cookbook default; override with GEMINI_LIVE_MODEL. */
export const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";

export function getLiveModel(): string {
  return process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
}

export function getPrebuiltVoiceName(): string | undefined {
  const v = process.env.GEMINI_VOICE_NAME?.trim();
  if (v) return v;
  /** Cookbook default: `Get_started_LiveAPI.py` uses Zephyr. */
  return "Zephyr";
}

/** System prompt for voice sessions (Gemini Live). Not medical advice. */
export function getEmmaLiveSystemInstruction(): string {
  return buildTherapistLiveSystemInstruction(DEFAULT_EMMA_THERAPIST_PROFILE);
}
