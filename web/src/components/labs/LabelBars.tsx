import type { LabelCount } from "../../chain/labs";

/**
 * Label distribution across every claim on the contract.
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
  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <div className="lab-bars">
      {counts.map(({ label, count }) => {
        const pct = (count / max) * 100;
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
            {count === 0 ? (
              <span className="lab-bar-note">not yet observed in {total} claims</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
