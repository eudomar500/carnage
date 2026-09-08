import type { Label, MatchState } from "../chain/contract";
import { consequenceText, RUBRIC, settlementSplit } from "../chain/rubric";
import { formatToken, TOKEN_SYMBOL } from "../lib/format";
import Outcomes from "./Outcomes";

/** Which side of this match, if any, drew a given label. */
function tagsFor(match: MatchState | null, label: Label): string[] {
  if (!match || !match.adjudicated) return [];
  const tags: string[] = [];
  if (match.holder_label === label) tags.push("HOLDER");
  if (match.buyer_label === label) tags.push("BUYER");
  return tags;
}

/**
 * The closed five-label enum, in the order the judge applies it.
 *
 * The stake column is computed by the same function the replay uses, so the
 * numbers a visitor reads here are the numbers that will actually move. When
 * a match is loaded, the column is denominated in that match's real stake
 * rather than left as percentages.
 */
export default function Rubric({ match }: { match: MatchState | null }) {
  const stake = match ? match.stake_amount : null;

  return (
    <section className="doc" id="rubric">
      <div className="doc-head">
        <h2 className="doc-title">RUBRIC</h2>
        <p className="doc-lede">
          The jury returns exactly one of five labels per claim. It is an
          ordered decision procedure, not a menu: the rules are applied from
          the top and the first one that fits wins. Validators re-derive the
          label independently and compare it, which is why the enum is closed
          and the ordering is explicit. The stored reasoning is never compared.
          {stake !== null
            ? ` Amounts below are this match's stake of ${formatToken(stake)} ${TOKEN_SYMBOL} per side.`
            : null}
        </p>
      </div>

      <div className="rubric-table">
        <div className="rubric-row rubric-row--head">
          <span>RULE</span>
          <span>LABEL</span>
          <span>TEST</span>
          <span>SETTLEMENT</span>
        </div>

        {RUBRIC.map((r) => {
          const tags = tagsFor(match, r.label);
          const split = stake !== null ? settlementSplit(r.label, stake) : null;
          return (
            <div
              key={r.label}
              className={`rubric-row rubric-row--${r.label.toLowerCase()}${tags.length ? " rubric-row--on" : ""}`}
            >
              <span className="rubric-rule">{r.rule}</span>
              <span className="rubric-label">
                {r.label}
                {tags.map((t) => (
                  <em key={t} className="rubric-tag">{t}</em>
                ))}
              </span>
              <span className="rubric-test">
                {r.test}
                <em className="rubric-note">{r.note}</em>
              </span>
              <span className="rubric-settle">
                {consequenceText(r.label)}
                {split ? (
                  <em className="rubric-amounts">
                    keeps {formatToken(split.agent)} | slashed {formatToken(split.counterparty)} {TOKEN_SYMBOL}
                  </em>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      <p className="rubric-foot">
        The system classifies the claim, never the agent's intent. A verdict
        says "this claim is MISLEADING", not "this agent tried to deceive".
        That distinction is what makes the verdict defensible, and it is
        written into the adjudication prompt itself. The deal price is never
        rewritten: the label picks the penalty, and that is the only lever.
        A slashed portion normally crosses to the counterparty. Where both
        sides drew an adverse label it goes to the protocol sink instead,
        since crossing equal penalties between two liars would cancel out and
        pay them what two honest players get.
      </p>

      <Outcomes />
    </section>
  );
}
