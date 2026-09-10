"use client";

import { useState } from "react";
import {
  ONBOARDING_QUESTIONS,
  type OnboardingAnswers,
} from "@/lib/onboarding";

type SessionOnboardingProps = {
  onComplete: (answers: OnboardingAnswers) => void;
  onSkip: () => void;
};

export function SessionOnboarding({ onComplete, onSkip }: SessionOnboardingProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({});

  const current = ONBOARDING_QUESTIONS[step]!;
  const isLast = step === ONBOARDING_QUESTIONS.length - 1;
  const progress = ((step + 1) / ONBOARDING_QUESTIONS.length) * 100;

  const handleSelect = (option: string) => {
    const next: OnboardingAnswers = { ...answers, [current.key]: option };
    setAnswers(next);
    if (isLast) onComplete(next);
    else setStep((s) => s + 1);
  };

  return (
    <div className="onboarding-card">
      <div className="onboarding-progress" aria-hidden>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="onboarding-step">
        {step + 1} / {ONBOARDING_QUESTIONS.length}
      </p>
      <h2 className="onboarding-title">{current.question}</h2>
      <p className="onboarding-sub">
        A few questions so Emma can meet you where you are — skip anytime.
      </p>
      <ul className="onboarding-options">
        {current.options.map((option) => (
          <li key={option}>
            <button type="button" className="onboarding-option" onClick={() => handleSelect(option)}>
              {option}
            </button>
          </li>
        ))}
      </ul>
      <div className="onboarding-actions">
        {step > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-outline" onClick={onSkip}>
          Skip intake
        </button>
      </div>
    </div>
  );
}
