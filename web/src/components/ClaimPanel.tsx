import { useState } from "react";
import type { ClaimGate } from "../chain/contract";
import { formatToken, TOKEN_SYMBOL } from "../lib/format";

export type ClaimPanelProps = {
  gate: ClaimGate;
  wallet: string | null;
  onClaim: () => Promise<void>;
};

/**
 * Read-only view of the claim state; the button lives in the match console.
 * The gate itself is claimGate() in chain/contract.ts. It keys off `settled`,
 * which only becomes true once adjudication has FINALIZED.
 */
export default function ClaimPanel(p: ClaimPanelProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The wallet control lives in the top nav; this panel only reports state.
  if (!p.wallet) {
    return (
      <div className="claim">
        <div className="claim-btn" aria-disabled="true">CONNECT A WALLET TO CHECK YOUR CLAIM</div>
        <p className="claim-reason">wallet control is in the top right</p>
      </div>
    );
  }

  const ready = p.gate.state === "ready";
  const text = ready
    ? `Your claim is ready. Claim your ${TOKEN_SYMBOL}`
    : p.gate.state === "not-settled"
      ? "Waiting for finalization"
      : p.gate.state === "nothing-to-claim"
          ? "Nothing to claim"
        : "Not a party to this match";

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      await p.onClaim();
      setNote("claim sent");
    } catch (e: any) {
      setNote(String(e?.shortMessage ?? e?.message ?? e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="claim">
      <button
        className={`claim-btn${ready ? " claim-btn--ready" : ""}`}
        disabled={!ready || busy}
        onClick={run}
      >
        {busy ? "SENDING..." : text}
        {p.gate.state === "ready" ? (
          <span className="claim-amt">
            {formatToken(p.gate.amount)} {TOKEN_SYMBOL}
          </span>
        ) : null}
      </button>
      <p className="claim-reason">
        {p.gate.state === "ready" ? "verdict is final, settlement has run" : p.gate.reason}
      </p>
      {note ? <p className="claim-note">{note}</p> : null}
    </div>
  );
}
