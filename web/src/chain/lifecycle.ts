import { isResolved } from "./contract";
import type { MatchState } from "./contract";

/**
 * The match lifecycle, as the contract actually enforces it.
 *
 * This is the single source of truth behind the HOW IT WORKS section and the
 * frame order in REPLAY. Every beat names the real methods on Carnage and the
 * precondition that gates it, so the page cannot drift from carnage.py without
 * someone editing this file.
 *
 * The order is not a narrative choice. It is what the contract's own guards
 * force: _require_both_committed gates funding, _require_both_funded gates
 * claim anchoring, _require_both_claimed gates pricing, _require_price_locked
 * gates reveal, _require_both_revealed gates adjudication, and settle is
 * reachable only from the finalized self-call adjudicate schedules.
 */

export type Venue = "HASH" | "ON-CHAIN" | "OFF-CHAIN" | "GENLAYER";

export type Beat = {
  key: string;
  title: string;
  venue: Venue;
  /** Who may send the call. */
  who: string;
  /** Contract methods this beat is made of. Empty when nothing is called. */
  methods: string[];
  /** What the beat does, in one line. */
  what: string;
  /** The precondition the contract checks before it will run. */
  gate: string;
  /** True once stored state shows this beat is behind us. */
  done: (m: MatchState) => boolean;
};

export const BEATS: Beat[] = [
  {
    key: "create",
    title: "CREATE",
    venue: "ON-CHAIN",
    who: "anyone",
    methods: ["create_match"],
    what: "Seats a holder and a buyer, fixes the price band, the stake each side must post, and the two deadlines.",
    gate: "holder and buyer must differ, the band must be positive and widening and inside the protocol maximum, the stake must be positive and inside it too, both deadlines must carry a timezone offset and lie in the future, inconclusive_deadline must fall after reveal_deadline, and reveal_deadline must be more than 900 seconds away so the reveal window cannot be squeezed to nothing",
    // Reading a match at all proves it was created.
    done: () => true,
  },
  {
    key: "commit",
    title: "COMMIT",
    venue: "HASH",
    who: "holder and buyer, each from their own wallet",
    methods: ["commit_holder", "commit_buyer"],
    what: "Each side seals H(state || salt || match_id || agent). The holder commits the lowest price it would truly accept, the buyer the highest it could truly pay. The salt is mandatory: a price is low-entropy and a bare hash would be brute-forced.",
    gate: "one commitment per side, and nothing else can start until both are in",
    done: (m) => m.holder_committed && m.buyer_committed,
  },
  {
    key: "fund",
    title: "FUND",
    venue: "ON-CHAIN",
    who: "holder and buyer, each from their own wallet",
    methods: ["fund_holder", "fund_buyer"],
    what: "Each side deposits exactly stake_amount into escrow. This is the money the verdict will move.",
    gate: "both sides must have committed first",
    done: (m) => m.holder_funded && m.buyer_funded,
  },
  {
    key: "negotiate",
    title: "NEGOTIATE",
    venue: "OFF-CHAIN",
    who: "holder and buyer",
    methods: [],
    what: "Offers, counteroffers and strategy stay off-chain and cheap. This beat leaves no trace on-chain by design; where it surfaces is in the claim each side chooses to anchor next.",
    gate: "none: the contract is not involved",
    done: (m) => m.holder_claimed && m.buyer_claimed,
  },
  {
    key: "anchor",
    title: "ANCHOR CLAIMS",
    venue: "ON-CHAIN",
    who: "holder and buyer, each from their own wallet",
    methods: ["anchor_claim_holder", "anchor_claim_buyer"],
    what: "Each side records the natural-language claim the jury will judge. The claim is stored on this match, and it lands before anyone reveals anything. Resistance to replay into another match is the commitment's guarantee: match_id and the address sit inside its preimage.",
    gate: "both sides must have funded, and each side may anchor once",
    done: (m) => m.holder_claimed && m.buyer_claimed,
  },
  {
    key: "price",
    title: "LOCK PRICE",
    venue: "ON-CHAIN",
    who: "holder and buyer, each from their own wallet",
    methods: ["propose_price_holder", "propose_price_buyer"],
    what: "Both sides propose a number inside the band. The deal price locks the moment the two proposals match. The deal price is never rewritten afterwards, whatever the verdict says. A proposal can be replaced until it locks, so a first offer that misses is not fatal.",
    gate: "both claims must be anchored, every proposal must lie within price_floor..price_ceil, and proposals are refused at or after lock_deadline, which sits a full reveal window before reveal_deadline",
    done: (m) => m.price_locked,
  },
  {
    key: "reveal",
    title: "REVEAL",
    venue: "ON-CHAIN",
    who: "holder and buyer, each from their own wallet",
    methods: ["reveal_holder", "reveal_buyer"],
    what: "Each side opens its commitment with (state, salt). The contract recomputes the hash through the same compute_commitment view and rejects anything that does not match. After this nothing is private.",
    gate: "the deal price must be locked, the recomputed hash must equal the stored commitment, the match must not already be resolved, and the reveal must land strictly before reveal_deadline",
    done: (m) => m.holder_revealed && m.buyer_revealed,
  },
  {
    key: "adjudicate",
    title: "ADJUDICATE",
    venue: "GENLAYER",
    who: "anyone: adjudication is permissionless",
    methods: ["adjudicate"],
    what: "GenLayer classifies each claim against that side's revealed constraint into one of five labels. Validators independently re-derive the label and compare it; the free-form reasoning is stored but never compared. Claims are handled strictly as untrusted data, delimited inside the prompt.",
    gate: "both sides must have revealed, and a match adjudicates once",
    done: (m) => m.adjudicated,
  },
  {
    key: "settle",
    title: "SETTLE",
    venue: "ON-CHAIN",
    who: "the contract itself, with force_settle as a permissionless fallback",
    methods: ["settle", "force_settle"],
    what: "Accepted is not finalized. adjudicate does not settle inline: it schedules settle with on=\"finalized\", so settlement runs only once the appeal window on the verdict has closed. settle then credits claimable balances from the labels. It moves no funds itself. If that scheduled message never arrives, force_settle lets anyone apply the same stored labels through the same rule once the grace period has passed, so a recorded verdict cannot sit unpaid forever.",
    gate: "settle takes the contract address as sender and settles once; force_settle takes any sender, but only 2 hours after adjudication and only while the match is still unsettled",
    done: (m) => m.settled,
  },
  {
    key: "claim",
    title: "CLAIM",
    venue: "ON-CHAIN",
    who: "holder, buyer, or the protocol sink",
    methods: ["claim"],
    what: "Each party withdraws its own credited balance. The payout is emitted with on=\"finalized\", so the GEN moves when the claim transaction itself finalizes, not when it is accepted.",
    gate: "the sender must have a non-zero claimable balance in this match",
    done: (m) => m.holder_claimable === 0n && m.buyer_claimable === 0n && m.sink_claimable === 0n,
  },
];

/**
 * The ways a match ends without a verdict, plus the fallback that pays out a
 * verdict nobody applied.
 *
 * Three of these skip adjudication entirely: a price that never locked, a
 * reveal that never came, and a jury that never decided. None calls GenLayer,
 * and none blames anyone for a lie, because none is about one. The fourth,
 * force_settle, is not an exit from the verdict path but a way to finish it
 * when the automatic settlement did not run.
 *
 * All four are permissionless and deadline-gated, which is the whole point:
 * no state can strand funds, and no match depends on the party that walked
 * away from it.
 */
export type Branch = {
  key: string;
  title: string;
  method: string;
  when: string;
  outcome: string;
  taken: (m: MatchState) => boolean;
};

export const BRANCHES: Branch[] = [
  {
    key: "refund-before-lock",
    title: "NO DEAL PRICE",
    method: "refund_before_lock",
    when: "lock_deadline passes with the two sides still not agreed on a price",
    outcome: "Stakes are in escrow but the negotiation never produced a number both sides proposed. Nobody broke a rule, so nothing is slashed and nothing goes to the sink: each side is credited exactly what it funded. Anyone may trigger it, so a side that walked away cannot hold the other's stake.",
    taken: (m) => m.refunded_before_lock,
  },
  {
    key: "no-reveal",
    title: "NO REVEAL",
    method: "resolve_no_reveal",
    when: "reveal_deadline passes with at least one side still unrevealed",
    outcome: "A missing reveal is a protocol violation, not a question for the judge. The side that did reveal takes the whole pool. If neither revealed, nobody beat anybody: both stakes go back to their owners, with nothing to the sink. No AI call is involved.",
    taken: (m) => m.no_reveal_resolved,
  },
  {
    key: "inconclusive",
    title: "INCONCLUSIVE",
    method: "resolve_inconclusive",
    when: "both sides revealed, but inconclusive_deadline passes with the match still unadjudicated",
    // The gate is a clock, not an assessment of the jury. The contract cannot
    // know why no verdict was written; it knows the deadline passed with the
    // match unadjudicated. Say that, and leave the reason out of it.
    outcome: "The inconclusive deadline passed with no verdict written, so there is nothing to apply and nobody to penalise. Each side gets its own stake back as a claimable credit, with no slash and nothing to the sink.",
    taken: (m) => m.inconclusive_resolved,
  },
  {
    key: "force-settle",
    title: "SETTLEMENT NEVER RAN",
    method: "force_settle",
    when: "a verdict is recorded but the scheduled settlement has not run, and 2 hours have passed since adjudication",
    outcome: "The labels are already stored, so there is nothing to judge again. This applies the same settlement rule the automatic path would have applied. It exists so a verdict cannot sit unpaid: the normal path runs first on a healthy chain, and this is the fallback when it does not.",
    taken: (m) => m.adjudicated && !m.settled,
  },
];

/** Index of the first beat still outstanding, or -1 when the match is done. */
export function nextBeatIndex(m: MatchState): number {
  return BEATS.findIndex((b) => !b.done(m));
}

// Re-exported so the lifecycle's own consumers keep one import, but the
// definition lives in contract.ts next to MatchState. There is exactly one.
export { isResolved };
