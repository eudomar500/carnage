import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import TopNav, { type NavShell } from "../components/TopNav";
import JudgeTrex, { type BiteSide } from "../components/JudgeTrex";
import AgentCard from "../components/AgentCard";
import StepDiagram from "../components/StepDiagram";
import VerdictBar from "../components/VerdictBar";
import ClaimPanel from "../components/ClaimPanel";
import MatchConsole from "../components/MatchConsole";
import AppEntry from "../components/AppEntry";
import Replay from "../components/Replay";
import { Vault } from "../components/Icons";
import { useMatch } from "../hooks/useMatch";
import { claimGate, isDishonest, isResolved } from "../chain/contract";
import { noteObserved } from "../chain/grace";
import { reconcile } from "../chain/journal";
import { seatOf, type Role } from "../chain/roles";
import { derivePhase, isStrike, judgeMood, type JudgeMood } from "../chain/phase";
import { CARNAGE_ADDRESS } from "../chain/client";
import { formatToken, shortAddress, TOKEN_SYMBOL } from "../lib/format";
import { PREVIEWS, type PreviewSelection } from "../dev/preview";

const LEFT_RAIL = ["CREATE", "COMMIT", "FUND", "NEGOTIATE", "ANCHOR CLAIMS"];
const RIGHT_RAIL = ["REVEAL", "VERIFY", "GENLAYER", "CONSENSUS", "FINALITY", "SETTLE", "REPLAY"];

export type MatchAppProps = {
  nav: NavShell;
  /** The match on screen, or null for the app's no-match entry state. */
  matchId: number | null;
  /** DEV ONLY synthetic state, resolved by the router. */
  preview: PreviewSelection | null;
  /** Loads an existing match id. */
  onOpenMatch: (matchId: number) => void;
  /** Returns to the app's entry state without leaving the app. */
  onEntry: () => void;
  onCreated: (matchId: bigint) => void;
};

/*
 * One bite, end to end: turn toward the card, jaws open, the card travels into
 * the mouth and holds there, jaws close with a jerk, a beat, and the card is
 * back chewed. Kept under two seconds a card so a both-adverse settlement does
 * not hold the screen. The same figures drive --bite-ms in styles.css.
 */
const BITE_MS = 1210;
const BITE_GAP_MS = 120;

/*
 * Development-only replay switch.
 *
 * With ?bite=1 the first sight of a settled match fires the sequence, so the
 * choreography can be worked on without waiting for a settlement to land. It
 * reads the URL and nothing else: no journal write, no cache entry, no state
 * beyond the reaction a mood transition would have produced anyway.
 *
 * import.meta.env.DEV is a literal at build time, so the whole expression
 * folds to false in a production build and the URL read is dropped with it.
 * Written as one constant rather than an effect of its own so that nothing,
 * not even an empty hook, survives the fold.
 */
const BITE_PREVIEW =
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("bite") === "1";

/** The seats a settle mood says were slashed, in the order the cards sit in. */
function bittenSeats(mood: JudgeMood): Role[] {
  const seats: Role[] = [];
  if (mood === "strike-holder" || mood === "strike-both") seats.push("holder");
  if (mood === "strike-buyer" || mood === "strike-both") seats.push("buyer");
  return seats;
}

/**
 * The functional half of Carnage: create a match, play a seat, watch one.
 *
 * Every state this can be in renders the same shell, so the nav (and with it
 * the way back to the site, and the wallet control) is present whether the
 * match is loading, missing, unreadable or live. Losing the nav on the boot
 * and error screens is what made those states dead ends.
 */
export default function MatchApp({
  nav,
  matchId,
  preview,
  onOpenMatch,
  onEntry,
  onCreated,
}: MatchAppProps) {
  const { view, notFound, error, errorKind, degraded, loading, tick, refresh } = useMatch(matchId);

  const effective = preview ? preview.scenario.state : view?.accepted ?? null;
  const phase = useMemo(() => (effective ? derivePhase(effective) : null), [effective]);
  const mood = phase ? judgeMood(phase) : "calm";

  // A settle that lands while the page is open plays the reaction once: the
  // screen shakes and flashes, and the judge eats the card of each side that
  // drew an adverse label.
  const [strikeKey, setStrikeKey] = useState(0);
  const [reacting, setReacting] = useState(false);
  const reactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The seat in the jaws right now, and the seats still owed a bite. A card is
  // drawn chewed once it is in neither: on a reload of a settled match both are
  // empty from the start, so the chewed state is there without the sequence.
  const [biting, setBiting] = useState<BiteSide>(null);
  const [queued, setQueued] = useState<Role[]>([]);
  const biteTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearBiteTimers = useCallback(() => {
    for (const t of biteTimers.current) clearTimeout(t);
    biteTimers.current = [];
  }, []);

  const fireReaction = useCallback(
    (seats: Role[]) => {
      setStrikeKey((k) => k + 1);
      setReacting(true);
      if (reactTimer.current) clearTimeout(reactTimer.current);
      reactTimer.current = setTimeout(() => setReacting(false), 1500);

      clearBiteTimers();
      // Reduced motion gets the outcome without the choreography: no bite, and
      // the chewed cards are already on screen because nothing is queued.
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced || seats.length === 0) {
        setQueued([]);
        setBiting(null);
        return;
      }

      setQueued(seats);
      let at = 0;
      for (const seat of seats) {
        const start = at;
        biteTimers.current.push(setTimeout(() => setBiting(seat), start));
        biteTimers.current.push(
          setTimeout(() => {
            setBiting(null);
            setQueued((rest) => rest.filter((s) => s !== seat));
          }, start + BITE_MS),
        );
        at += BITE_MS + BITE_GAP_MS;
      }
    },
    [clearBiteTimers],
  );

  const lastMood = useRef<string | null>(null);
  useEffect(() => {
    if (!phase) return;
    const previous = lastMood.current;
    lastMood.current = mood;
    // First sight of a match is not a transition, so it plays nothing. The dev
    // switch is the one exception, and it still only gets the first sight.
    if (previous === null && !BITE_PREVIEW) return;
    if (previous === mood) return;
    if (!isStrike(mood)) return;
    fireReaction(bittenSeats(mood));
  }, [mood, phase, tick, fireReaction]);
  useEffect(
    () => () => {
      if (reactTimer.current) clearTimeout(reactTimer.current);
      clearBiteTimers();
    },
    [clearBiteTimers],
  );

  const wallet = nav.wallet;

  /**
   * Journal upkeep, driven off the match feed rather than off any one panel.
   *
   * A panel only sees its own action land if it is still mounted when that
   * happens, and it usually is not: the moment the change registers,
   * deriveTurn stops offering the step and takes the panel off the screen. So
   * every successful read sweeps the journal and drops the records whose
   * postcondition is now satisfied. Without this an in-flight notice could
   * outlive the transaction it describes and greet the next visit to the
   * match with a warning about something that finished hours ago.
   *
   * noteObserved rides along for the same reason. The contract does not
   * publish adjudicated_at, so the only clock the force-settle gate can use is
   * the first moment this browser saw a verdict sitting unsettled, and that
   * has to be written down wherever the match is read.
   */
  useEffect(() => {
    const accepted = preview ? null : view?.accepted ?? null;
    if (!accepted) return;
    reconcile(accepted, seatOf(accepted, wallet) === "buyer" ? "buyer" : "holder");
    noteObserved(accepted);
  }, [preview, view, wallet]);

  const m = effective;
  const live = Boolean(m && phase);

  /**
   * One frame for every state. The stage class carries the judge mood so the
   * strike animation still works, and the nav is never conditional.
   */
  const shell = (body: ReactNode) => (
    <div className={`stage stage--${mood}${reacting ? " stage--reacting" : ""}`} id="top">
      <div className="flash-layer" aria-hidden="true" />
      {import.meta.env.DEV && preview ? (
        <div className="preview-bar">
          <span className="preview-tag">PREVIEW: SYNTHETIC STATE, NOT ON-CHAIN</span>
          <span className="preview-label">{preview.scenario.label}</span>
          <span className="preview-expect">expect: {preview.scenario.expect}</span>
          <button className="preview-replay" onClick={() => fireReaction(bittenSeats(mood))}>
            REPLAY STRIKE
          </button>
          <span className="preview-links">
            {Object.keys(PREVIEWS).map((k) => (
              <a key={k} href={`?preview=${k}`} className={k === preview.key ? "on" : ""}>{k}</a>
            ))}
          </span>
        </div>
      ) : null}
      <TopNav variant="app" {...nav} hasReplay={live} />
      {body}
    </div>
  );

  // No match selected: create one, or open one by id.
  if (!preview && matchId === null) {
    return shell(<AppEntry wallet={wallet} onOpen={onOpenMatch} onCreated={onCreated} />);
  }

  if (!preview && loading && !view && !notFound) {
    return shell(
      <p className="app-boot">READING MATCH {matchId} FROM BRADBURY...</p>,
    );
  }

  // An id that was never minted is not an error; it is an invitation.
  if (!preview && notFound && matchId !== null) {
    return shell(
      <MatchConsole
        matchId={BigInt(matchId)}
        match={null}
        gate={null}
        notFound
        wallet={wallet}
        onCreated={onCreated}
        onActed={refresh}
      />,
    );
  }

  if (!m || !phase) {
    // A node that timed out, refused or answered with something that is not
    // JSON-RPC says nothing about the match, so the useful offer is another
    // read. A revert is the contract answering, and its own words are what the
    // reader needs instead.
    const unreachable = errorKind === "network" || errorKind === "rate-limited";
    return shell(
      <div className="app-boot app-boot--err">
        <p>COULD NOT READ MATCH {matchId}</p>
        {unreachable ? (
          <>
            <p className="boot-detail">
              GenLayer Bradbury is not answering right now. The match is
              unaffected and the read can be tried again.
            </p>
            <button
              type="button"
              className="linkish"
              disabled={loading}
              onClick={() => {
                void refresh();
              }}
            >
              try the read again
            </button>
          </>
        ) : (
          <p className="boot-detail">{error}</p>
        )}
        <button type="button" className="linkish" onClick={onEntry}>
          open a different match
        </button>
      </div>,
    );
  }

  const gate = claimGate(m, wallet);
  const pool = m.stake_amount * 2n;
  const stillLocked = m.holder_claimable + m.buyer_claimable + m.sink_claimable;
  // A card is chewed once settlement slashed it and the jaws have let it go.
  // While it is queued or in the mouth it still looks whole, because it has
  // not been eaten yet.
  const inJaws = (seat: Role) => biting === seat || queued.includes(seat);
  const holderCracked = m.settled && isDishonest(m.holder_label) && !inJaws("holder");
  const buyerCracked = m.settled && isDishonest(m.buyer_label) && !inJaws("buyer");

  return shell(
    <>
      <main className="hero">
        <div className="badge badge--justice">
          <div className="badge-title">
            ON-CHAIN JUSTICE
            <span className="badge-dots"><i /><i /></span>
          </div>
          <div className="badge-sub">Built on GenLayer</div>
        </div>

        <div className="badge badge--match">
          <div className="badge-label">MATCH ID</div>
          <div className="badge-value">
            0xCARNAGE::{shortAddress(CARNAGE_ADDRESS, 4, 4).replace("0x", "")} | #{`${m.match_id}`}
          </div>
          <div className="badge-label">STATUS</div>
          <div className={`badge-status badge-status--${phase.phase.toLowerCase()}`}>
            {phase.statusLabel}
          </div>
        </div>

        <JudgeTrex mood={mood} strikeKey={strikeKey} bite={biting} />

        <ol className="rail rail--left">
          {LEFT_RAIL.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <ol className="rail rail--right">
          {RIGHT_RAIL.map((s) => <li key={s}>{s}</li>)}
        </ol>

        <div className="card-slot card-slot--left">
          <AgentCard
            role="HOLDER"
            address={m.holder}
            committed={m.holder_committed}
            revealed={m.holder_revealed}
            constraint={m.holder_revealed_state}
            stake={m.stake_amount}
            label={m.holder_label}
            cracked={holderCracked}
            eating={biting === "holder"}
          />
        </div>

        <div className="vs" aria-hidden="true">
          <span className="vs-chevrons">&gt;&gt;</span> VS
        </div>

        <div className="card-slot card-slot--right">
          <AgentCard
            role="BUYER"
            address={m.buyer}
            committed={m.buyer_committed}
            revealed={m.buyer_revealed}
            constraint={m.buyer_revealed_state}
            stake={m.stake_amount}
            label={m.buyer_label}
            cracked={buyerCracked}
            eating={biting === "buyer"}
          />
        </div>

        <div className="center">
          <h1 className="wordmark">CARNAGE</h1>
          <p className="tagline">Where agents lie, and the jury bites back.</p>
          <p className="subtitle">
            Adversarial negotiation. Cryptographic commitments.
            <br />
            AI-judged truth. Economic consequences.
          </p>
          <StepDiagram active={phase.stepIndex} />
        </div>
      </main>

      {degraded && !preview ? (
        <p className="degraded">
          READS ARE FAILING ({degraded}). THE STATE BELOW IS THE LAST GOOD READ
          AND MAY BE BEHIND. RETRYING ON A LONGER INTERVAL.
        </p>
      ) : null}

      <MatchConsole
        matchId={m.match_id}
        match={m}
        gate={gate}
        notFound={false}
        wallet={wallet}
        onCreated={onCreated}
        onActed={refresh}
      />

      <section className="footer-grid">
        <div className="panel panel--commitment">
          <div className="panel-title">COMMITMENT (EXAMPLE)</div>
          <code className="commit-formula">
            H(<em>state</em> || <em>salt</em> || <em>match_id</em> || <em>agent</em>)
          </code>
          <code className="commit-hash">
            deal_price {`${m.deal_price}`} | band {`${m.price_floor}`}-{`${m.price_ceil}`}
          </code>
          <div className="commit-foot">
            <span className={m.holder_committed && m.buyer_committed ? "on" : ""}>
              {m.holder_committed && m.buyer_committed ? "RECORDED ON-CHAIN" : "AWAITING COMMITMENTS"}
            </span>
          </div>
        </div>

        <VerdictBar holderLabel={m.holder_label} buyerLabel={m.buyer_label} />

        <div className="panel panel--escrow">
          <div className="panel-title">ESCROW / STAKE POOL</div>
          <div className="escrow-row">
            <Vault className="ico escrow-ico" />
            <div className="escrow-amt">
              {formatToken(pool)} <span className="unit">{TOKEN_SYMBOL}</span>
            </div>
          </div>
          <div className="escrow-foot">
            {isResolved(m)
              ? stillLocked > 0n
                ? `${formatToken(stillLocked)} ${TOKEN_SYMBOL} UNCLAIMED`
                : "FULLY CLAIMED"
              : "LOCKED IN CONTRACT"}
          </div>
          <ClaimPanel
            gate={gate}
            wallet={wallet}
            match={m}
            role={seatOf(m, wallet) === "buyer" ? "buyer" : "holder"}
            refresh={refresh}
          />
        </div>
      </section>

      <Replay match={m} />
    </>,
  );
}
