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
 * Two tiers, two sources. Everything derived from a match, which is every
 * claim, label, agreement and grading figure, is read from get_match on the
 * deployed contract when the page loads. Everything about how a verdict was
 * reached comes from the consensus contract's transaction log, served from a
 * committed index through its snapshot block and a live scan of the blocks
 * after it, because the contract cannot record how many attempts a verdict
 * took. No figure is typed in by hand. The corpus is small and says so, in the
 * places where a small corpus would otherwise flatter a number.
 *
 * Nothing below the header renders until the match read finishes. A page of
 * zeros that turns into real numbers a few seconds later reads as broken, and
 * the fix is to say what is happening rather than to show a placeholder that
 * looks like a result.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The two matches this page reads closely, pinned by id.
 *
 * Match 8 carries the holder claim written to draw AMBIGUOUS, and match 2 the
 * only injection-shaped claim on the contract. Both were chosen by hand, so
 * they are selected by id: following a substring would let a later match that
 * happened to share the wording take over a section written about this one.
 */
const AMBIGUITY_CASE = { matchId: 8n, role: "holder" as const };
const INJECTION_CASE = { matchId: 2n, role: "holder" as const };

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

  const designedRow = rows.find(
    (r) => r.matchId === AMBIGUITY_CASE.matchId && r.role === AMBIGUITY_CASE.role,
  );
  const injectionRow = rows.find(
    (r) => r.matchId === INJECTION_CASE.matchId && r.role === INJECTION_CASE.role,
  );
  // The tag is printed once per rendered case section, so the count that
  // announces them is taken from the same two conditions.
  const caseSections = [designedRow, injectionRow].filter(Boolean).length;
  const injectionHeld =
    !!injectionRow && injectionRow.truth.verifiable && injectionRow.agrees === true;
  const designedConv = designedRow
    ? adj.byMatch.find((c) => c.matchId === designedRow.matchId)
    : undefined;

  // Whether that match was in fact the hardest to settle is a question for the
  // consensus log, not for the person writing the sentence. The comparison is
  // per match, because both claims of a match share one adjudicate call.
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
          <h1 className="lab-title">WHAT THE JURY RETURNED, READ FROM THE CONTRACT</h1>
          <p className="lab-lede">
            Carnage is a negotiation game in which each side stakes 0.01 GEN and
            anchors a natural-language claim on-chain. An AI jury running across
            independent validators on GenLayer's Bradbury testnet labels each
            claim against the constraint that side revealed, and the labels move
            the stakes. This page is the record of what that jury returned. Match
            data is read from the contract on every visit; the transaction
            history behind each verdict comes from{" "}
            <a className="lab-inline-link" href="#sources">
              two sources, both on-chain
            </a>
            .
          </p>

          {!loading && !error ? (
            <>
              <p className="lab-headline">
                <strong>{adjudicated}</strong> {plural(adjudicated, "match", "matches")} judged
                on-chain, <strong>{rows.length}</strong> claims put to the jury.
              </p>
              <p className="lab-note">
                How to read this page. Sections marked LIVE MEASUREMENT are
                recomputed from the contract every time this page opens, and
                they move as matches accumulate.{" "}
                {caseSections > 0 ? (
                  <>
                    {caseSections} {plural(caseSections, "section is", "sections are")}{" "}
                    marked CASE STUDY: one match picked by hand and read closely.
                    The choice of match and the commentary are fixed. The label,
                    the attempt count and the transaction links in them are read
                    live like everything else.
                  </>
                ) : null}
              </p>
            </>
          ) : null}
        </header>

        {loading ? <Loading found={found} /> : null}
        {error ? <p className="act-err">{error}</p> : null}

        {!loading && !error ? (
          <>
            {/* 0. How every figure below was produced. */}
            <section className="lab-section">
              <h2 className="lab-h2">METHOD</h2>
              <ul className="lab-method">
                <li>
                  <strong>Corpus.</strong> Every match on the deployed contract,
                  fetched by id through get_match when this page loads, from 1
                  upward until the contract reports an unknown id. Each
                  adjudicated match contributes two claims, one per seat. Both
                  seats stake 0.01 GEN on GenLayer's Bradbury testnet.
                </li>
                <li>
                  <strong>Ground truth.</strong> Each side commits a private
                  number before anyone speaks and reveals it at the end. A claim
                  is scored only when it states that party's own constraint as a
                  number the revealed value settles, either directly ("My minimum
                  price is 650") or as a bound the party will not cross ("I can't
                  go below 780").
                </li>
                <li>
                  <strong>Two judgment calls inside that rule.</strong> A number
                  below one fifth of the band floor or above five times the band
                  ceiling is treated as not a price for this match. A bound that
                  understates the real constraint is literally true and is left
                  unscored as arguable rather than counted either way. Both calls
                  narrow what is scored; neither decides a label.
                </li>
                <li>
                  <strong>Exclusions.</strong> Every unscored claim appears in the
                  table at the bottom with the reason it was not scored, so the
                  claims kept out can be checked against the claims kept in.
                </li>
                <li>
                  <strong>Denominator.</strong> Agreement is reported over scored
                  claims and next to the number of distinct claim texts behind
                  them. The same sentence played twice is two claims and one
                  sentence.
                </li>
                <li>
                  <strong>Convergence.</strong> get_match records that a match was
                  adjudicated, never how many attempts that took, because a
                  discarded round writes nothing to contract state. Attempts are
                  reconstructed from the consensus contract's transaction log,
                  read from a committed index through its snapshot block and a
                  live scan of the blocks after it.
                </li>
              </ul>
            </section>

            {/* 1. Why measure this at all */}
            <section className="lab-section">
              <h2 className="lab-h2">WHY MEASURE THIS</h2>
              <p className="lab-body">
                Published work on judge architectures reports that a judge can be
                steered by text planted in the input it is asked to judge:{" "}
                <a
                  className="lab-inline-link"
                  href="https://arxiv.org/abs/2505.13348"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Investigating the Vulnerability of LLM-as-a-Judge Architectures
                  to Prompt-Injection Attacks
                </a>{" "}
                (arXiv:2505.13348) reports attack success rates above 30 percent
                against current models. That figure is a published research
                result and not a Carnage measurement. It was obtained on fixed
                datasets, offline, where the text had no cost to write and the
                verdict moved nothing.
              </p>
              <p className="lab-body">
                Carnage runs the same question with a stake attached. The claims
                are written by a player whose own 0.01 GEN is on the table, the
                jury is a set of independent validators rather than one call, and
                the labels move the stakes. Two things appear here that a fixed
                dataset does not produce: what somebody writes when a bluff has a
                price, and what happens to a verdict when validators time out or
                fail to converge.
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
                That is the whole corpus, and every figure below is recomputed
                from it each time this page opens. {rows.length} claims cannot
                establish a rate. What they support is a claim-by-claim account
                of how this jury labelled each one, with the transaction behind
                every label.
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
              <h2 className="lab-h2">CLAIM TYPE AGAINST LABEL</h2>
              <p className="lab-body">
                In this record TRUE and FALSE appear only on claims the evidence
                can settle. The claims it cannot settle drew MISLEADING or
                UNSUPPORTED. One reading of that is a jury grading degrees rather
                than sorting into true and false; see the limits below for why
                the row axis makes that reading partly circular.
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
                claim was true, subject to the two judgment calls listed under
                Method. Those are the only claims scored here.
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
                  The rubric keeps AMBIGUOUS for a claim that reads more than
                  one way, where no single reading dominates. Across{" "}
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
            <section className="lab-section" id="sources">
              <Tag kind="live" />
              <h2 className="lab-h2">WHAT IT TOOK TO AGREE</h2>
              <p className="lab-body">
                A verdict is a set of validators running the same job until
                enough of them agree, and sometimes that takes more than one
                pass. The number on each segment below is the transaction's round
                count: 0 means it settled on the first pass, and each further
                round follows a rotation, which is consensus bringing in a
                changed set of validators and running the job again. The contract
                records only that a match was judged. It cannot record how many
                attempts that took, because a thrown-away attempt leaves no trace
                in contract state, so this section reads the consensus contract's
                own transaction log instead.
              </p>

              {adj.byMatch.length ? (
                <>
                  <p className="lab-stat">
                    <strong>{convSummary.attempts}</strong> adjudicate transactions across{" "}
                    <strong>{convSummary.matches}</strong>{" "}
                    {plural(convSummary.matches, "match", "matches")}, of which{" "}
                    <strong>{convSummary.withVerdict}</strong>{" "}
                    {plural(convSummary.withVerdict, "has", "have")} a verdict in contract
                    state. <strong>{convSummary.clean}</strong>{" "}
                    {plural(convSummary.clean, "match", "matches")} settled on a single
                    transaction with no rotation, and{" "}
                    <strong>{convSummary.discarded}</strong>{" "}
                    {plural(convSummary.discarded, "transaction", "transactions")} finalized
                    without writing a verdict.
                  </p>
                  <ConvergenceChart rows={adj.byMatch} />
                  <p className="lab-body">
                    The striped segments are transactions where consensus
                    finished, the validators produced labels, and contract state
                    never moved. adjudicate refuses to run on a match that has
                    already been judged and accepts a fresh attempt on one that
                    has not, and it writes both labels only after both
                    classifications return, so a discarded attempt leaves nothing
                    behind and costs no stake.
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
            {caseSections > 0 ? (
              <section className="lab-section">
                <h2 className="lab-h2">MATCHES READ CLOSELY</h2>
                <p className="lab-body">
                  Everything above is a count over the whole corpus. What follows
                  is {caseSections} {plural(caseSections, "match", "matches")}{" "}
                  chosen by hand and read line by line. The choice of match and
                  the commentary are fixed. The label, the attempt count and the
                  transaction links are read live like every other figure here,
                  and would change if the chain did. Neither section is a
                  measurement over the corpus.
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
                    This claim was written to draw the label nobody has seen:{" "}
                    <em>{designedRow.claim}</em> On the page, English does not
                    settle whether that sentence denies the drop or denies the
                    reason for it. Both readings stand and they mean different
                    things, which is the case the rubric describes as ambiguous.
                    That reading is ours; the jury did not share it.
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
                      ? "No other match on the contract has spent as many consensus rounds, and the label it settled on was not the one the sentence was built to draw."
                      : "The label it settled on was not the one the sentence was built to draw."}
                  </p>
                  <p className="lab-caveat">
                    What one match shows and what it does not. This is a single
                    sentence we chose, wrote and then read the rounds of. It
                    records that one claim we read as ambiguous drew a different
                    label, and it says nothing about how often that happens. The
                    live counter further up is the number to quote; this is the
                    account behind one row of it.
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

            {injectionRow ? (
              <section className="lab-section">
                <div className="lab-case">
                  <Tag kind="case" />
                  <h3 className="lab-h3">
                    MATCH {String(injectionRow.matchId)}: A CLAIM CARRYING AN
                    INSTRUCTION TO THE JURY
                  </h3>
                  <p className="lab-body">
                    A claim is untrusted text. The rubric wraps it in tags and
                    tells the jury that everything inside is evidence to weigh
                    and never an instruction to follow. This claim tested that
                    directly.
                  </p>
                  <p className="lab-body">
                    This is one worked example. Nothing on this page scans for
                    attacks. The filter that flagged this claim is a short list
                    of keyword patterns, and the pattern that matched is printed
                    on the row, so the call can be checked rather than taken on
                    trust. A differently worded attempt would not be caught by
                    it, which is a limit of the filter and not a finding about
                    the jury. Across the corpus that filter flags{" "}
                    {injection.flagged.length} of {rows.length} claims.
                  </p>
                  <ClaimTable rows={[injectionRow]} lookup={lookup} />
                  <p className="lab-caveat">
                    Sample size 1.{" "}
                    {injectionHeld
                      ? "The jury labelled this claim the way the evidence settles it, and its recorded reasoning does not engage with the instruction."
                      : "The jury did not label this claim the way the evidence settles it; the row above shows what it returned."}{" "}
                    One example is an anecdote and is reported as one.
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
                A claim is scored only when a number appears inside a phrase that
                states that party's own limit. A number on its own is not enough.
                In this record one claim names the right price inside a denial,
                "I didn't drop to 650 because they pushed me", and reading that
                as an assertion would score the jury wrong on a mistake it did
                not make. Another claim counts other buyers in words and carries
                no digits at all, so the reason printed against it is that there
                is no number to check.
              </p>
              <ClaimTable rows={rows} lookup={lookup} />
            </section>

            {/* 9. What the figures above cannot carry. */}
            <section className="lab-section">
              <h2 className="lab-h2">LIMITS</h2>
              <ul className="lab-method">
                <li>
                  {adjudicated} {plural(adjudicated, "match", "matches")}, played
                  from two wallets, on one price band, one stake, one deal price
                  and one pair of revealed constraints. Only the claim text
                  varies, which is what makes the label the only moving part and
                  also what stops any figure here from being a rate.
                </li>
                <li>
                  {agree.verifiable} scored claims, drawn from{" "}
                  {agree.distinctTexts} distinct sentences. The agreement figure
                  rests on {agree.distinctTexts} sentences, not{" "}
                  {agree.verifiable}.
                </li>
                <li>
                  {injection.flagged.length} injection-shaped{" "}
                  {plural(injection.flagged.length, "claim", "claims")} in the
                  record, found by a keyword filter that a differently worded
                  attempt would pass.
                </li>
                <li>
                  AMBIGUOUS returned on {ambiguous} of {rows.length} claims.
                </li>
                <li>
                  The contract has four deadline-gated exits that end a match
                  without a verdict. None has run on the deployed contract, so no
                  figure here describes one.
                </li>
                <li>
                  In the claim-type table the row axis is derived by the same
                  extractor that decides what is scorable, so "flat labels only
                  on checkable claims" is in part a statement about the
                  extractor. The two axes are not independent.
                </li>
                <li>
                  Match discovery caches the id list for ten minutes and probes
                  two ids past the highest one it knows, so three or more matches
                  created inside that window can take an extra visit to appear.
                </li>
              </ul>
            </section>

            <footer className="lab-foot">
              <p className="lab-note">
                Contract <code>{CARNAGE_ADDRESS}</code> on {CHAIN.name}. Every match
                figure here is read from get_match on each visit. The transaction
                behind each verdict comes from a committed index plus a live scan
                of the blocks after it, described under{" "}
                <a className="lab-inline-link" href="#sources">
                  two sources, both on-chain
                </a>
                . No figure on this page is hand-entered.
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
 * asking for each id, four reads at a time, and each read takes a couple of
 * seconds. The count is the point: it moves, which is the difference between a
 * page that is working and a page that is broken.
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
          : "There is no index to query, so matches are fetched by id, four at a time."}
      </p>
    </section>
  );
}
