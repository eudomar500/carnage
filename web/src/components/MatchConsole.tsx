import CreatePanel from "./CreatePanel";
import {
  AdjudicatePanel,
  AnchorClaimPanel,
  ClaimActionPanel,
  CommitPanel,
  FundPanel,
  ProposePricePanel,
  RevealPanel,
} from "./ActionPanels";
import type { ClaimGate, MatchState } from "../chain/contract";
import { deriveTurn, type ActionId, type PendingAction, type Role } from "../chain/roles";
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
    case "claim":
      return gate ? <ClaimActionPanel {...p} gate={gate} /> : null;
    default:               return null;
  }
}

/**
 * The lifecycle console.
 *
 * Two people on two wallets share one match: each sees the same live state,
 * but only the actions their own seat owes. Everything else is shown as
 * blocked on the counterparty.
 */
export default function MatchConsole(p: MatchConsoleProps) {
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
  const turn = deriveTurn(m, p.wallet);
  const seatIsPlayer = turn.seat === "holder" || turn.seat === "buyer";

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
