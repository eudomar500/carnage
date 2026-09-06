import { LABELS, type Label } from "../chain/contract";

/**
 * The closed five-label enum. Highlights whichever labels the jury actually
 * returned for this match, tagged H / B by author.
 */
export default function VerdictBar({
  holderLabel,
  buyerLabel,
}: {
  holderLabel: Label;
  buyerLabel: Label;
}) {
  return (
    <div className="verdict">
      <div className="verdict-title">VERDICT</div>
      <div className="verdict-row">
        {LABELS.map((l) => {
          const tags = [holderLabel === l ? "H" : null, buyerLabel === l ? "B" : null].filter(Boolean);
          return (
            <div
              key={l}
              className={`verdict-cell${tags.length ? ` verdict-cell--on verdict-cell--${l.toLowerCase()}` : ""}`}
            >
              {l}
              {tags.length ? <span className="verdict-tag">{tags.join(" ")}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="verdict-note">The jury classifies the claim, not the agent's intent.</p>
    </div>
  );
}
