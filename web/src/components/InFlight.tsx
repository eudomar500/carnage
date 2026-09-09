import { explorerTxUrl } from "../chain/txlog";
import type { ActionId } from "../chain/roles";
import type { InFlight } from "../hooks/useAction";

/**
 * What the user called the thing they signed, not what the contract calls it.
 *
 * The notice is read by somebody who has just come back to a page and does not
 * remember which of the fourteen buttons they pressed.
 */
const ACTION_LABELS: Record<ActionId, string> = {
  create_match: "CREATE MATCH",
  commit: "COMMIT",
  fund: "FUND STAKE",
  anchor_claim: "ANCHOR CLAIM",
  propose_price: "PROPOSE DEAL PRICE",
  reveal: "REVEAL CONSTRAINT",
  adjudicate: "SUMMON THE JURY",
  claim: "CLAIM",
  claim_sink: "SINK CLAIM",
  refund_before_lock: "REFUND STAKES",
  force_settle: "FORCE SETTLEMENT",
  propose_sink: "PROPOSE SINK TRANSFER",
  accept_sink: "ACCEPT SINK ROLE",
};

/** Rough, and rounded down, because the exact second is not the point. */
function elapsed(since: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

/** 0x1234abcd...9876fedc, long enough to match against an explorer listing. */
function shortHash(hash: string): string {
  if (hash.length < 22) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

/**
 * What a returning user sees in place of the form they already filled in.
 *
 * The contract has not registered the change yet, so every panel that reads
 * state alone would happily offer the action again. It is the journal that
 * knows better, and this is what it has to say: there is a transaction out
 * there, here is its hash, go and look at it, and do not send another one.
 */
export default function InFlightNotice({
  inFlight,
  onDismiss,
}: {
  inFlight: InFlight;
  onDismiss: () => void;
}) {
  const url = inFlight.hash ? explorerTxUrl(inFlight.hash) : null;

  return (
    <div className="panel-form inflight">
      <div className="inflight-head">
        <span className="inflight-flag">TRANSACTION IN FLIGHT</span>
        <span className="inflight-what">{ACTION_LABELS[inFlight.actionId]}</span>
      </div>

      <p className="turn-hint">
        You signed this {elapsed(inFlight.startedAt)} from this browser and the
        contract has not registered it yet. That is normal on Bradbury, where a
        transaction can sit for several minutes while validators are replaced.
        The form is hidden on purpose: <strong>do not send it again</strong>.
      </p>

      {inFlight.hash ? (
        <p className="inflight-tx">
          <span className="inflight-tx-label">tx</span>
          <code>{shortHash(inFlight.hash)}</code>
          {url ? (
            <a className="inflight-link" href={url} target="_blank" rel="noreferrer">
              CHECK THE EXPLORER
            </a>
          ) : null}
        </p>
      ) : (
        <p className="inflight-tx inflight-tx--nohash">
          The transaction hash was not recorded before this page reloaded, so
          there is no link to follow. The check below still applies.
        </p>
      )}

      <p className="turn-hint turn-hint--muted">
        This panel is still reading get_match every few seconds. The moment the
        change appears on-chain it clears itself and the match moves on, with
        nothing more for you to do. If the explorer says the transaction is
        gone, drop it here and the action comes back as a retry.
      </p>

      <button className="act act--retry" onClick={onDismiss}>
        THIS ONE IS DEAD, LET ME RESEND
      </button>
    </div>
  );
}

