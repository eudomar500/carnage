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
    gate: "the band must be positive and widening, and inconclusive_deadline must fall after reveal_deadline",
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
    what: "Each side records the natural-language claim the jury will judge. The claim is bound to this match, so it cannot be replayed elsewhere, and it is stored before anyone reveals anything.",
    gate: "both sides must have funded, and each side may anchor once",
    done: (m) => m.holder_claimed && m.buyer_claimed,
  },
  {
    key: "price",
    title: "LOCK PRICE",
    venue: "ON-CHAIN",
    who: "holder and buyer, each from their own wallet",
    methods: ["propose_price_holder", "propose_price_buyer"],
    what: "Both sides propose a number inside the band. The deal price locks the moment the two proposals match. The deal price is never rewritten afterwards, whatever the verdict says.",
    gate: "both claims must be anchored, and every proposal must lie within price_floor..price_ceil",
    done: (m) => m.price_locked,
  },
  {
    key: "reveal",
    title: "REVEAL",
    venue: "ON-CHAIN",
    who: "holder and buyer, each from their own wallet",
    methods: ["reveal_holder", "reveal_buyer"],
    what: "Each side opens its commitment with (state, salt). The contract recomputes the hash through the same compute_commitment view and rejects anything that does not match. After this nothing is private.",
    gate: "the deal price must be locked, and the recomputed hash must equal the stored commitment",
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
    who: "the contract itself, and nobody else",
    methods: ["settle"],
    what: "Accepted is not finalized. adjudicate does not settle inline: it schedules settle with on=\"finalized\", so settlement runs only once the appeal window on the verdict has closed. settle then credits claimable balances from the labels. It moves no funds itself.",
    gate: "sender must be the contract address, the match must be adjudicated, and it settles once",
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
 * The two deterministic exits. Neither calls GenLayer, and neither produces a
 * verdict, which is exactly why they exist: a protocol violation and a judge
 * that cannot decide are different problems from a lie.
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
    key: "no-reveal",
    title: "NO REVEAL",
    method: "resolve_no_reveal",
    when: "reveal_deadline passes with at least one side still unrevealed",
    outcome: "A missing reveal is a protocol violation, not a question for the judge. The side that did reveal takes the whole pool. If neither revealed, both stakes are forfeited to the protocol sink. No AI call is involved.",
    taken: (m) => m.no_reveal_resolved,
  },
  {
    key: "inconclusive",
    title: "INCONCLUSIVE",
    method: "resolve_inconclusive",
    when: "both sides revealed, but inconclusive_deadline passes with the match still unadjudicated",
    outcome: "If the jury genuinely cannot decide, nobody is punished. Each side gets its own stake back as a claimable credit: no slash, no transfer to the counterparty, nothing to the sink.",
    taken: (m) => m.inconclusive_resolved,
  },
];

/** Index of the first beat still outstanding, or -1 when the match is done. */
export function nextBeatIndex(m: MatchState): number {
  return BEATS.findIndex((b) => !b.done(m));
}

/** True once the match has reached any of its three terminal states. */
export function isResolved(m: MatchState): boolean {
  return m.settled || m.no_reveal_resolved || m.inconclusive_resolved;
}
