import { explorerTxUrl } from "../../chain/txlog";
import type { MatchConvergence } from "../../chain/labs";

/**
 * One row per match, one segment per adjudicate transaction.
 *
 * Segment width is the transaction's round count plus one, scaled to the
 * longest attempt on the chart, so a verdict settled on the first pass is a
 * stub and one that ran through rotations is long. The plus one is what keeps
 * a zero-round attempt visible at all.
 *
 * A transaction that finalized without its verdict being applied is drawn
 * striped and carries an x in the segment, so applied and discarded are
 * distinguishable without relying on colour. That distinction is invisible in
 * get_match, which records only that a match ended up adjudicated.
 */
export default function ConvergenceChart({ rows }: { rows: MatchConvergence[] }) {
  const widest = Math.max(1, ...rows.flatMap((r) => r.attempts.map((a) => a.rounds + 1)));

  return (
    <div className="lab-conv">
      {rows.map((row) => (
        <div className="lab-conv-row" key={String(row.matchId)}>
          <span className="lab-conv-id">#{String(row.matchId)}</span>
          <span className="lab-conv-track">
            {row.attempts.map((a) => {
              const width = ((a.rounds + 1) / widest) * 100;
              const url = explorerTxUrl(a.txId);
              const title = `${a.statusName} | ${a.resultName} | ${a.rounds} rounds | ${
                a.applied ? "verdict applied" : "discarded"
              }`;
              const seg = (
                <span
                  className={`lab-conv-seg${a.applied ? "" : " lab-conv-seg--dropped"}`}
                  style={{ width: `${Math.max(width, 6)}%` }}
                  title={title}
                >
                  {a.applied ? "" : "x"}
                  {a.rounds > 0 ? a.rounds : ""}
                </span>
              );
              return url ? (
                <a key={a.txId} className="lab-conv-link" href={url} target="_blank" rel="noreferrer">
                  {seg}
                </a>
              ) : (
                <span key={a.txId}>{seg}</span>
              );
            })}
          </span>
          <span className="lab-conv-verdict">
            {row.clean
              ? "settled on the first pass"
              : row.discarded === 0
                ? `${row.attempts[0]?.rounds ?? 0} rounds to settle`
                : row.hasVerdict
                  ? `${row.discarded} discarded, then applied`
                  : `${row.discarded} discarded, no verdict written yet`}
          </span>
        </div>
      ))}
      <div className="lab-conv-key">
        <span className="lab-conv-keyitem">
          <span className="lab-conv-swatch" /> verdict applied
        </span>
        <span className="lab-conv-keyitem">
          <span className="lab-conv-swatch lab-conv-swatch--dropped" /> striped and marked x:
          finalized without writing a verdict
        </span>
        <span className="lab-conv-keyitem">
          segment width is the round count plus one, scaled to the longest attempt here
        </span>
      </div>
    </div>
  );
}
