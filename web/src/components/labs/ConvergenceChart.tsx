import { explorerTxUrl } from "../../chain/txlog";
import type { MatchConvergence } from "../../chain/labs";

/**
 * One row per match, one segment per adjudicate transaction.
 *
 * Segment width is the number of consensus rounds that transaction burned, so
 * a verdict reached on the first try is a stub and one fought through
 * rotations is long. A segment that finalized without its verdict being
 * applied is amber: consensus finished, and the contract state did not move.
 *
 * That distinction is the whole point of the chart. It is invisible in
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
              const title = `${a.statusName} | ${a.resultName} | ${a.rounds} rounds`;
              const seg = (
                <span
                  className={`lab-conv-seg${a.applied ? "" : " lab-conv-seg--dropped"}`}
                  style={{ width: `${Math.max(width, 6)}%` }}
                  title={title}
                >
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
              ? "converged first try"
              : row.discarded > 0
                ? `${row.discarded} discarded, then applied`
                : `${row.attempts[0]?.rounds ?? 0} rounds to converge`}
          </span>
        </div>
      ))}
      <div className="lab-conv-key">
        <span className="lab-conv-keyitem">
          <span className="lab-conv-swatch" /> verdict applied
        </span>
        <span className="lab-conv-keyitem">
          <span className="lab-conv-swatch lab-conv-swatch--dropped" /> finalized without writing a
          verdict
        </span>
        <span className="lab-conv-keyitem">segment width is consensus rounds</span>
      </div>
    </div>
  );
}
