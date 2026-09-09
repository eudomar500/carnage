import { claimGate, sinkClaimGate, isDishonest, type MatchState } from "./contract";
import { derivePhase } from "./phase";
import { deriveTurn, seatOf, sinkSeatOf } from "./roles";

/**
 * What a connected wallet needs to know about, per match.
 *
 * Every notification here is a pure function of one MatchState plus the
 * wallet address. Nothing in this module reads the chain, holds state or
 * remembers anything: the caller supplies the matches it already has, and the
 * same inputs always produce the same list.
 *
 * That is what makes the action items self-clearing. They are recomputed from
 * live state on every poll, so a claim that has been taken, a turn that has
 * been played or a refund somebody else triggered simply stops appearing. The
 * only item that needs a memory is the informational one, because "both sides
 * lied and the sink took the difference" stays true forever; dismissal for
 * that lives in the caller, keyed by the `key` field below.
 */

export type NotificationKind =
  | "claim"
  | "your-move"
  | "recovery"
  | "pending-sink"
  | "sink-forfeit";

/** Action items ask for a transaction. Info items are read once and dismissed. */
export type NotificationSeverity = "action" | "info";

export type Notification = {
  /** Stable across polls for the same condition, so dismissals can key on it. */
  key: string;
  matchId: bigint;
  kind: NotificationKind;
  severity: NotificationSeverity;
  /** Short line for the dropdown row. */
  title: string;
  /** One sentence saying what to do or what happened. */
  detail: string;
};

const keyFor = (matchId: bigint, kind: NotificationKind) => `${matchId}:${kind}`;

/**
 * Every notification for one match, for one wallet.
 *
 * Order matters: money first, then turns, then recovery, then the sink, then
 * anything informational. The bell shows them in this order across matches
 * too, so the thing worth acting on is never below the thing worth reading.
 */
export function notificationsForMatch(
  m: MatchState,
  wallet: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Notification[] {
  if (!wallet) return [];
  const out: Notification[] = [];

  // 1. Funds waiting. A party balance and the sink balance are separate
  // credits and can both be owed to the same wallet, but claim() pays them
  // in one call, so they are reported as one item.
  const party = claimGate(m, wallet);
  const sink = sinkClaimGate(m, wallet);
  const owed =
    (party.state === "ready" ? party.amount : 0n) +
    (sink.state === "ready" ? sink.amount : 0n);
  if (owed > 0n) {
    out.push({
      key: keyFor(m.match_id, "claim"),
      matchId: m.match_id,
      kind: "claim",
      severity: "action",
      title: "Funds to claim",
      detail:
        sink.state === "ready" && party.state === "ready"
          ? "You are owed both a settlement balance and the protocol sink balance in this match."
          : sink.state === "ready"
            ? "The protocol sink has a balance in this match and you hold the sink."
            : "Settlement credited you a balance that has not been withdrawn.",
    });
  }

  // 2. The wallet's own turn in the negotiation.
  const turn = deriveTurn(m, wallet, nowSeconds);
  if (turn.mine.length > 0) {
    const first = turn.mine[0];
    out.push({
      key: keyFor(m.match_id, "your-move"),
      matchId: m.match_id,
      kind: "your-move",
      severity: "action",
      title: `Your move: ${first.label.toLowerCase()}`,
      detail: `${first.hint}. The match cannot advance until you do.`,
    });
  }

  // 3. Recovery. These are permissionless, so anyone could trigger them, but
  // only the people with money in the match are told about them.
  const involved = turn.seat !== "observer" || sinkSeatOf(m, wallet) !== null;
  if (involved) {
    const recovery = turn.open.find(
      (a) => a.id === "refund_before_lock" || a.id === "force_settle",
    );
    if (recovery) {
      out.push({
        key: keyFor(m.match_id, "recovery"),
        matchId: m.match_id,
        kind: "recovery",
        severity: "action",
        title:
          recovery.id === "refund_before_lock"
            ? "Stakes can be refunded"
            : "Settlement has not run",
        detail:
          recovery.id === "refund_before_lock"
            ? "No deal price was agreed and the lock deadline has passed. Anyone can return both stakes."
            : "A verdict is recorded but settlement has not run. The fallback opens 2 hours after adjudication.",
      });
    }
  }

  // 4. A sink handover waiting on this wallet.
  if (sinkSeatOf(m, wallet) === "pending-sink") {
    out.push({
      key: keyFor(m.match_id, "pending-sink"),
      matchId: m.match_id,
      kind: "pending-sink",
      severity: "action",
      title: "You were proposed as the protocol sink",
      detail: "The role does not move until you accept it from this wallet.",
    });
  }

  // 5. Informational. Both sides drew an adverse label, so the slashed
  // portions went to the sink instead of crossing between them.
  const bothLied = m.settled && isDishonest(m.holder_label) && isDishonest(m.buyer_label);
  if (bothLied && turn.seat !== "observer") {
    out.push({
      key: keyFor(m.match_id, "sink-forfeit"),
      matchId: m.match_id,
      kind: "sink-forfeit",
      severity: "info",
      title: "Both sides were judged adverse",
      detail:
        "Both claims drew an adverse label, so the slashed portions went to the protocol sink rather than across to a counterparty.",
    });
  }

  return out;
}

/** Flattens several matches, keeping the per-match ordering above. */
export function notificationsForMatches(
  matches: MatchState[],
  wallet: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Notification[] {
  return matches.flatMap((m) => notificationsForMatch(m, wallet, nowSeconds));
}

/** Action items only. The badge counts these; info items never nag. */
export function actionCount(items: Notification[]): number {
  return items.filter((n) => n.severity === "action").length;
}

/**
 * The wallet's matches, as a roster to revisit.
 *
 * Built from the same MatchState objects the notifications above are computed
 * from, so it costs nothing extra: whatever discovery already read is all
 * this needs. Status comes from derivePhase, the same function the hero badge
 * uses, so the roster and the match view can never disagree about what a
 * match is doing.
 */
export type RosterRole = "HOLDER" | "BUYER" | "SINK";

export type RosterEntry = {
  matchId: bigint;
  /** Current phase or terminal outcome, e.g. NEGOTIATING, REVEALING, SETTLED. */
  status: string;
  role: RosterRole;
  /** True when this match has at least one action item outstanding. */
  needsAction: boolean;
};

export function buildRoster(
  matches: MatchState[],
  wallet: string | null,
  items: Notification[],
): RosterEntry[] {
  if (!wallet) return [];
  const needing = new Set(
    items.filter((n) => n.severity === "action").map((n) => String(n.matchId)),
  );

  return matches
    .map((m) => {
      const seat = seatOf(m, wallet);
      const role: RosterRole = seat === "holder" ? "HOLDER" : seat === "buyer" ? "BUYER" : "SINK";
      return {
        matchId: m.match_id,
        status: derivePhase(m).statusLabel,
        role,
        needsAction: needing.has(String(m.match_id)),
      };
    })
    // Anything asking for a move comes first, then the newest, because a
    // match id is the only ordering the contract gives us and a higher id is
    // always the more recent match.
    .sort((a, b) => {
      if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
      return Number(b.matchId - a.matchId);
    });
}
