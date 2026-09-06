import type { MatchState } from "./contract";
import type { ActionId, Role } from "./roles";

/**
 * What each action is actually trying to change, and how long we will wait to
 * see it.
 *
 * A transaction being ACCEPTED is not the same as the state change landing.
 * On match 2 the adjudicate transaction was accepted, the jury round was
 * discarded, and `adjudicated` stayed false forever. The UI called that a
 * success because it was watching the transaction instead of the state.
 *
 * So every write declares its postcondition here, in one table, and the
 * action layer refuses to report success until `landed` is observed through
 * get_match. The same predicate does double duty as an idempotency check
 * before signing: if it already holds, there is nothing to send.
 */
export type Confirmation = {
  actionId: ActionId;
  /**
   * The state change this action exists to produce.
   *
   * Absent only for create_match, which proves its own outcome by scanning
   * for the minted id, and has no prior match to read.
   */
  landed?: (m: MatchState) => boolean;
  /** How long to keep watching before calling the attempt unconfirmed. */
  windowMs: number;
  /** Cadence of the confirmation read. */
  pollMs: number;
  pendingNote: string;
  confirmedNote: string;
  /** Button label once a retry is on offer. */
  retryLabel: string;
  /** Shown when the window closed without the change landing. */
  unconfirmedNote: string;
};

const mine = <K extends keyof MatchState>(role: Role, holderKey: K, buyerKey: K) =>
  (m: MatchState) => Boolean(m[role === "holder" ? holderKey : buyerKey]);

/** Ordinary deterministic writes show up as soon as the write commits. */
const FAST_WINDOW_MS = 90_000;
const FAST_POLL_MS = 5_000;

/**
 * The jury is a nondeterministic round plus consensus, so it runs far behind
 * an ordinary write and deserves a much longer leash before we call it stuck.
 */
const JURY_WINDOW_MS = 240_000;
const JURY_POLL_MS = 8_000;

export function confirmationFor(id: ActionId, role: Role): Confirmation {
  const base = { actionId: id, windowMs: FAST_WINDOW_MS, pollMs: FAST_POLL_MS };

  switch (id) {
    case "create_match":
      return {
        ...base,
        pendingNote: "confirming the match was minted...",
        confirmedNote: "match created",
        retryLabel: "RETRY CREATE",
        unconfirmedNote: "THE MATCH WAS NOT CREATED, RETRY",
      };

    case "commit":
      return {
        ...base,
        landed: mine(role, "holder_committed", "buyer_committed"),
        pendingNote: "confirming the commitment landed on-chain...",
        confirmedNote: "commitment sealed on-chain",
        retryLabel: "RETRY COMMIT",
        unconfirmedNote: "THE COMMITMENT DID NOT LAND, RETRY",
      };

    case "fund":
      return {
        ...base,
        landed: mine(role, "holder_funded", "buyer_funded"),
        pendingNote: "confirming the stake reached escrow...",
        confirmedNote: "stake deposited",
        retryLabel: "RETRY FUNDING",
        unconfirmedNote: "THE STAKE DID NOT REACH ESCROW, RETRY",
      };

    case "anchor_claim":
      return {
        ...base,
        landed: mine(role, "holder_claimed", "buyer_claimed"),
        pendingNote: "confirming the claim was anchored...",
        confirmedNote: "claim anchored",
        retryLabel: "RETRY ANCHOR",
        unconfirmedNote: "THE CLAIM WAS NOT ANCHORED, RETRY",
      };

    case "propose_price":
      // get_match does not expose *_proposed_price_set, but a valid price is
      // always inside the band and price_floor must be positive, so a nonzero
      // proposal is exactly "this side has proposed".
      return {
        ...base,
        landed: (m) => (role === "holder" ? m.holder_proposed_price : m.buyer_proposed_price) > 0n,
        pendingNote: "confirming the proposal landed...",
        confirmedNote: "price proposed",
        retryLabel: "RETRY PROPOSAL",
        unconfirmedNote: "THE PROPOSAL DID NOT LAND, RETRY",
      };

    case "reveal":
      return {
        ...base,
        landed: mine(role, "holder_revealed", "buyer_revealed"),
        pendingNote: "confirming the reveal landed on-chain...",
        confirmedNote: "constraint revealed",
        retryLabel: "RETRY REVEAL",
        unconfirmedNote: "THE REVEAL DID NOT LAND, RETRY",
      };

    case "adjudicate":
      return {
        actionId: id,
        windowMs: JURY_WINDOW_MS,
        pollMs: JURY_POLL_MS,
        // Tolerant on purpose. If settlement runs between two polls we have
        // still seen what we came for, and reporting a stuck jury because the
        // state ran ahead of us would be a false alarm.
        landed: (m) =>
          m.adjudicated || m.settled || m.no_reveal_resolved || m.inconclusive_resolved,
        pendingNote: "jury is running, waiting for the verdict to be written...",
        confirmedNote: "verdict recorded on-chain",
        retryLabel: "RETRY ADJUDICATION",
        unconfirmedNote: "THE JURY DID NOT RETURN A VERDICT, RETRY ADJUDICATION",
      };

    case "claim":
      // claim zeroes this seat's balance at acceptance; the transfer itself is
      // released later, on finalization, and is reported separately.
      return {
        actionId: id,
        windowMs: 120_000,
        pollMs: FAST_POLL_MS,
        landed: (m) => (role === "holder" ? m.holder_claimable : m.buyer_claimable) === 0n,
        pendingNote: "confirming the claim was recorded...",
        confirmedNote: "claim recorded",
        retryLabel: "RETRY CLAIM",
        unconfirmedNote: "THE CLAIM DID NOT LAND, RETRY",
      };
  }
}
