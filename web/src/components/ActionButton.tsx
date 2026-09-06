import type { ActionPhase } from "../hooks/useAction";

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
  const busy = phase.kind === "working";
  return (
    <>
      <button className="act act--go" onClick={onClick} disabled={busy || disabled}>
        {busy ? "WORKING..." : label}
      </button>
      {phase.kind === "working" ? <p className="act-step act-step--muted">{phase.note}</p> : null}
      {phase.kind === "done" ? <p className="act-step">{phase.note}</p> : null}
      {phase.kind === "error" ? <p className="act-err">{phase.message}</p> : null}
    </>
  );
}
