import type { ClaimRow } from "../../chain/labs";

/**
 * Every claim on the contract, in both tiers.
 *
 * Nothing is hidden and nothing is quietly dropped. A verifiable claim shows
 * what the evidence says and whether the jury agreed. An interpretive one
 * shows the reason the lab refused to score it, in the same table, so a reader
 * can check that the excluded claims are excluded for a stated reason rather
 * than because they would have spoiled the number.
 */
export default function ClaimTable({ rows }: { rows: ClaimRow[] }) {
  return (
    <div className="lab-claims">
      {rows.map((r) => {
        const key = `${r.matchId}-${r.role}`;
        const verifiable = r.truth.verifiable;
        return (
          <div
            className={`lab-claim${verifiable ? " lab-claim--scored" : ""}`}
            key={key}
          >
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

            {r.reasoning ? (
              <p className="lab-claim-reasoning">{r.reasoning}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
