import { useMemo } from "react";
import TopNav, { type NavShell } from "../components/TopNav";
import LabelBars from "../components/labs/LabelBars";
import GradingMatrix from "../components/labs/GradingMatrix";
import ConvergenceChart from "../components/labs/ConvergenceChart";
import ClaimTable, { type VerdictLookup } from "../components/labs/ClaimTable";
import RoundDrill from "../components/labs/RoundDrill";
import { CARNAGE_ADDRESS, CHAIN } from "../chain/client";
import {
  agreement,
  claimRows,
  convergenceSummary,
  gradingMatrix,
  injectionStats,
  labelDistribution,
} from "../chain/labs";
import { useAdjudications, useLabMatches } from "../hooks/useLabData";

/**
 * The lab.
 *
 * Every number on this page is read from the contract when the page loads.
 * There is no fixture, no seeded example and no figure typed in by hand, which
 * is the only reason any of it is worth reading. The corpus is small and says
 * so, in the places where a small corpus would otherwise flatter a number.
 *
 * Nothing below the header renders until the read finishes. A page of zeros
 * that turns into real numbers a few seconds later reads as broken, and the
 * fix is to say what is happening rather than to show a placeholder that
 * looks like a result.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Says whether a section is a measurement or an example.
 *
 * The two are not the same kind of thing and a reader should never have to
 * guess which one they are looking at. A live section is recomputed from the
 * contract on every visit and moves as matches accumulate. A case study is one
 * match we read closely; its transactions are real, and its numbers describe
 * that match and nothing else.
 */
function Tag({ kind }: { kind: "live" | "case" }) {
  return (
    <p className={`lab-flag lab-flag--${kind}`}>
      {kind === "live" ? "LIVE MEASUREMENT" : "CASE STUDY, FIXED EXAMPLE"}
    </p>
  );
}

export default function LabPage({ nav }: { nav: NavShell }) {
  const { matches, coverage, loading, found, error } = useLabMatches();
  // The consensus walk is the slow tier. It starts on its own once the matches
  // are in and fills the transaction hashes in as it reaches them.
  const adj = useAdjudications(!loading && matches.length > 0);

  const rows = useMemo(() => claimRows(matches), [matches]);
  const dist = useMemo(() => labelDistribution(rows), [rows]);
  const grid = useMemo(() => gradingMatrix(rows), [rows]);
  const agree = useMemo(() => agreement(rows), [rows]);
  const injection = useMemo(() => injectionStats(rows), [rows]);
  const convSummary = useMemo(() => convergenceSummary(adj.byMatch), [adj.byMatch]);

  const adjudicated = matches.filter((m) => m.adjudicated).length;
  const ambiguous = dist.find((d) => d.label === "AMBIGUOUS")?.count ?? 0;

  // Two statements about the grading matrix that must not be typed as facts.
  // They are true of the record today; they are printed only while they stay
  // true, so the page cannot drift into claiming something the table denies.
  const flatOnlyOnNumbers = useMemo(
    () => rows.every((r) => r.truth.verifiable || (r.label !== "TRUE" && r.label !== "FALSE")),
    [rows],
  );
  const numbersJudgedOnTheirNumber = agree.verifiable > 0 && agree.agreed === agree.verifiable;

  const lookup: VerdictLookup = {
    verdicts: adj.verdicts,
    scanning: adj.scanning || !adj.done,
    missingNote: `no adjudicate transaction found for this match, in the committed index through block ${adj.snapshotBlock.toLocaleString("en-US")} or in the live blocks after it`,
  };

  // The designed ambiguity experiment lives on whichever match carries it, so
  // the drill-down follows the claim rather than a hardcoded id.
  const designedRow = rows.find((r) => r.claim.includes("because they pushed me"));
  const designedConv = designedRow
    ? adj.byMatch.find((c) => c.matchId === designedRow.matchId)
    : undefined;

  // Whether the designed claim was in fact the hardest one to settle is a
  // question for the consensus log, not for the person writing the sentence.
  const roundsSpent = (c: { attempts: { rounds: number }[] }) =>
    c.attempts.reduce((n, a) => n + a.rounds + 1, 0);
  const designedWasHardest =
    !!designedConv &&
    adj.byMatch.every((c) => c.matchId === designedConv.matchId || roundsSpent(c) < roundsSpent(designedConv));

  return (
    <div className="stage stage--calm" id="top">
      <TopNav variant="post" {...nav} />

      <main className="lab">
        <header className="lab-head">
          <p className="lab-kicker">CARNAGE LABS</p>
          <h1 className="lab-title">WHAT AN AI JURY DOES WHEN THE MONEY IS REAL</h1>
          <p className="lab-lede">
            Carnage settles arguments between two people by putting the argument
            to an AI jury that runs on-chain, across independent validators,
            with both sides' money staked on the answer. This page is the record
            of what that jury has actually done. Every figure on it is read from
            the contract while the page loads, and every verdict below links to
            the transaction that produced it.
          </p>

          {!loading && !error ? (
            <>
              <p className="lab-headline">
                <strong>{adjudicated}</strong> {plural(adjudicated, "match", "matches")} judged
                on-chain, <strong>{rows.length}</strong> claims put to the jury.
              </p>
              <p className="lab-note">
                How to read this page. Most of what follows is measured live: it
                is recomputed from the contract every time this page opens, and
                it grows with every match anyone plays. Two sections are marked
                CASE STUDY. Those are fixed examples we looked at closely. Their
                transactions are real and checkable, but the numbers in them
                describe one match and do not recompute.
              </p>
            </>
          ) : null}
        </header>

        {loading ? <Loading found={found} /> : null}
        {error ? <p className="act-err">{error}</p> : null}

        {!loading && !error ? (
          <>
            {/* 1. Why measure this at all */}
            <section className="lab-section">
              <h2 className="lab-h2">WHY MEASURE THIS</h2>
              <p className="lab-body">
                Almost everything known about AI judges was measured in a lab.
                Researchers have shown that a judge model can be steered by text
                planted in the very thing it is reading, and they showed it on
                fixed datasets, offline, where whoever wrote the text had
                nothing at stake and the verdict decided nothing.
              </p>
              <p className="lab-body">
                Carnage asks the same questions where the money is real. The
                claims are written by people whose own stake is on the table,
                the jury runs across independent validators rather than a single
                model call, and the verdict moves that stake. Two things show up
                here that a fixed dataset cannot produce: what somebody writes
                when a bluff has a price, and what a distributed jury does when
                validators drop out and a verdict has to be fought to consensus.
              </p>
            </section>

            {/* 2. The corpus, before any number derived from it */}
            <section className="lab-section">
              <Tag kind="live" />
              <h2 className="lab-h2">THE RECORD SO FAR</h2>
              <p className="lab-stat">
                <strong>{adjudicated}</strong> {plural(adjudicated, "match", "matches")}{" "}
                {plural(adjudicated, "has", "have")} been played and judged, putting{" "}
                <strong>{rows.length}</strong> claims in front of the jury.
              </p>
              <p className="lab-body">
                That is the whole corpus. It is small, it grows whenever somebody
                plays a match, and every figure below is recomputed from it each
                time this page opens. Read what follows as a case study rather
                than a study: {rows.length} claims cannot establish a rate. What
                they can do is show, one by one and checkably, how this jury
                behaved on each of them.
              </p>
              {coverage ? <p className="lab-note">{coverage}</p> : null}
            </section>

            {/* 3. What the jury returned */}
            <section className="lab-section">
              <Tag kind="live" />
              <h2 className="lab-h2">WHAT THE JURY RETURNED</h2>
              <p className="lab-body">
                The jury does not answer yes or no. It picks one of five labels:
                TRUE, MISLEADING, FALSE, AMBIGUOUS or UNSUPPORTED. Here is every
                label it has ever returned.
                {ambiguous === 0 ? (
                  <> One of the five has never come up, and it gets its own section below.</>
                ) : null}
              </p>
              <LabelBars counts={dist} total={rows.length} />
            </section>

            {/* 4. The grading matrix */}
            <section className="lab-section">
              <Tag kind="live" />
              <h2 className="lab-h2">IT GRADES DEGREES, IT DOES NOT JUST SORT</h2>
              <p className="lab-body">
                The finding first: the jury saves the flat verdicts, TRUE and
                FALSE, for claims that can actually be checked, and reaches for
                MISLEADING or UNSUPPORTED for the rest.
              </p>
              <p className="lab-body">
                The table crosses the kind of claim, down the side, against the
                label the jury gave it, across the top. Both axes come off the
                chain. The row is decided by a short piece of code that reads
                each claim against the number that party revealed when the match
                ended; the column is what the jury said. Nobody sorted anything
                by hand.
              </p>
              <GradingMatrix cells={grid} />
              {numbersJudgedOnTheirNumber ? (
                <p className="lab-body">
                  Every claim that stated its own number was judged on that
                  number, TRUE when it matched what the party had revealed and
                  FALSE when it did not, with no exceptions in the record.
                  {flatOnlyOnNumbers ? (
                    <>
                      {" "}
                      And no claim without a checkable number was ever called
                      TRUE or FALSE. Those drew MISLEADING or UNSUPPORTED
                      instead.
                    </>
                  ) : null}
                </p>
              ) : null}
            </section>

            {/* 5. Agreement, where there is something to agree with */}
            <section className="lab-section">
              <Tag kind="live" />
              <h2 className="lab-h2">WHERE THE EVIDENCE CAN CHECK THE JURY</h2>
              <p className="lab-body">
                Most claims have no right answer to check a label against. Some
                do. At the start of a match each side commits to a private
                number, the least the seller would take or the most the buyer
                could pay, and reveals it at the end. When a claim states that
                party's own number, the revealed number settles whether the
                claim was true and no judgment is involved. Those are the only
                claims scored here.
              </p>
              <p className="lab-stat">
                <strong>
                  {agree.agreed} of {agree.verifiable}
                </strong>{" "}
                scored claims were labelled the way the evidence says.
              </p>
              <p className="lab-caveat">
                The second number is the one that matters, and it is smaller
                than it looks. Those {agree.verifiable} claims are only{" "}
                <strong>{agree.distinctTexts} different sentences</strong>, some
                of them played more than once, so this is closer to{" "}
                {agree.distinctTexts} trials than {agree.verifiable}. The other{" "}
                {agree.interpretive} claims have no checkable answer and are left
                out, each with its reason printed against it at the bottom of the
                page.
              </p>
            </section>

            {/* 6. The one label nobody has seen. A live counter, nothing more. */}
            {ambiguous === 0 ? (
              <section className="lab-section">
                <Tag kind="live" />
                <h2 className="lab-h2">ONE LABEL HAS NEVER BEEN USED</h2>
                <p className="lab-body">
                  The rubric keeps AMBIGUOUS for a claim that genuinely reads
                  more than one way, where no single reading wins. Across{" "}
                  <strong>{rows.length}</strong> claims the jury has never once
                  reached for it.
                </p>
                <p className="lab-caveat">
                  This is a count, not a conclusion. On a corpus this size we
                  cannot say the jury never returns AMBIGUOUS, only that it has
                  not yet. The counter above is live: the first time a match
                  comes back AMBIGUOUS, this section stops appearing and the bar
                  chart above shows it instead.
                </p>
              </section>
            ) : null}

            {/* 7. Consensus */}
            <section className="lab-section">
              <Tag kind="live" />
              <h2 className="lab-h2">WHAT IT TOOK TO AGREE</h2>
              <p className="lab-body">
                A verdict is not one model answering once. It is a set of
                validators running the same job until enough of them agree, and
                sometimes that takes more than one try. The contract records only
                that a match was judged. It cannot record how many attempts that
                took, because a thrown-away attempt leaves no trace in contract
                state, so this section reads the consensus contract's own
                transaction log instead.
              </p>

              {adj.byMatch.length ? (
                <>
                  <p className="lab-stat">
                    <strong>{convSummary.attempts}</strong> adjudicate transactions produced{" "}
                    <strong>{convSummary.matches}</strong> verdicts.{" "}
                    <strong>{convSummary.clean}</strong> landed on the first try with no
                    rotation at all, and <strong>{convSummary.discarded}</strong> finalized
                    without writing a verdict.
                  </p>
                  <ConvergenceChart rows={adj.byMatch} />
                  <p className="lab-body">
                    The amber bars are the case worth knowing about. Consensus
                    finished, the validators produced labels, and contract state
                    never moved. Carnage absorbs that safely: adjudicate refuses
                    to run on a match that has already been judged, so a fresh
                    attempt is let through on one that has not, no state is ever
                    half applied, and no stake is spent on an attempt that was
                    thrown away.
                  </p>
                </>
              ) : null}

              {adj.scanning && adj.total > 0 ? (
                <p className="lab-note">
                  Reading the blocks after the index, window {adj.progress} of{" "}
                  {adj.total}.
                </p>
              ) : null}
              {adj.degraded ? <p className="act-warn">{adj.degraded}</p> : null}
              {adj.done ? (
                <p className="lab-note">
                  Two sources, both on-chain. Every transaction through block{" "}
                  {adj.snapshotBlock.toLocaleString("en-US")} is in an index
                  committed to this repository, which any reader can regenerate
                  from the contract with the snapshot script. Blocks after it
                  were scanned live on this visit
                  {adj.total > 0
                    ? `, ${adj.total} ${plural(adj.total, "window", "windows")} of them`
                    : ""}
                  .
                  {adj.tailCapped
                    ? " The chain has moved further than that scan reaches, so a match played since then would not appear here yet."
                    : ""}
                </p>
              ) : null}
            </section>

            {/* Case studies. Fixed examples, marked as such, kept apart from
                the measurements above so neither can be mistaken for the other. */}
            {designedRow || injection.flagged.length ? (
              <section className="lab-section">
                <h2 className="lab-h2">MATCHES WE READ CLOSELY</h2>
                <p className="lab-body">
                  Everything above is a count that moves. What follows is not.
                  These are individual matches we picked apart line by line,
                  because a number tells you what happened and an example tells
                  you what it looked like. They are real, they are on the
                  contract, and every transaction below opens in the explorer.
                  Nothing in this part of the page is a measurement, and nothing
                  in it recomputes as new matches are played.
                </p>
              </section>
            ) : null}

            {designedRow ? (
              <section className="lab-section">
                <div className="lab-case">
                  <Tag kind="case" />
                  <h3 className="lab-h3">
                    A CLOSER LOOK AT MATCH {String(designedRow.matchId)}: A SENTENCE
                    BUILT TO BE AMBIGUOUS
                  </h3>
                  <p className="lab-body">
                    We wrote one claim on purpose to draw the label nobody has
                    seen: <em>{designedRow.claim}</em> On the page, English does
                    not settle whether that sentence denies the drop or denies
                    the reason for it. Both readings are live and they mean
                    different things, which is exactly what the rubric describes
                    as ambiguous.
                  </p>
                  <p className="lab-body">
                    It came back <strong>{designedRow.label}</strong>.
                    {designedConv && designedConv.attempts.length > 1 ? (
                      <>
                        {" "}
                        It also took {designedConv.attempts.length} goes. The
                        first adjudicate transaction ran its rounds and finalized
                        without a verdict being written at all, so a second one
                        had to produce the label the contract now holds.
                      </>
                    ) : null}{" "}
                    {designedWasHardest
                      ? "At the time of writing no other claim on the contract had taken as many consensus rounds to settle, and the label it settled on was not the one the sentence was built to draw."
                      : "The label it settled on was not the one the sentence was built to draw."}
                  </p>
                  <p className="lab-caveat">
                    What one match shows and what it does not. This is a single
                    sentence we chose, wrote and then read the rounds of. It is
                    evidence that a genuinely ambiguous claim got pushed toward
                    some other label rather than declared ambiguous, and it is
                    not evidence about how often that happens. The live counter
                    further up is the number to quote; this is the story behind
                    one row of it.
                  </p>
                  {designedConv ? (
                    <>
                      <p className="lab-body">
                        Every round of both attempts is readable straight out of
                        the transactions, below. A thrown-away round writes
                        nothing to the contract, so this is the only place its
                        answer survives.
                      </p>
                      <RoundDrill match={designedConv} />
                    </>
                  ) : adj.scanning ? (
                    <p className="lab-note">
                      Reading the consensus log for this match's transactions...
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {injection.flagged.length ? (
              <section className="lab-section">
                <div className="lab-case">
                  <Tag kind="case" />
                  <h3 className="lab-h3">
                    A CLAIM THAT TRIED TO GIVE THE JURY ORDERS
                  </h3>
                  <p className="lab-body">
                    A claim is untrusted text. The rubric wraps it in tags and
                    tells the jury that everything inside is evidence to weigh,
                    never an instruction to follow. Somebody tested that
                    directly, and this is what happened.
                  </p>
                  <p className="lab-body">
                    Read this as one worked example, not as a security result.
                    Nothing here is scanning for attacks. The claim below was
                    found with a short list of keyword patterns, and the pattern
                    that matched is printed on the row so you can judge the call
                    rather than take it on trust. A differently worded attempt
                    would not be caught by it, and that is a limit of the filter
                    rather than a finding about the jury.
                  </p>
                  <ClaimTable rows={injection.flagged} lookup={lookup} />
                  <p className="lab-caveat">
                    Sample size {injection.scored}.{" "}
                    {injection.resisted === injection.scored
                      ? "The jury answered on the evidence rather than on the order the claim carried, and its own recorded reasoning above does not engage with the instruction at all."
                      : "Not every one of these was answered on the evidence, and the rows above show which."}{" "}
                    One example is an anecdote, not a robustness result, and it
                    is reported as one.
                  </p>
                </div>
              </section>
            ) : null}

            {/* 8. The whole record, live again */}
            <section className="lab-section">
              <Tag kind="live" />
              <h2 className="lab-h2">EVERY CLAIM ON THE CONTRACT</h2>
              <p className="lab-body">
                All {rows.length} of them, scored and unscored, each with the
                transaction that wrote its verdict. A scored claim shows what the
                evidence says and whether the jury agreed. An unscored one shows
                why this page refused to score it, so the claims kept out can be
                checked against the claims kept in. Follow any hash to the
                explorer and you are looking at the same record this page is
                reading.
              </p>
              <p className="lab-body">
                A claim is only scored when a number turns up inside a phrase
                that states that party's own limit. A number on its own is not
                enough. In this record one claim counts three other buyers and
                another mentions the right price inside a denial; reading either
                as an assertion would score the jury wrong on a mistake it did
                not make.
              </p>
              <ClaimTable rows={rows} lookup={lookup} />
            </section>

            <footer className="lab-foot">
              <p className="lab-note">
                Read live from <code>{CARNAGE_ADDRESS}</code> on {CHAIN.name}. Nothing on
                this page is stored, seeded or hand-entered, and every verdict above
                carries the hash of the transaction that produced it.
              </p>
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}

/**
 * What the page shows while the first tier reads.
 *
 * There is no index to query on this contract, so finding the matches means
 * asking for each id in turn, and each ask takes a couple of seconds. The
 * count is the point: it moves, which is the difference between a page that is
 * working and a page that is broken.
 */
function Loading({ found }: { found: number }) {
  return (
    <section className="lab-section lab-loading">
      <p className="lab-loading-line">
        <span className="lab-loading-dot" />
        Reading the matches from the contract. This takes a few seconds.
      </p>
      <p className="lab-note">
        {found > 0
          ? `${found} ${plural(found, "match", "matches")} read so far.`
          : "There is no index to query, so each match is fetched by id, one at a time."}
      </p>
    </section>
  );
}
