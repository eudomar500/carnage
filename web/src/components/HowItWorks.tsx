import { BEATS, BRANCHES, isResolved, nextBeatIndex } from "../chain/lifecycle";
import type { MatchState } from "../chain/contract";

/**
 * The lifecycle, explained against the contract that enforces it.
 *
 * With a match loaded this is not a static explainer: each beat is marked
 * from live state, so the same section answers "how does this work" and
 * "where is my match" at once. With no match loaded it degrades to plain
 * reference, which is what a first-time visitor needs.
 */
export default function HowItWorks({ match }: { match: MatchState | null }) {
  const next = match && !isResolved(match) ? nextBeatIndex(match) : -1;

  return (
    <section className="doc" id="how-it-works">
      <div className="doc-head">
        <h2 className="doc-title">HOW IT WORKS</h2>
        <p className="doc-lede">
          Two agents negotiate under private constraints they committed to
          before speaking, then face a jury that reads their claims against
          that committed evidence. Every beat below is a real call on the
          Carnage contract, in the order the contract's own preconditions
          force.
          {match ? " Marks are read from this match." : null}
        </p>
      </div>

      <ol className="beats">
        {BEATS.map((b, i) => {
          const done = match ? b.done(match) : false;
          const now = i === next;
          const state = done ? "done" : now ? "now" : "idle";
          return (
            <li key={b.key} className={`beat beat--${state}`}>
              <div className="beat-head">
                <span className="beat-no">{String(i + 1).padStart(2, "0")}</span>
                <span className="beat-title">{b.title}</span>
                <span className={`beat-venue beat-venue--${b.venue.toLowerCase().replace("-", "")}`}>
                  {b.venue}
                </span>
                {match ? (
                  <span className="beat-mark">
                    {done ? "RECORDED" : now ? "OUTSTANDING" : ""}
                  </span>
                ) : null}
              </div>
              <p className="beat-what">{b.what}</p>
              <div className="beat-meta">
                <span className="beat-who">{b.who}</span>
                {b.methods.length ? (
                  <span className="beat-methods">
                    {b.methods.map((mth) => (
                      <code key={mth}>{mth}</code>
                    ))}
                  </span>
                ) : (
                  <span className="beat-methods beat-methods--none">no contract call</span>
                )}
              </div>
              <p className="beat-gate">
                <span className="beat-gate-key">GATE</span> {b.gate}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="branches" id="no-verdict">
        <h3 className="branches-title">WHEN THERE IS NO VERDICT</h3>
        <p className="doc-lede">
          Two exits skip adjudication entirely. Neither calls GenLayer, and
          neither blames anyone for a lie, because neither is about one.
        </p>
        <div className="branch-grid">
          {BRANCHES.map((br) => {
            const taken = match ? br.taken(match) : false;
            return (
              <div key={br.key} className={`branch${taken ? " branch--taken" : ""}`}>
                <div className="branch-head">
                  <span className="branch-title">{br.title}</span>
                  <code>{br.method}</code>
                  {taken ? <span className="branch-mark">THIS MATCH</span> : null}
                </div>
                <p className="branch-when">
                  <span className="beat-gate-key">WHEN</span> {br.when}
                </p>
                <p className="branch-outcome">{br.outcome}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
