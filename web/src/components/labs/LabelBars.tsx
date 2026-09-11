import type { LabelCount } from "../../chain/labs";

/**
 * Label distribution across every claim on the contract.
 *
 * Bar width is the label's share of the corpus, so the track reads as a
 * percentage of all claims and the printed figure says the same thing. Scaling
 * to the largest count instead would draw a bar at full width for a label that
 * covers half the record.
 *
 * A label with no observations keeps its row rather than dropping out. An
 * absent bar is the finding for AMBIGUOUS, and a chart that hid empty rows
 * would hide exactly the thing worth looking at.
 */
export default function LabelBars({
  counts,
  total,
}: {
  counts: LabelCount[];
  total: number;
}) {
  return (
    <div className="lab-bars">
      {counts.map(({ label, count }) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div className="lab-bar" key={label}>
            <span className="lab-bar-name">{label}</span>
            <span className="lab-bar-track">
              <span
                className={`lab-bar-fill lab-bar-fill--${label.toLowerCase()}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="lab-bar-count">{count}</span>
            <span className="lab-bar-pct">{pct.toFixed(1)}% of {total}</span>
            {count === 0 ? (
              <span className="lab-bar-note">not yet observed in {total} claims</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
