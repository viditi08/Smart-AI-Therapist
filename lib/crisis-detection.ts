import type { CrisisLevel } from "@/lib/pipeline-types";

export interface CrisisDetectionResult {
  level: CrisisLevel;
  /** Matched pattern labels (for metrics/logging; not shown to user). */
  matched: string[];
}

/** Imminent-risk patterns — skip LLM; return fixed escalation copy. */
const IMMINENT_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "suicide_plan", re: /\b(going to|planning to|plan to)\s+(kill myself|end my life|commit suicide)\b/i },
  { label: "suicide_now", re: /\b(want to die|kill myself|end my life|commit suicide)\b/i },
  { label: "self_harm_now", re: /\b(cutting myself|hurt myself right now|self[- ]?harm)\b/i },
  { label: "overdose", re: /\b(overdose|took (all|too many) pills)\b/i },
  { label: "violence_imminent", re: /\b(going to hurt (him|her|them|someone)|kill (him|her|them|someone))\b/i },
];

/** Elevated concern — still route to LLM with safety context. */
const ELEVATED_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "hopeless", re: /\b(hopeless|no reason to live|better off dead|wish i (was|were) dead)\b/i },
  { label: "self_harm_mention", re: /\b(self[- ]?harm|cutting|hurting myself)\b/i },
  { label: "suicidal_ideation", re: /\b(suicidal|suicide|don't want to be here)\b/i },
  { label: "abuse", re: /\b(being abused|abusive (partner|relationship)|hit me)\b/i },
];

function matchPatterns(
  text: string,
  patterns: { label: string; re: RegExp }[],
): string[] {
  const matched: string[] = [];
  for (const { label, re } of patterns) {
    if (re.test(text)) matched.push(label);
  }
  return matched;
}

export function detectCrisis(text: string): CrisisDetectionResult {
  const trimmed = text.trim();
  if (!trimmed) return { level: "none", matched: [] };

  const imminent = matchPatterns(trimmed, IMMINENT_PATTERNS);
  if (imminent.length > 0) {
    return { level: "imminent", matched: imminent };
  }

  const elevated = matchPatterns(trimmed, ELEVATED_PATTERNS);
  if (elevated.length > 0) {
    return { level: "elevated", matched: elevated };
  }

  return { level: "none", matched: [] };
}

/** Fixed reply when imminent crisis is detected — no LLM call. */
export const CRISIS_ESCALATION_REPLY = `I'm really glad you told me. What you're describing sounds urgent, and you deserve immediate human support right now.

Please contact your local emergency number (such as 911 in the US) or a crisis line you trust. In the US you can call or text 988 for the Suicide & Crisis Lifeline.

I'm an AI companion, not emergency services, and I can't keep you safe in a crisis. Is there someone nearby you can reach out to while you contact help?`;
