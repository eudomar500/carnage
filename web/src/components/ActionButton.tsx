import { explorerTxUrl } from "../chain/txlog";
import type { ActionPhase } from "../hooks/useAction";

/**
 * The only place a write action can be clicked.
 *
 * Enabled state is derived from the phase and nothing else. `submitting` and
 * `pending` are both hard-disabled, so a button cannot be fired again while
 * its transaction is unresolved, and `confirmed` stays disabled because the
 * work is done. Only `failed`, `unconfirmed` and `discarded` put the button
 * back, and all three say why and relabel themselves as a retry.
 */
export default function ActionButton({
  label,
  phase,
  disabled,
  hash,
  onClick,
}: {
  label: string;
  phase: ActionPhase;
  disabled?: boolean;
  /** The current attempt's transaction hash, once the wallet has broadcast. */
  hash?: string | null;
  onClick: () => void;
}) {
  const busy = phase.kind === "submitting" || phase.kind === "pending";
  const retry =
    phase.kind === "failed" || phase.kind === "unconfirmed" || phase.kind === "discarded";
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
      {busy && hash ? <TxLine hash={hash} /> : null}
      {done ? <p className="act-step">{phase.note}</p> : null}
      {phase.kind === "failed" ? <p className="act-err">{phase.note}</p> : null}
      {phase.kind === "unconfirmed" ? <p className="act-warn">{phase.note}</p> : null}
      {phase.kind === "discarded" ? (
        <>
          <p className="act-warn">{phase.note}</p>
          {phase.hash ? <TxLine hash={phase.hash} label="SEE THE DISCARDED ROUND" /> : null}
        </>
      ) : null}
    </>
  );
}

/**
 * The hash while the wait is still running.
 *
 * Shown here as well as in the reload notice, because the wait is long enough
 * that a user watching it happen wants the same reassurance a returning one
 * gets: something real was sent, and here is where to look at it.
 */
function TxLine({ hash, label = "CHECK THE EXPLORER" }: { hash: string; label?: string }) {
  const url = explorerTxUrl(hash);
  return (
    <p className="act-step act-step--muted act-tx">
      tx <code>{hash.slice(0, 10)}...{hash.slice(-8)}</code>
      {url ? (
        <a className="inflight-link" href={url} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : null}
    </p>
  );
}
