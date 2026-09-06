import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopNav from "./components/TopNav";
import JudgeTrex from "./components/JudgeTrex";
import AgentCard from "./components/AgentCard";
import StepDiagram from "./components/StepDiagram";
import VerdictBar from "./components/VerdictBar";
import ClaimPanel from "./components/ClaimPanel";
import MatchConsole from "./components/MatchConsole";
import { Vault } from "./components/Icons";
import { useMatch } from "./hooks/useMatch";
import { claimGate, isDishonest, sendClaim } from "./chain/contract";
import { derivePhase, isStrike, judgeMood } from "./chain/phase";
import { CARNAGE_ADDRESS, connectWallet, disconnectWallet, watchWallet } from "./chain/client";
import { formatToken, shortAddress, TOKEN_SYMBOL } from "./lib/format";
import { PREVIEWS, previewFromUrl } from "./dev/preview";
import "./styles.css";

function matchIdFromUrl(): number {
  const raw = Number(new URLSearchParams(location.search).get("match"));
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

const LEFT_RAIL = ["CREATE", "COMMIT", "FUND", "NEGOTIATE", "ANCHOR CLAIMS"];
const RIGHT_RAIL = ["REVEAL", "VERIFY", "GENLAYER", "CONSENSUS", "FINALITY", "SETTLE", "REPLAY"];

export default function App() {
  const [matchId, setMatchId] = useState(matchIdFromUrl);
  const { view, notFound, error, loading, tick, refresh } = useMatch(matchId);
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);

  // DEV ONLY: ?preview=<scenario> substitutes a synthetic match so the judge
  // animation can be inspected without playing a match on-chain.
  const preview = useMemo(() => (import.meta.env.DEV ? previewFromUrl() : null), []);
  const effective = preview ? preview.scenario.state : view?.accepted ?? null;
  const phase = useMemo(() => (effective ? derivePhase(effective) : null), [effective]);
  const mood = phase ? judgeMood(phase) : "calm";

  // A settle that lands while the page is open plays the strike once: the
  // judge lunges, the screen shakes and flashes, the slashed card cracks.
  const [strikeKey, setStrikeKey] = useState(0);
  const [reacting, setReacting] = useState(false);
  const reactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireReaction = useCallback(() => {
    setStrikeKey((k) => k + 1);
    setReacting(true);
    if (reactTimer.current) clearTimeout(reactTimer.current);
    reactTimer.current = setTimeout(() => setReacting(false), 1500);
  }, []);

  const lastMood = useRef<string | null>(null);
  useEffect(() => {
    if (!phase) return;
    const previous = lastMood.current;
    lastMood.current = mood;
    if (previous === null || previous === mood) return;
    if (!isStrike(mood)) return;
    fireReaction();
  }, [mood, phase, tick, fireReaction]);
  useEffect(() => () => { if (reactTimer.current) clearTimeout(reactTimer.current); }, []);

  const onConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const { address } = await connectWallet();
      setWallet(address);
    } catch {
      /* surfaced by the wallet itself */
    } finally {
      setConnecting(false);
    }
  }, []);

  const onDisconnect = useCallback(async () => {
    await disconnectWallet();
    setWallet(null);
  }, []);

  // If the user switches accounts in their wallet, the seat must follow.
  useEffect(() => {
    if (!wallet) return;
    return watchWallet(setWallet);
  }, [wallet]);

  const onClaim = useCallback(async () => {
    if (!wallet) return;
    await sendClaim(matchId, wallet);
  }, [wallet, matchId]);

  // Creating a match moves this browser onto it without a reload, and keeps
  // the URL shareable so the counterparty can open the same match.
  const onCreated = useCallback((id: bigint) => {
    const next = Number(id);
    const url = new URL(location.href);
    url.searchParams.set("match", String(next));
    history.replaceState(null, "", url);
    setMatchId(next);
  }, []);

  if (!preview && loading && !view && !notFound) {
    return <div className="boot">READING MATCH {matchId} FROM BRADBURY...</div>;
  }

  // An id that was never minted is not an error; it is an invitation.
  if (!preview && notFound) {
    return (
      <div className="stage" id="top">
        <TopNav wallet={wallet} connecting={connecting} onConnect={onConnect} onDisconnect={onDisconnect} />
        <MatchConsole
          matchId={BigInt(matchId)}
          match={null}
          gate={null}
          notFound
          wallet={wallet}
          onCreated={onCreated}
          onActed={refresh}
        />
      </div>
    );
  }

  if (!effective || !phase) {
    return (
      <div className="boot boot--err">
        <p>COULD NOT READ MATCH {matchId}</p>
        <p className="boot-detail">{error}</p>
      </div>
    );
  }

  const m = effective;
  const gate = claimGate(m, wallet);
  const pool = m.stake_amount * 2n;
  const stillLocked = m.holder_claimable + m.buyer_claimable + m.sink_claimable;
  const holderCracked = m.settled && isDishonest(m.holder_label);
  const buyerCracked = m.settled && isDishonest(m.buyer_label);

  return (
    <div
      className={`stage stage--${mood}${reacting ? " stage--reacting" : ""}`}
      id="top"
    >
      <div className="flash-layer" aria-hidden="true" />
      {import.meta.env.DEV && preview ? (
        <div className="preview-bar">
          <span className="preview-tag">PREVIEW: SYNTHETIC STATE, NOT ON-CHAIN</span>
          <span className="preview-label">{preview.scenario.label}</span>
          <span className="preview-expect">expect: {preview.scenario.expect}</span>
          <button className="preview-replay" onClick={fireReaction}>REPLAY STRIKE</button>
          <span className="preview-links">
            {Object.keys(PREVIEWS).map((k) => (
              <a key={k} href={`?preview=${k}`} className={k === preview.key ? "on" : ""}>{k}</a>
            ))}
          </span>
        </div>
      ) : null}
      <TopNav wallet={wallet} connecting={connecting} onConnect={onConnect} onDisconnect={onDisconnect} />

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

        <JudgeTrex mood={mood} strikeKey={strikeKey} />

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
          />
        </div>

        <div className="vs" aria-hidden="true">
          <span className="vs-chevrons">››</span> VS
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

      <MatchConsole
        matchId={BigInt(matchId)}
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
            {m.settled || m.no_reveal_resolved || m.inconclusive_resolved
              ? stillLocked > 0n
                ? `${formatToken(stillLocked)} ${TOKEN_SYMBOL} UNCLAIMED`
                : "FULLY CLAIMED"
              : "LOCKED IN CONTRACT"}
          </div>
          <ClaimPanel gate={gate} wallet={wallet} onClaim={onClaim} />
        </div>
      </section>

      <p className="thesis">
        CRYPTOGRAPHY ESTABLISHES WHAT EACH AGENT COMMITTED TO.
        <span className="thesis-sep">//</span>
        <span className="thesis-gen">GENLAYER</span> ESTABLISHES WHAT THEIR NATURAL-LANGUAGE CLAIMS MEAN.
      </p>
    </div>
  );
}
