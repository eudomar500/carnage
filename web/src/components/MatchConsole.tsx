import CreatePanel from "./CreatePanel";
import {
  AdjudicatePanel,
  AnchorClaimPanel,
  ClaimActionPanel,
  CommitPanel,
  ForceSettlePanel,
  FundPanel,
  ProposePricePanel,
  RefundBeforeLockPanel,
  RevealPanel,
  SinkClaimPanel,
  SinkTransferPanel,
} from "./ActionPanels";
import { sinkClaimGate, type ClaimGate, type MatchState } from "../chain/contract";
import {
  deriveTurn,
  sinkSeatOf,
  type ActionId,
  type PendingAction,
  type Role,
} from "../chain/roles";
import { useNowSeconds } from "../hooks/useNowSeconds";
import { shortAddress } from "../lib/format";

export type MatchConsoleProps = {
  matchId: bigint;
  match: MatchState | null;
  notFound: boolean;
  wallet: `0x${string}` | null;
  gate: ClaimGate | null;
  onCreated: (id: bigint) => void;
  /**
   * Re-reads the match and hands back what it read. Every panel confirms its
   * own state change through this, so it has to return the state, not void.
   */
  onActed: () => Promise<MatchState | null>;
};

function Waiting({ actions, match }: { actions: PendingAction[]; match: MatchState }) {
  if (!actions.length) return null;
  return (
    <ul className="waiting">
      {actions.map((a) => (
        <li key={`${a.id}-${a.actor}`}>
          <span className="waiting-who">{a.actor.toUpperCase()}</span>
          <span className="waiting-what">{a.label}</span>
          <span className="waiting-addr">
            {shortAddress(a.actor === "holder" ? match.holder : match.buyer, 4, 4)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Renders the form + button for whichever action is outstanding. */
function Panel({
  id,
  wallet,
  match,
  role,
  gate,
  onActed,
}: {
  id: ActionId;
  wallet: `0x${string}`;
  match: MatchState;
  role: Role;
  gate: ClaimGate | null;
  onActed: () => Promise<MatchState | null>;
}) {
  const p = { wallet, match, role, refresh: onActed };
  switch (id) {
    case "commit":         return <CommitPanel {...p} />;
    case "fund":           return <FundPanel {...p} />;
    case "anchor_claim":   return <AnchorClaimPanel {...p} />;
    case "propose_price":  return <ProposePricePanel {...p} />;
    case "reveal":         return <RevealPanel {...p} />;
    case "adjudicate":     return <AdjudicatePanel {...p} />;
    case "refund_before_lock": return <RefundBeforeLockPanel {...p} />;
    case "force_settle":   return <ForceSettlePanel {...p} />;
    case "claim":
      return gate ? <ClaimActionPanel {...p} gate={gate} /> : null;
    default:               return null;
  }
}

/**
 * Why the match is closed, in the contract's own terms.
 *
 * A resolved match offers no buttons, and a dead panel with no explanation is
 * worse than no panel. Each of these flags is terminal: once one is set the
 * contract refuses every reveal, adjudication, resolution and settlement, so
 * this says which one closed the match and what it did with the money.
 */
function TerminalFlags({ m }: { m: MatchState }) {
  const flags: string[] = [];
  if (m.settled) flags.push("settled: the verdict was applied and balances credited");
  else if (m.adjudicated) flags.push("adjudicated: a verdict is stored, settlement has not run yet");
  if (m.no_reveal_resolved) {
    flags.push(
      m.no_reveal_outcome
        ? `no_reveal_resolved: ${m.no_reveal_outcome}`
        : "no_reveal_resolved: the reveal deadline passed with a side unrevealed",
    );
  }
  if (m.inconclusive_resolved) {
    flags.push("inconclusive_resolved: the jury never decided, both stakes went back");
  }
  if (m.refunded_before_lock) {
    flags.push("refunded_before_lock: no deal price was agreed, every stake went back");
  }
  if (!flags.length) return null;

  return (
    <div className="console-body">
      <p className="console-lede">
        This match is closed. Nothing can reveal, adjudicate or resolve it
        again, which is why those actions are not on offer.
      </p>
      <ul className="waiting">
        {flags.map((f) => (
          <li key={f}>
            <span className="waiting-what">{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The refund exists before it is callable, and saying so is the point.
 *
 * A match that funded and then stalled is exactly the state that used to
 * strand money. The exit is real from the moment the lock deadline passes,
 * and until then this says when that is rather than showing a dead button.
 */
function RefundCountdown({ m, now }: { m: MatchState; now: number }) {
  const funded = m.holder_funded || m.buyer_funded;
  const resolved =
    m.settled || m.no_reveal_resolved || m.inconclusive_resolved || m.refunded_before_lock;
  if (!funded || m.price_locked || resolved) return null;
  if (now > Number(m.lock_deadline)) return null;

  const when = new Date(Number(m.lock_deadline) * 1000).toISOString().replace(".000Z", "Z");
  return (
    <div className="console-body">
      <p className="console-lede">
        Stakes are in escrow and the deal price is not locked. If it never
        locks, anyone can return both stakes with refund_before_lock from{" "}
        <strong>{when}</strong>. Each side gets back exactly what it funded,
        with nothing slashed.
      </p>
    </div>
  );
}

/**
 * The lifecycle console.
 *
 * Two people on two wallets share one match: each sees the same live state,
 * but only the actions their own seat owes. Everything else is shown as
 * blocked on the counterparty.
 */
export default function MatchConsole(p: MatchConsoleProps) {
  // Before the early return: this component bails out for a match that does
  // not exist yet, and a hook called after that point would change the hook
  // count when the match appears.
  const now = useNowSeconds();

  if (p.notFound || !p.match) {
    return (
      <section className="console" id="console">
        <div className="console-head">
          <h2 className="console-title">MATCH #{`${p.matchId}`}</h2>
          <span className="console-seat console-seat--observer">NOT CREATED</span>
        </div>
        <CreatePanel wallet={p.wallet} onCreated={p.onCreated} />
      </section>
    );
  }

  const m = p.match;
  // One clock for both the gating and the countdown line, so the refund
  // button appears by itself the moment the lock deadline passes.
  const turn = deriveTurn(m, p.wallet, now);
  const seatIsPlayer = turn.seat === "holder" || turn.seat === "buyer";

  // The sink area is for whoever holds the protocol sink, or is mid-handover
  // into it. A normal player never sees it.
  const sinkSeat = sinkSeatOf(m, p.wallet);
  const sinkGate = sinkClaimGate(m, p.wallet);
  const showSink = sinkSeat !== null;

  // Claim is not part of the negotiation queue. It appears once settlement
  // has run and this seat has something to withdraw.
  const showClaim =
    seatIsPlayer && p.gate !== null && p.gate.state !== "not-settled" && p.gate.state !== "not-a-party";

  return (
    <section className="console" id="console">
      <div className="console-head">
        <h2 className="console-title">MATCH #{`${m.match_id}`}</h2>
        <span className={`console-seat console-seat--${turn.seat}`}>
          {p.wallet
            ? turn.seat === "observer"
              ? "OBSERVER: NOT A PARTY"
              : `YOU ARE THE ${turn.seat.toUpperCase()}`
            : "WALLET NOT CONNECTED"}
        </span>
      </div>

      {!p.wallet ? (
        <div className="console-body">
          <p className="console-lede">
            Connect a wallet (the control is in the top right) to see which
            actions belong to you. The match state above is live either way.
          </p>
        </div>
      ) : (
        <>
          {seatIsPlayer &&
            turn.mine.map((a) => (
              <div key={a.id} className="turn turn--mine">
                <div className="turn-head">
                  <span className="turn-flag">YOUR MOVE</span>
                  <span className="turn-label">{a.label}</span>
                  <code className="turn-method">{a.method}</code>
                </div>
                <Panel
                  id={a.id}
                  wallet={p.wallet!}
                  match={m}
                  role={turn.seat as Role}
                  gate={p.gate}
                  onActed={p.onActed}
                />
              </div>
            ))}

          {turn.theirs.length ? (
            <div className="turn turn--blocked">
              <div className="turn-head">
                <span className="turn-flag turn-flag--wait">WAITING ON COUNTERPARTY</span>
              </div>
              <Waiting actions={turn.theirs} match={m} />
            </div>
          ) : null}

          {turn.open.map((a) => (
            <div key={a.id} className="turn turn--open">
              <div className="turn-head">
                <span className="turn-flag turn-flag--open">OPEN TO ANYONE</span>
                <span className="turn-label">{a.label}</span>
                <code className="turn-method">{a.method}</code>
              </div>
              <Panel
                id={a.id}
                wallet={p.wallet!}
                match={m}
                role={(seatIsPlayer ? turn.seat : "holder") as Role}
                gate={p.gate}
                onActed={p.onActed}
              />
            </div>
          ))}

          {showClaim ? (
            <div className="turn turn--mine">
              <div className="turn-head">
                <span className="turn-flag">YOUR PAYOUT</span>
                <span className="turn-label">CLAIM SETTLEMENT</span>
                <code className="turn-method">claim</code>
              </div>
              <Panel
                id="claim"
                wallet={p.wallet!}
                match={m}
                role={turn.seat as Role}
                gate={p.gate}
                onActed={p.onActed}
              />
            </div>
          ) : null}

          {turn.seat === "observer" && !turn.open.length ? (
            <div className="console-body">
              <p className="console-lede">
                This wallet is neither the holder ({shortAddress(m.holder, 4, 4)})
                nor the buyer ({shortAddress(m.buyer, 4, 4)}), so it has no moves
                here. Switch accounts in your wallet to play a seat.
              </p>
              <Waiting actions={turn.theirs} match={m} />
            </div>
          ) : null}

          {showSink ? (
            <div className="turn turn--mine">
              <div className="turn-head">
                <span className="turn-flag">PROTOCOL SINK</span>
                <span className="turn-label">
                  {sinkSeat === "sink" ? "YOU HOLD THE SINK" : "SINK HANDOVER PENDING TO YOU"}
                </span>
                <code className="turn-method">
                  {sinkSeat === "sink" ? "propose_sink_address" : "accept_sink_address"}
                </code>
              </div>
              <SinkTransferPanel
                wallet={p.wallet!}
                match={m}
                role={(seatIsPlayer ? turn.seat : "holder") as Role}
                refresh={p.onActed}
              />
              {sinkSeat === "sink" && sinkGate.state !== "not-a-party" ? (
                <SinkClaimPanel
                  wallet={p.wallet!}
                  match={m}
                  role={(seatIsPlayer ? turn.seat : "holder") as Role}
                  gate={sinkGate}
                  refresh={p.onActed}
                />
              ) : null}
            </div>
          ) : null}

          <RefundCountdown m={m} now={now} />

          <TerminalFlags m={m} />

          {seatIsPlayer && !turn.mine.length && !turn.theirs.length && !turn.open.length && !showClaim ? (
            <div className="console-body">
              <p className="console-lede">Nothing outstanding for this match.</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
