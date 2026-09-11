import { explorerTxUrl } from "../../chain/txlog";
import type { MatchConvergence } from "../../chain/labs";

/**
 * One row per match, one segment per adjudicate transaction.
 *
 * Segment width is the transaction's round count plus one, scaled so the
 * busiest match fills its track. The scale is per row total rather than per
 * single attempt because every attempt of a match shares one track: scaling to
 * the longest single attempt makes two transactions with the same round count
 * render at different widths depending on how many siblings they sit beside.
 * The plus one is what keeps a zero-round attempt visible at all.
 *
 * A transaction that finalized without its verdict being applied is drawn
 * striped, so applied and discarded are distinguishable without relying on
 * colour. Its label sits on a solid chip laid over the stripes, because a
 * label printed straight onto them is crossed by them and stops being
 * readable. The chip is capped at the segment width, so the narrowest
 * segments show the x and clip the round count. That distinction is invisible
 * in get_match, which records only that a match ended up adjudicated.
 */

/**
 * Floor for a segment, shared by both kinds.
 *
 * Percentages are set on the link, which is the flex item; the segment inside
 * fills it. Setting the width on the segment instead leaves it resolving
 * against a shrink-to-fit parent, which collapses every bar to its own text.
 */
const MIN_SEGMENT_PCT = 8;

const roundWord = (n: number) => (n === 1 ? "round" : "rounds");

export default function ConvergenceChart({ rows }: { rows: MatchConvergence[] }) {
  const widestRow = Math.max(
    1,
    ...rows.map((r) => r.attempts.reduce((n, a) => n + a.rounds + 1, 0)),
  );

  return (
    <div className="lab-conv">
      <div className="lab-conv-key">
        <span className="lab-conv-keyitem">
          <span className="lab-conv-swatch" /> verdict applied
        </span>
        <span className="lab-conv-keyitem">
          <span className="lab-conv-swatch lab-conv-swatch--dropped" /> striped and marked x:
          finalized without writing a verdict
        </span>
        <span className="lab-conv-keyitem">
          segment width is the round count plus one, scaled so the busiest match fills its row
        </span>
      </div>
      {rows.map((row) => {
        const discardedRounds = row.attempts
          .filter((a) => !a.applied)
          .reduce((n, a) => n + a.rounds, 0);

        return (
          <div className="lab-conv-row" key={String(row.matchId)}>
            <span className="lab-conv-id">#{String(row.matchId)}</span>
            <span className="lab-conv-track">
              {row.attempts.map((a) => {
                const width = Math.max(((a.rounds + 1) / widestRow) * 100, MIN_SEGMENT_PCT);
                const url = explorerTxUrl(a.txId);
                const title = `${a.statusName} | ${a.resultName} | ${a.rounds} rounds | ${
                  a.applied ? "verdict applied" : "discarded"
                }`;
                const label = a.rounds > 0 ? a.rounds : "";
                const seg = (
                  <span
                    className={`lab-conv-seg${a.applied ? "" : " lab-conv-seg--dropped"}`}
                    title={title}
                  >
                    {a.applied ? (
                      label
                    ) : (
                      <span className="lab-conv-chip">
                        <span className="lab-conv-x">x</span>
                        {label}
                      </span>
                    )}
                  </span>
                );
                const style = { width: `${width}%` };
                return url ? (
                  <a
                    key={a.txId}
                    className="lab-conv-link"
                    style={style}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {seg}
                  </a>
                ) : (
                  <span key={a.txId} className="lab-conv-link" style={style}>
                    {seg}
                  </span>
                );
              })}
            </span>
            <span className="lab-conv-verdict">
              {row.clean
                ? "settled on the first pass"
                : row.discarded === 0
                  ? `${row.attempts[0]?.rounds ?? 0} rounds to settle`
                  : row.hasVerdict
                    ? `${row.discarded} discarded after ${discardedRounds} ${roundWord(discardedRounds)}, then applied`
                    : `${row.discarded} discarded after ${discardedRounds} ${roundWord(discardedRounds)}, no verdict written yet`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
