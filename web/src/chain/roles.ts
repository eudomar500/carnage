import type { MatchState } from "./contract";

export type Role = "holder" | "buyer";
/** What the connected wallet is, relative to this match. */
export type Seat = Role | "observer";

export type ActionId =
  | "create_match"
  | "commit"
  | "fund"
  | "anchor_claim"
  | "propose_price"
  | "reveal"
  | "adjudicate"
  | "claim"
  | "claim_sink"
  | "refund_before_lock"
  | "force_settle"
  | "propose_sink"
  | "accept_sink";

/** The zero address, which is pending_sink's empty value. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** True when a handover is waiting for its proposed address to accept. */
export function sinkTransferPending(m: MatchState): boolean {
  return Boolean(m.pending_sink) && !sameAddress(m.pending_sink, ZERO_ADDRESS);
}

/** The connected wallet's standing with the protocol sink, if any. */
export type SinkSeat = "sink" | "pending-sink" | null;

export function sinkSeatOf(m: MatchState, wallet: string | null): SinkSeat {
  if (!wallet) return null;
  if (sameAddress(m.sink_address, wallet)) return "sink";
  if (sinkTransferPending(m) && sameAddress(m.pending_sink, wallet)) return "pending-sink";
  return null;
}

export type Actor = Role | "anyone";

export type PendingAction = {
  id: ActionId;
  actor: Actor;
  /** The contract method this actor would call. */
  method: string;
  label: string;
  hint: string;
};

export type Turn = {
  seat: Seat;
  /** Actions the connected wallet can take right now. */
  mine: PendingAction[];
  /** Actions the counterparty still owes before the match can advance. */
  theirs: PendingAction[];
  /** Permissionless actions anyone may trigger. */
  open: PendingAction[];
};

export function seatOf(m: MatchState, wallet: string | null): Seat {
  if (!wallet) return "observer";
  const me = wallet.toLowerCase();
  if (m.holder.toLowerCase() === me) return "holder";
  if (m.buyer.toLowerCase() === me) return "buyer";
  return "observer";
}

const other = (r: Role): Role => (r === "holder" ? "buyer" : "holder");

/**
 * Derives every action outstanding at this instant, and who owes it.
 *
 * Mirrors the contract's own preconditions so the UI never offers a button
 * that would revert. Each side acts from its own wallet; a step that needs
 * both sides shows as pending for whichever has not done it yet.
 */
export function deriveTurn(
  m: MatchState,
  wallet: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Turn {
  const seat = seatOf(m, wallet);
  const pending: PendingAction[] = [];

  const resolved =
    m.settled || m.no_reveal_resolved || m.inconclusive_resolved || m.refunded_before_lock;

  const commitDone = (r: Role) => (r === "holder" ? m.holder_committed : m.buyer_committed);
  const fundDone = (r: Role) => (r === "holder" ? m.holder_funded : m.buyer_funded);
  const claimDone = (r: Role) => (r === "holder" ? m.holder_claimed : m.buyer_claimed);
  // get_match does not expose *_proposed_price_set, but a valid price is
  // always inside the band and price_floor must be positive, so a zero
  // proposal is exactly "not yet proposed".
  const priceDone = (r: Role) =>
    (r === "holder" ? m.holder_proposed_price : m.buyer_proposed_price) > 0n;
  const revealDone = (r: Role) => (r === "holder" ? m.holder_revealed : m.buyer_revealed);

  const both = (f: (r: Role) => boolean) => f("holder") && f("buyer");

  for (const role of ["holder", "buyer"] as const) {
    if (resolved) break;

    if (!commitDone(role)) {
      pending.push({
        id: "commit",
        actor: role,
        method: role === "holder" ? "commit_holder" : "commit_buyer",
        label: role === "holder" ? "COMMIT MINIMUM PRICE" : "COMMIT MAXIMUM BUDGET",
        hint: "seals a salted hash of your private constraint",
      });
      continue;
    }
    if (!both(commitDone)) continue;

    if (!fundDone(role)) {
      pending.push({
        id: "fund",
        actor: role,
        method: role === "holder" ? "fund_holder" : "fund_buyer",
        label: "FUND STAKE",
        hint: "deposits exactly stake_amount into escrow",
      });
      continue;
    }
    if (!both(fundDone)) continue;

    if (!claimDone(role)) {
      pending.push({
        id: "anchor_claim",
        actor: role,
        method: role === "holder" ? "anchor_claim_holder" : "anchor_claim_buyer",
        label: "ANCHOR CLAIM",
        hint: "records the natural-language claim the jury will judge",
      });
      continue;
    }
    if (!both(claimDone)) continue;

    if (!m.price_locked) {
      if (!priceDone(role)) {
        pending.push({
          id: "propose_price",
          actor: role,
          method: role === "holder" ? "propose_price_holder" : "propose_price_buyer",
          label: "PROPOSE DEAL PRICE",
          hint: "the price locks when both sides propose the same number",
        });
      }
      continue;
    }

    if (!revealDone(role)) {
      pending.push({
        id: "reveal",
        actor: role,
        method: role === "holder" ? "reveal_holder" : "reveal_buyer",
        label: "REVEAL CONSTRAINT",
        hint: "opens your commitment so the jury can judge your claim",
      });
    }
  }

  const open: PendingAction[] = [];
  if (!resolved && both(revealDone) && !m.adjudicated) {
    open.push({
      id: "adjudicate",
      actor: "anyone",
      method: "adjudicate",
      label: "SUMMON THE JURY",
      hint: "permissionless: anyone may trigger adjudication",
    });
  }

  // Recovery. Both are permissionless by design: a stuck match must never
  // depend on the party that walked away from it.
  //
  // The lock deadline is compared against this browser's clock only to decide
  // whether to offer the button. The contract re-checks it against block time,
  // and the preflight inside every write is what actually gates the call.
  const fundedAtAll = fundDone("holder") || fundDone("buyer");
  if (!resolved && fundedAtAll && !m.price_locked && nowSeconds > Number(m.lock_deadline)) {
    open.push({
      id: "refund_before_lock",
      actor: "anyone",
      method: "refund_before_lock",
      label: "REFUND STAKES",
      hint: "permissionless: the deal price was never agreed, so every stake goes back",
    });
  }

  if (m.adjudicated && !m.settled) {
    open.push({
      id: "force_settle",
      actor: "anyone",
      method: "force_settle",
      label: "FORCE SETTLEMENT",
      hint: "permissionless fallback if the automatic settlement never ran",
    });
  }

  const mine = seat === "observer" ? [] : pending.filter((a) => a.actor === seat);
  const theirs =
    seat === "observer" ? pending : pending.filter((a) => a.actor === other(seat as Role));

  return { seat, mine, theirs, open };
}
