import type { Label } from "../../chain/contract";
import { CLAIM_KINDS, CLAIM_KIND_LABEL, type GradingCell } from "../../chain/labs";

const LABELS: Label[] = ["TRUE", "MISLEADING", "FALSE", "AMBIGUOUS", "UNSUPPORTED"];

/**
 * Claim type against the label the jury returned.
 *
 * Both axes are derived. The row is how the claim engages the evidence, taken
 * from the extractor's own answer, and the column is what the jury said. If
 * the jury grades degrees rather than sorting claims into true and false, it
 * shows up as a diagonal, and nobody had to label anything by hand for it.
 */
export default function GradingMatrix({ cells }: { cells: GradingCell[] }) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  const at = (kind: string, label: Label) =>
    cells.find((c) => c.kind === kind && c.label === label)?.count ?? 0;

  return (
    <div className="lab-matrix-wrap">
      <table className="lab-matrix">
        <thead>
          <tr>
            <th className="lab-matrix-corner">CLAIM TYPE</th>
            {LABELS.map((l) => (
              <th key={l} className="lab-matrix-col">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CLAIM_KINDS.map((kind) => {
            const row = LABELS.map((l) => at(kind, l));
            const total = row.reduce((a, b) => a + b, 0);
            return (
              <tr key={kind}>
                <th className="lab-matrix-row">
                  {CLAIM_KIND_LABEL[kind]}
                  <span className="lab-matrix-rowcount">{total}</span>
                </th>
                {LABELS.map((l, i) => {
                  const n = row[i];
                  // Intensity by share of the largest cell, so a small corpus
                  // still reads without pretending to a precision it lacks.
                  const alpha = n === 0 ? 0 : 0.15 + (n / max) * 0.65;
                  return (
                    <td
                      key={l}
                      className={`lab-matrix-cell${n ? " lab-matrix-cell--on" : ""}`}
                      style={n ? { background: `rgba(224, 36, 28, ${alpha.toFixed(3)})` } : undefined}
                    >
                      {n || ""}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
