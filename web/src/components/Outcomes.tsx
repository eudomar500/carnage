import { OUTCOMES, outcomeEndText, outcomePercents } from "../chain/rubric";

/** Level, down, or up against the stake this side posted. */
function tone(percent: number): string {
  if (percent === 100) return "even";
  return percent < 100 ? "down" : "up";
}

/**
 * The rubric applied to both sides at once.
 *
 * This sits under RUBRIC, and the split of labour between them is the point:
 * RUBRIC is the general rule, one claim at a time, and this is the rule run
 * twice and composed. So nothing here re-explains what a label means. It says
 * who walks away with what, and every number is computed from the same
 * settlementSplit the rubric column uses.
 */
export default function Outcomes() {
  return (
    <div className="outcomes" id="outcomes">
      <h3 className="outcomes-title">HOW A MATCH CAN END</h3>
      <p className="doc-lede">
        Every match lands in one of these. The jury labels each claim on its
        own, and settlement runs the same rule once per side, so a match
        result is nothing more than the two labels composed. Percentages are
        of the stake that side posted: 100% is level, above it is the other
        side's slashed stake coming across.
      </p>

      <div className="outcome-table">
        <div className="outcome-row outcome-row--head">
          <span>SIDE A + SIDE B</span>
          <span>CASE</span>
          <span>SIDE A ENDS WITH</span>
          <span>SIDE B ENDS WITH</span>
        </div>

        {OUTCOMES.map((o) => {
          const split = o.pair ? outcomePercents(o.pair) : null;
          return (
            <div key={o.key} className={`outcome-row${o.pair ? "" : " outcome-row--none"}`}>
              <span className="outcome-pair">
                {o.pair ? (
                  o.pair.flatMap((label, i) => {
                    const chip = (
                      <span key={label + String(i)} className={`outcome-label outcome-label--${label.toLowerCase()}`}>
                        {label}
                      </span>
                    );
                    // An equally-settling alternative sits beside side A,
                    // separated by "or" rather than the "+" that joins the two
                    // sides of a pair.
                    if (i !== 0 || !o.alt) return [chip];
                    return [
                      chip,
                      <span
                        key={`${o.alt}-alt`}
                        className={`outcome-label outcome-label--${o.alt.toLowerCase()} outcome-label--alt`}
                      >
                        {o.alt}
                      </span>,
                    ];
                  })
                ) : (
                  <span className="outcome-label outcome-label--void">NONE STORED</span>
                )}
              </span>

              <span className="outcome-case">
                {o.title}
                {split && split.sink > 0 ? (
                  <em className="outcome-side-note">
                    {split.sink}% of one stake goes to the protocol sink, not across
                  </em>
                ) : null}
              </span>

              {split ? (
                <>
                  <span className="outcome-side">
                    <em className="outcome-side-key">SIDE A</em>
                    <b className={`outcome-num outcome-num--${tone(split.a)}`}>{split.a}%</b>
                    <em className="outcome-side-note">{outcomeEndText(split.a)}</em>
                  </span>
                  <span className="outcome-side">
                    <em className="outcome-side-key">SIDE B</em>
                    <b className={`outcome-num outcome-num--${tone(split.b)}`}>{split.b}%</b>
                    <em className="outcome-side-note">{outcomeEndText(split.b)}</em>
                  </span>
                </>
              ) : (
                <span className="outcome-void">
                  Deterministic, with no jury verdict to compose. Who ends up
                  with what is under{" "}
                  <a href="#no-verdict">WHEN THERE IS NO VERDICT</a>.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
