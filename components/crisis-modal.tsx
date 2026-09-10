"use client";

type CrisisModalProps = {
  level?: "elevated" | "imminent";
  onDismiss: () => void;
};

export function CrisisModal({ level = "imminent", onDismiss }: CrisisModalProps) {
  return (
    <div className="crisis-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="crisis-modal-title">
      <div className="crisis-modal">
        <p className="crisis-modal-icon" aria-hidden>
          🆘
        </p>
        <h2 id="crisis-modal-title">You are not alone</h2>
        <p className="crisis-modal-lead">
          {level === "imminent"
            ? "What you shared sounds urgent. Please reach a human who can help right now."
            : "If you are in crisis, please reach out to one of these resources:"}
        </p>
        <ul className="crisis-modal-list">
          <li>
            <strong>988 Suicide & Crisis Lifeline</strong>
            <span>
              Call or text <b>988</b>
            </span>
          </li>
          <li>
            <strong>Crisis Text Line</strong>
            <span>
              Text <b>HOME</b> to <b>741741</b>
            </span>
          </li>
          <li>
            <strong>Emergency services</strong>
            <span>
              Call <b>911</b> (or your local emergency number)
            </span>
          </li>
        </ul>
        <button type="button" className="btn btn-primary" onClick={onDismiss}>
          I am safe — continue session
        </button>
      </div>
    </div>
  );
}
