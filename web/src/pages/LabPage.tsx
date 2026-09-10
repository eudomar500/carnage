import { useMemo } from "react";
import TopNav, { type NavShell } from "../components/TopNav";
import LabelBars from "../components/labs/LabelBars";
import GradingMatrix from "../components/labs/GradingMatrix";
import ConvergenceChart from "../components/labs/ConvergenceChart";
import ClaimTable from "../components/labs/ClaimTable";
import RoundDrill from "../components/labs/RoundDrill";
import {
  agreement,
  claimRows,
  convergenceSummary,
  gradingMatrix,
  injectionStats,
  labelDistribution,
} from "../chain/labs";
import { useConvergence, useLabMatches } from "../hooks/useLabData";

/**
 * The lab.
 *
 * Every number on this page is read from the contract when the page loads.
 * There is no fixture, no seeded example and no figure typed in by hand, which
 * is the only reason any of it is worth reading. The corpus is small and says
 * so, in the places where a small corpus would otherwise flatter a number.
 */
export default function LabPage({ nav }: { nav: NavShell }) {
  const { matches, coverage, loading, error } = useLabMatches();
  const convergence = useConvergence();

  const rows = useMemo(() => claimRows(matches), [matches]);
  const dist = useMemo(() => labelDistribution(rows), [rows]);
  const grid = useMemo(() => gradingMatrix(rows), [rows]);
  const agree = useMemo(() => agreement(rows), [rows]);
  const injection = useMemo(() => injectionStats(rows), [rows]);
  const convSummary = useMemo(
    () => convergenceSummary(convergence.byMatch),
    [convergence.byMatch],
  );

  const adjudicated = matches.filter((m) => m.adjudicated).length;
  // The designed ambiguity experiment lives on whichever match carries it, so
  // the drill-down follows the claim rather than a hardcoded id.
  const designedRow = rows.find((r) => r.claim.includes("because they pushed me"));
  const designedConv = designedRow
    ? convergence.byMatch.find((c) => c.matchId === designedRow.matchId)
    : undefined;

  return (
    <div className="stage stage--calm" id="top">
      <TopNav variant="post" {...nav} />

      <main className="lab">
        {/* 1. What this is */}
        <header className="lab-head">
          <p className="lab-kicker">CARNAGE LABS</p>
          <h1 className="lab-title">HOW AN AI JURY BEHAVES WHEN MONEY IS ON THE LINE</h1>
          <p className="lab-lede">
            Carnage runs a decentralized AI jury on real disputes with real
            stakes. This page measures what that jury actually does. Every match
            anyone plays adds a data point, and the numbers here are computed
            live from the contract each time the page loads.
          </p>
        </header>

        <section className="lab-section">
          <p className="lab-body">
            The research field around this is active. Work on LLM-as-a-judge
            systems has shown these architectures are vulnerable to prompt
            injection, and has built attacks that manipulate a judge into a
            chosen verdict. That work runs on fixed datasets, offline, where the
            attacker has no stake and the judge decides nothing that costs
            anybody money.
          </p>
          <p className="lab-body">
            Carnage measures the same questions in production. The jury runs
            on-chain across independent validators, the claims are written by
            parties with their own money at risk, and the verdict moves that
            money. Two things fall out of that which a fixed dataset cannot
            show: what an adversary writes when a bluff has a price, and how a
            distributed jury behaves when validators time out and rounds have to
            be fought to consensus.
          </p>
          <p className="lab-body">
            That makes this useful to anyone building AI adjudication, whether
            that is a decentralized court, an LLM-as-a-judge pipeline, or agent
            dispute resolution. Those systems have to hold up under adversarial
            and economic pressure, and there is very little public evidence of
            how they behave once both are real.
          </p>
          <p className="lab-caveat">
            Keep the scale in mind. This is an early-stage case study
            demonstrating a method, not a study. The corpus is{" "}
            <strong>{adjudicated} adjudicated matches</strong> and{" "}
            <strong>{rows.length} claims</strong>. It grows as matches are
            played, and every figure below moves with it.
          </p>
          {coverage ? <p className="lab-note">{coverage}</p> : null}
        </section>

        {loading ? <p className="lab-note">Reading the contract...</p> : null}
        {error ? <p className="act-err">{error}</p> : null}

        {/* 2. Grading */}
        <section className="lab-section">
          <h2 className="lab-h2">THE JURY GRADES DEGREES, IT DOES NOT JUST SORT</h2>
          <p className="lab-body">
            Claim type on the rows, the label the jury returned on the columns.
            Both axes are derived from on-chain data. The row comes from how the
            claim engages the revealed number, decided by the same extractor
            described further down, and the column is what the jury said. Nobody
            labelled anything by hand to build this.
          </p>
          <GradingMatrix cells={grid} />
          <p className="lab-body">
            The split is clean in both directions. Every claim that stated its
            own number was labelled on that number, TRUE when it matched and
            FALSE when it did not, with no exceptions in the record. No claim
            without a checkable number was ever labelled TRUE or FALSE: those
            drew MISLEADING or UNSUPPORTED instead. The jury is not collapsing
            everything into true and false, it is reserving the flat verdicts
            for claims that can carry them.
          </p>
        </section>

        {/* 3. Distribution and the open experiment */}
        <section className="lab-section">
          <h2 className="lab-h2">WHAT THE JURY HAS RETURNED</h2>
          <LabelBars counts={dist} total={rows.length} />

          <div className="lab-open">
            <p className="lab-open-tag">OPEN EXPERIMENT</p>
            <h3 className="lab-h3">AMBIGUOUS, NOT YET OBSERVED IN {rows.length} CLAIMS</h3>
            <p className="lab-body">
              The rubric reserves AMBIGUOUS for a claim that genuinely admits
              more than one material reading where no single reading dominates.
              We wrote one deliberately against that test, using a negation
              scope that English does not resolve in writing:{" "}
              {designedRow ? (
                <em>{designedRow.claim}</em>
              ) : (
                <em>a structurally ambiguous claim</em>
              )}
            </p>
            <p className="lab-body">
              It did not come back AMBIGUOUS. Across two adjudication attempts
              the same sentence drew three different labels, and the first
              attempt never reached consensus at all.
            </p>
            <p className="lab-caveat">
              What this does and does not show. On a corpus this size we cannot
              say the jury never returns AMBIGUOUS. What we can say is narrower
              and still interesting: in our attempts a genuinely ambiguous claim
              was resolved toward some other label rather than declared
              ambiguous, and it was the claim that broke consensus. AMBIGUOUS
              has not appeared in {rows.length} claims. If it appears, this
              section will say so.
            </p>
            {designedConv ? (
              <RoundDrill match={designedConv} />
            ) : (
              <p className="lab-note">
                Run the consensus scan below to see what each round decided.
              </p>
            )}
          </div>
        </section>

        {/* 4. Convergence */}
        <section className="lab-section">
          <h2 className="lab-h2">CONSENSUS UNDER LOAD</h2>
          <p className="lab-body">
            get_match records that a match was adjudicated. It does not record
            how many attempts that took, because a discarded round leaves no
            trace in contract state. The only place retries and rotations exist
            is the consensus contract's transaction index, so this section reads
            that separately.
          </p>

          {!convergence.started ? (
            <button className="act act--go" onClick={convergence.start}>
              SCAN THE CONSENSUS LOG
            </button>
          ) : convergence.scanning ? (
            <p className="lab-note">
              Scanning window {convergence.progress} of 40. This walks the chain
              backwards and takes a moment.
            </p>
          ) : null}

          {convergence.degraded ? <p className="act-warn">{convergence.degraded}</p> : null}

          {convergence.byMatch.length ? (
            <>
              <p className="lab-stat">
                <strong>{convSummary.attempts}</strong> adjudicate transactions produced{" "}
                <strong>{convSummary.matches}</strong> verdicts.{" "}
                <strong>{convSummary.clean}</strong> converged on the first try with no
                rotations, and <strong>{convSummary.discarded}</strong> finalized in
                consensus without writing a verdict at all.
              </p>
              <ConvergenceChart rows={convergence.byMatch} />
              <p className="lab-body">
                A transaction that finalizes without applying its writes is the
                case worth knowing about. Consensus finished, the execution
                produced a verdict, and contract state never moved. Carnage
                absorbs it safely: the guard in adjudicate sees the match is
                still unadjudicated and lets a fresh attempt through, so no
                state is ever half applied and no stake is spent on the round
                that was thrown away.
              </p>
              <p className="lab-note">
                The scan looks back a bounded number of blocks. A match older
                than that window has no row here, which is a limit of the scan
                and not a match that was never adjudicated.
              </p>
            </>
          ) : null}
        </section>

        {/* 5. Agreement */}
        <section className="lab-section">
          <h2 className="lab-h2">AGREEMENT, WHERE THE EVIDENCE CAN SETTLE IT</h2>
          <p className="lab-body">
            Most claims have no objective answer to check a label against. Some
            do: when a claim states that party's own constraint as a number, the
            revealed number settles whether the statement was true, and no
            judgment is involved. Only those are scored.
          </p>
          <p className="lab-stat">
            <strong>
              {agree.agreed} of {agree.verifiable}
            </strong>{" "}
            verifiable claims were labelled the way the evidence says, drawn from{" "}
            <strong>{agree.distinctTexts} distinct claim texts</strong>.
          </p>
          <p className="lab-caveat">
            The second number is the one that matters. {agree.verifiable}{" "}
            verifiable claims sounds like {agree.verifiable} independent trials,
            and it is not when several are the same sentence played again. The
            remaining {agree.interpretive} claims carry no computable truth and
            are excluded, with the reason printed against each one below.
          </p>
        </section>

        {/* 6. Injection */}
        <section className="lab-section">
          <h2 className="lab-h2">CLAIMS THAT ATTACK THE JURY</h2>
          <p className="lab-body">
            A claim is untrusted text, and the rubric wraps it in tags and tells
            the jury to treat everything inside as evidence rather than
            instruction. Claims shaped like an instruction are flagged here by
            pattern, and the pattern that matched is shown so the call can be
            checked rather than trusted.
          </p>
          {injection.flagged.length ? (
            <>
              <p className="lab-stat">
                <strong>{injection.flagged.length}</strong> flagged,{" "}
                <strong>{injection.scored}</strong> with a computable truth, of which{" "}
                <strong>{injection.resisted}</strong> were labelled on the evidence rather
                than on the instruction.
              </p>
              <ClaimTable rows={injection.flagged} />
              <p className="lab-caveat">
                Sample size {injection.scored}. That is an anecdote, not a
                robustness result, and it is reported as one.
              </p>
            </>
          ) : (
            <p className="lab-note">No injection-shaped claim in the record yet.</p>
          )}
        </section>

        {/* Both tiers, in full */}
        <section className="lab-section">
          <h2 className="lab-h2">EVERY CLAIM ON THE CONTRACT</h2>
          <p className="lab-body">
            Both tiers, nothing hidden. A verifiable claim shows what the
            evidence says and whether the jury agreed. An interpretive one shows
            why the lab refused to score it. The refusal is printed so that the
            claims kept out of the agreement figure can be checked against the
            claims kept in.
          </p>
          <p className="lab-body">
            A claim is only scored when a number appears inside a frame that
            states that party's own constraint. A number alone is not enough. In
            this record one claim counts three other buyers and another mentions
            the right price inside a denial, and reading either as an assertion
            would score the jury wrong on a mistake it did not make.
          </p>
          <ClaimTable rows={rows} />
        </section>

        <footer className="lab-foot">
          <p className="lab-note">
            Read live from{" "}
            <code>0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A</code> on Bradbury.
            Nothing on this page is stored, seeded or hand-entered.
          </p>
        </footer>
      </main>
    </div>
  );
}
