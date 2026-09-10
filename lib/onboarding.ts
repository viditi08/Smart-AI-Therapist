/** Onboarding answers personalize the therapist prompt (Mellow-style). */

export type OnboardingAnswers = {
  reason?: string;
  duration?: string;
  mood?: string;
  pastSupport?: string;
  supportStyle?: string;
  startingFeeling?: string;
};

export const ONBOARDING_STORAGE_KEY = "emma.onboarding.v1";

export const ONBOARDING_QUESTIONS: {
  key: keyof OnboardingAnswers;
  question: string;
  options: string[];
}[] = [
  {
    key: "reason",
    question: "What brings you here today?",
    options: [
      "Anxiety",
      "Stress",
      "Relationship issues",
      "Loneliness",
      "Grief",
      "Just need to talk",
    ],
  },
  {
    key: "duration",
    question: "How long have you been feeling this way?",
    options: ["Just started", "A few weeks", "A few months", "Over a year"],
  },
  {
    key: "mood",
    question: "How would you describe your current mood?",
    options: [
      "Overwhelmed",
      "Numb",
      "Sad",
      "Anxious",
      "Angry",
      "Okay but struggling",
    ],
  },
  {
    key: "pastSupport",
    question: "Have you talked to anyone about this before?",
    options: [
      "No, never",
      "Tried but it didn't help",
      "Yes and it helped",
      "I have a therapist already",
    ],
  },
  {
    key: "supportStyle",
    question: "What kind of support feels right for you?",
    options: [
      "Just listen to me",
      "Help me understand my feelings",
      "Give me practical advice",
      "Check in on me regularly",
    ],
  },
  {
    key: "startingFeeling",
    question: "How are you feeling about starting this conversation?",
    options: ["Nervous", "Hopeful", "Skeptical", "Ready to open up"],
  },
];

export function isOnboardingAnswers(value: unknown): value is OnboardingAnswers {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const keys: (keyof OnboardingAnswers)[] = [
    "reason",
    "duration",
    "mood",
    "pastSupport",
    "supportStyle",
    "startingFeeling",
  ];
  return keys.every((k) => o[k] === undefined || typeof o[k] === "string");
}

export function parseOnboarding(value: unknown): OnboardingAnswers | null {
  if (!isOnboardingAnswers(value)) return null;
  const out: OnboardingAnswers = {};
  for (const key of [
    "reason",
    "duration",
    "mood",
    "pastSupport",
    "supportStyle",
    "startingFeeling",
  ] as const) {
    const v = value[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function buildOnboardingContext(answers: OnboardingAnswers | null | undefined): string {
  if (!answers) return "";
  const lines: string[] = [];
  if (answers.reason) {
    lines.push(`The user is here because of ${answers.reason.toLowerCase()}.`);
  }
  if (answers.duration) {
    lines.push(`They have been feeling this way for ${answers.duration.toLowerCase()}.`);
  }
  if (answers.mood) {
    lines.push(`Their current mood is ${answers.mood.toLowerCase()}.`);
  }
  if (answers.pastSupport) {
    lines.push(`About talking to someone before, they said: "${answers.pastSupport}".`);
  }
  if (answers.supportStyle) {
    lines.push(`The kind of support that feels right for them: "${answers.supportStyle}".`);
  }
  if (answers.startingFeeling) {
    lines.push(
      `They are feeling ${answers.startingFeeling.toLowerCase()} about starting this conversation.`,
    );
  }
  if (lines.length === 0) return "";
  return `Session personalization from a short intake:\n${lines.join("\n")}\nTailor your approach to this context. Do not recap the intake unless they ask.`;
}

export function loadOnboarding(): OnboardingAnswers | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    return parseOnboarding(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveOnboarding(answers: OnboardingAnswers): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(answers));
  } catch {
    /* ignore quota */
  }
}

export function clearOnboarding(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
