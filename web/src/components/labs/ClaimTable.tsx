import { explorerTxUrl } from "../../chain/txlog";
import type { Attempt, ClaimRow } from "../../chain/labs";

/**
 * What the page knows about which transaction wrote each verdict.
 *
 * The lookup is keyed by match id in decimal and fills in while the consensus
 * walk runs, so a row can be waiting, resolved, or out of the walk's reach.
 * All three states are shown. A hash that has not arrived yet says so rather
 * than leaving a blank a reader would have to interpret.
 */
export type VerdictLookup = {
  verdicts: Map<string, Attempt>;
  scanning: boolean;
  /** Shown against a match the finished walk never found a transaction for. */
  missingNote: string;
};

/**
 * Every claim on the contract, in both tiers, each with its own proof.
 *
 * Nothing is hidden and nothing is quietly dropped. A verifiable claim shows
 * what the evidence says and whether the jury agreed. An interpretive one
 * shows the reason the lab refused to score it, in the same table, so a reader
 * can check that the excluded claims are excluded for a stated reason rather
 * than because they would have spoiled the number.
 *
 * Every row also carries the hash of the transaction that wrote its label. A
 * verdict nobody can look up is just an assertion on a web page, and both
 * labels in a match come from the same adjudicate call, which is why the two
 * rows of a match show the same hash.
 */
export default function ClaimTable({
  rows,
  lookup,
}: {
  rows: ClaimRow[];
  lookup?: VerdictLookup;
}) {
  const anyScored = rows.some((r) => r.truth.verifiable);

  return (
    <div className="lab-claims">
      {anyScored ? (
        <p className="lab-claims-legend">
          A <strong>direct</strong> frame names the constraint and gives its value:
          "My minimum price is 650." A <strong>bound</strong> frame states a limit
          the party will not cross, which asserts the same thing from the other
          side: "I can't go below 780." Those are the only two shapes this page
          scores.
        </p>
      ) : null}
      {rows.map((r) => {
        const key = `${r.matchId}-${r.role}`;
        const verifiable = r.truth.verifiable;
        return (
          <div className={`lab-claim${verifiable ? " lab-claim--scored" : ""}`} key={key}>
            <div className="lab-claim-head">
              <span className="lab-claim-id">#{String(r.matchId)}</span>
              <span className="lab-claim-role">{r.role.toUpperCase()}</span>
              <span className="lab-claim-revealed">revealed {String(r.revealed)}</span>
              <span className={`lab-claim-label lab-claim-label--${r.label.toLowerCase()}`}>
                {r.label}
              </span>
              {r.injection ? (
                <span className="lab-claim-flag">INJECTION SHAPED: {r.injection}</span>
              ) : null}
            </div>

            <blockquote className="lab-claim-text">{r.claim}</blockquote>

            {verifiable ? (
              <p className="lab-claim-verdict">
                <span className="lab-claim-tier">VERIFIABLE</span>
                states {r.truth.asserted} in a {r.truth.frame} frame, so the evidence says{" "}
                <strong>{r.truth.truth}</strong>. The jury said {r.label}:{" "}
                <strong className={r.agrees ? "lab-agree" : "lab-disagree"}>
                  {r.agrees ? "agreement" : "disagreement"}
                </strong>
                .
              </p>
            ) : (
              <p className="lab-claim-verdict">
                <span className="lab-claim-tier lab-claim-tier--open">INTERPRETIVE</span>
                not scored: {r.truth.reason}.
              </p>
            )}

            {r.reasoning ? <p className="lab-claim-reasoning">{r.reasoning}</p> : null}

            {lookup ? <Proof matchId={r.matchId} lookup={lookup} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** The transaction that wrote this match's labels, or an honest note instead. */
function Proof({ matchId, lookup }: { matchId: bigint; lookup: VerdictLookup }) {
  const tx = lookup.verdicts.get(String(matchId));

  if (!tx) {
    return (
      <p className="lab-proof lab-proof--waiting">
        <span className="lab-proof-tag">ON-CHAIN PROOF</span>{" "}
        {lookup.scanning ? "looking up the transaction that wrote this verdict..." : lookup.missingNote}
      </p>
    );
  }

  const url = explorerTxUrl(tx.txId);
  return (
    <p className="lab-proof">
      <span className="lab-proof-tag">ON-CHAIN PROOF</span>{" "}
      written by adjudicate in block {tx.block}, status {tx.statusName}{" "}
      <code className="lab-proof-hash">{tx.txId}</code>
      {url ? (
        <a className="inflight-link" href={url} target="_blank" rel="noreferrer">
          OPEN IN THE EXPLORER
        </a>
      ) : null}
    </p>
  );
}
