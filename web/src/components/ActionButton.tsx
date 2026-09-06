import type { ActionPhase } from "../hooks/useAction";

/**
 * The only place a write action can be clicked.
 *
 * Enabled state is derived from the phase and nothing else. `submitting` and
 * `pending` are both hard-disabled, so a button cannot be fired again while
 * its transaction is unresolved, and `confirmed` stays disabled because the
 * work is done. Only `failed` and `unconfirmed` put the button back, and both
 * of those say why and relabel themselves as a retry.
 */
export default function ActionButton({
  label,
  phase,
  disabled,
  onClick,
}: {
  label: string;
  phase: ActionPhase;
  disabled?: boolean;
  onClick: () => void;
}) {
  const busy = phase.kind === "submitting" || phase.kind === "pending";
  const retry = phase.kind === "failed" || phase.kind === "unconfirmed";
  const done = phase.kind === "confirmed";

  const text = busy
    ? phase.kind === "submitting"
      ? "WORKING..."
      : "CONFIRMING ON-CHAIN..."
    : retry
      ? phase.retryLabel
      : label;

  return (
    <>
      <button
        className={`act act--go${retry ? " act--retry" : ""}`}
        onClick={onClick}
        disabled={busy || done || disabled}
      >
        {text}
      </button>
      {busy ? <p className="act-step act-step--muted">{phase.note}</p> : null}
      {done ? <p className="act-step">{phase.note}</p> : null}
      {phase.kind === "failed" ? <p className="act-err">{phase.note}</p> : null}
      {phase.kind === "unconfirmed" ? <p className="act-warn">{phase.note}</p> : null}
    </>
  );
}
