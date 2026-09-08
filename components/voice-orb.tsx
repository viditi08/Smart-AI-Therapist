type VoiceOrbProps = {
  state: "ready" | "connecting" | "live" | "paused" | "speaking";
  onClick: () => void;
  action: string;
};

/** A session control: animation reflects connection state, not measured audio. */
export function VoiceOrb({ state, onClick, action }: VoiceOrbProps) {
  const labels = {
    ready: "A little space, just for you",
    connecting: "Getting your conversation ready…",
    live: "Your microphone is on",
    paused: "Take your time",
    speaking: "Emma is speaking",
  };
  return <section className="voice-stage" data-state={state} aria-label="Voice conversation">
    <span className="voice-stage-eyebrow">YOU & EMMA</span>
    <button type="button" className="voice-orb" onClick={onClick}
      disabled={state === "connecting"} aria-label={action}>
      <span className="voice-orb-halo" aria-hidden="true" />
      <svg width="42" height="42" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="11" y="3" width="10" height="17" rx="5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M7 15a9 9 0 0 0 18 0M16 24v5m-5 0h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        {state === "paused" && <path d="m4 4 24 24" stroke="currentColor" strokeWidth="2" />}
      </svg>
    </button>
    <h3 aria-live="polite">{labels[state]}</h3>
    <p>{state === "connecting" ? "This may take a moment." : action}</p>
    <div className="voice-wave" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map(i => <span key={i} />)}
    </div>
  </section>;
}
