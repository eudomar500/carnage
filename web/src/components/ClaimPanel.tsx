import { useState } from "react";
import { confirmationFor } from "../chain/confirm";
import { sendClaim, type ClaimGate, type MatchState } from "../chain/contract";
import type { Role } from "../chain/roles";
import { useAction } from "../hooks/useAction";
import { formatToken, TOKEN_SYMBOL } from "../lib/format";

export type ClaimPanelProps = {
  gate: ClaimGate;
  wallet: `0x${string}` | null;
  match: MatchState;
  role: Role;
  /** Re-reads the match, so the claim can be confirmed against state. */
  refresh: () => Promise<MatchState | null>;
};

/**
 * The claim button in the escrow panel.
 *
 * This is the same action as the console's claim panel, and it now runs
 * through the same machinery: useAction with confirmationFor("claim"), which
 * means the same disable-on-click, the same postcondition watch against
 * get_match, the same attempt journal and the same rule about re-enabling.
 *
 * It used to have its own busy flag and a `finally` that re-enabled the
 * button whatever happened, including after a throw where the transaction had
 * already reached the network. That is the one case the action layer exists
 * to prevent, and having two claim buttons with different answers to it was
 * worse than having one.
 *
 * Because both buttons journal under the same match id and action id, an
 * attempt started at either one is picked up by both after a reload.
 *
 * The gate itself is claimGate() in chain/contract.ts. It keys off `settled`,
 * which only becomes true once adjudication has FINALIZED.
 */
export default function ClaimPanel(p: ClaimPanelProps) {
  const [payout, setPayout] = useState<string | null>(null);
  const a = useAction({
    matchId: p.match.match_id,
    confirm: confirmationFor("claim", p.role),
    refresh: p.refresh,
  });

  // The wallet control lives in the top nav; this panel only reports state.
  if (!p.wallet) {
    return (
      <div className="claim">
        <div className="claim-btn" aria-disabled="true">CONNECT A WALLET TO CHECK YOUR CLAIM</div>
        <p className="claim-reason">wallet control is in the top right</p>
      </div>
    );
  }

  const wallet = p.wallet;
  const ready = p.gate.state === "ready";

  const run = () =>
    a.run(async (say) => {
      say("confirm the transaction in your wallet...");
      await sendClaim(p.match.match_id, wallet, (stage) =>
        setPayout(
          stage === "accepted"
            ? "claim accepted; the GEN is released when this transaction finalizes"
            : "payout finalized; the GEN has left escrow",
        ),
      );
      return "claim recorded";
    });

  // Same phase rules as ActionButton: working states are hard-disabled, a
  // confirmed action stays disabled, and only a genuine failure or an
  // unconfirmed attempt puts the button back, relabelled as a retry.
  const busy = a.phase.kind === "submitting" || a.phase.kind === "pending";
  const retry = a.phase.kind === "failed" || a.phase.kind === "unconfirmed";
  const done = a.phase.kind === "confirmed";

  const idleText = ready
    ? `Your claim is ready. Claim your ${TOKEN_SYMBOL}`
    : p.gate.state === "not-settled"
      ? "Waiting for finalization"
      : p.gate.state === "nothing-to-claim"
          ? "Nothing to claim"
        : "Not a party to this match";

  // Narrowed off phase.kind directly: TypeScript cannot see through the
  // booleans above, and the phase union carries different fields per kind.
  const phase = a.phase;
  const text =
    phase.kind === "submitting"
      ? "WORKING..."
      : phase.kind === "pending"
        ? "CONFIRMING ON-CHAIN..."
        : phase.kind === "failed" || phase.kind === "unconfirmed"
          ? phase.retryLabel
          : idleText;

  return (
    <div className="claim">
      <button
        className={`claim-btn${ready && !busy && !done ? " claim-btn--ready" : ""}${retry ? " claim-btn--retry" : ""}`}
        disabled={!ready || busy || done}
        onClick={run}
      >
        {text}
        {p.gate.state === "ready" && !busy && !retry ? (
          <span className="claim-amt">
            {formatToken(p.gate.amount)} {TOKEN_SYMBOL}
          </span>
        ) : null}
      </button>
      <p className="claim-reason">
        {p.gate.state === "ready" ? "verdict is final, settlement has run" : p.gate.reason}
      </p>
      {phase.kind === "submitting" || phase.kind === "pending" || phase.kind === "confirmed" ? (
        <p className="claim-note">{phase.note}</p>
      ) : null}
      {phase.kind === "failed" ? <p className="claim-note act-err">{phase.note}</p> : null}
      {phase.kind === "unconfirmed" ? <p className="claim-note act-warn">{phase.note}</p> : null}
      {payout ? <p className="claim-note">{payout}</p> : null}
    </div>
  );
}
