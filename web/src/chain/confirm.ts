import { isResolved } from "./contract";
import type { MatchState } from "./contract";
import type { ActionId, Role } from "./roles";

/**
 * What each action is actually trying to change, and how long we will wait to
 * see it.
 *
 * A transaction being ACCEPTED is not the same as the state change landing.
 * The case that forced this table was an adjudicate that was accepted while
 * the jury round was discarded, leaving `adjudicated` false forever: the UI
 * called it a success because it was watching the transaction instead of the
 * state. That was match 2 on the superseded deployment, before the audited
 * contract went out. On the deployed contract the discarded rounds are
 * matches 3 and 8, both of them finalized and neither of them written.
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
  /**
   * Shown when the transaction reached a terminal state on-chain and the
   * postcondition never became true, so the attempt is over and failed.
   *
   * Distinct from unconfirmedNote, which only means we stopped watching. This
   * one is a finding, not a timeout: the chain has told us the answer.
   */
  discardedNote: string;
};

/**
 * The generic case. A deterministic write is preflighted before it is ever
 * signed, so it reaching a terminal state with nothing written means the round
 * itself was discarded rather than the call being rejected.
 */
const DISCARDED_NOTE =
  "This transaction finished on-chain without recording the change, so the " +
  "round was discarded rather than applied. Nothing was spent from escrow. " +
  "Send it again.";

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
  const base = {
    actionId: id,
    windowMs: FAST_WINDOW_MS,
    pollMs: FAST_POLL_MS,
    discardedNote: DISCARDED_NOTE,
  };

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
        // The one action that hits this regularly. adjudicate is the only
        // call the app does not preflight, and the only one that runs a
        // nondeterministic round, which is what exposes it to a round the
        // consensus layer finalizes without accepting. See chain/txstate.ts.
        discardedNote:
          "The previous jury round finished on-chain but did not write a " +
          "verdict to the contract: consensus discarded the round, so the " +
          "match is unchanged and nothing was spent from escrow. You can " +
          "summon the jury again.",
        // Tolerant on purpose. If settlement runs between two polls we have
        // still seen what we came for, and reporting a stuck jury because the
        // state ran ahead of us would be a false alarm.
        landed: (m) => m.adjudicated || isResolved(m),
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
        discardedNote: DISCARDED_NOTE,
        landed: (m) => (role === "holder" ? m.holder_claimable : m.buyer_claimable) === 0n,
        pendingNote: "confirming the claim was recorded...",
        confirmedNote: "claim recorded",
        retryLabel: "RETRY CLAIM",
        unconfirmedNote: "THE CLAIM DID NOT LAND, RETRY",
      };

    case "claim_sink":
      // Same call as claim, watching the sink's balance instead of a seat's.
      return {
        actionId: id,
        windowMs: 120_000,
        pollMs: FAST_POLL_MS,
        discardedNote: DISCARDED_NOTE,
        landed: (m) => m.sink_claimable === 0n,
        pendingNote: "confirming the sink claim was recorded...",
        confirmedNote: "sink balance claimed",
        retryLabel: "RETRY SINK CLAIM",
        unconfirmedNote: "THE SINK CLAIM DID NOT LAND, RETRY",
      };

    case "refund_before_lock":
      // Permissionless, so the postcondition is the flag itself rather than
      // anything about who sent it. If another caller got there first the
      // pre-send check sees the flag already set and spends nothing.
      return {
        ...base,
        landed: (m) => m.refunded_before_lock,
        pendingNote: "confirming the refund was recorded...",
        confirmedNote: "stakes refunded, each side got back what it funded",
        retryLabel: "RETRY REFUND",
        unconfirmedNote: "THE REFUND DID NOT LAND, RETRY",
      };

    case "force_settle":
      return {
        ...base,
        landed: (m) => m.settled,
        pendingNote: "confirming settlement was applied...",
        confirmedNote: "settlement applied from the stored labels",
        retryLabel: "RETRY FORCE SETTLEMENT",
        unconfirmedNote: "SETTLEMENT DID NOT LAND, RETRY",
      };

    case "propose_sink":
      // No postcondition. The proposed address is only known at click time,
      // and proposing the zero address to cancel would clear pending_sink
      // rather than set it, so there is no single predicate that covers both.
      // The console re-reads the match either way and shows what is pending.
      return {
        ...base,
        pendingNote: "recording the proposal...",
        confirmedNote: "sink transfer proposed, it moves only when accepted",
        retryLabel: "RETRY PROPOSAL",
        unconfirmedNote: "THE PROPOSAL DID NOT LAND, RETRY",
      };

    case "accept_sink":
      // Accepting clears pending_sink, which is exactly the state change.
      return {
        ...base,
        landed: (m) => !m.pending_sink || /^0x0+$/.test(m.pending_sink),
        pendingNote: "confirming the handover...",
        confirmedNote: "sink role accepted",
        retryLabel: "RETRY ACCEPT",
        unconfirmedNote: "THE HANDOVER DID NOT LAND, RETRY",
      };
  }
}
