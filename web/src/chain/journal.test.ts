import { beforeEach, describe, expect, it } from "vitest";
import { CARNAGE_ADDRESS } from "./client";
import type { MatchState } from "./contract";
import { ZERO_ADDRESS } from "./roles";
import {
  CREATE_KEY_ID,
  clearAttempt,
  noteHash,
  noteTarget,
  readAttempt,
  reconcile,
  noteSinkTarget,
  reconcileAll,
  reconcileCreate,
  reconcileSinkProposal,
  subscribe,
  writeAttempt,
} from "./journal";

const HOLDER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const BUYER = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const SINK = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";
const STAKE = 1_000n;
const HASH = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
/** A wallet in neither seat. The sink is normally one of these. */
const OUTSIDER = "0xEEeeEEeeEEeeEEeeEEeeEEeeEEeeEEeeEEeeEEee";

/**
 * The storage key, spelled out rather than imported.
 *
 * key() is private, and a test that built it by calling the module could not
 * catch the module changing it. Writing it here means the shape is pinned:
 * contract, match, action, seat.
 */
const keyFor = (matchId: string, actionId: string, seat: string) =>
  `carnage.attempt.${CARNAGE_ADDRESS.toLowerCase()}.${matchId}.${actionId}.${seat}`;

/** The journal only ever talks to localStorage, so the tests supply one. */
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

/** A match sitting at the point where both sides have committed and funded. */
const base: MatchState = {
  match_id: 7n,
  holder: HOLDER,
  buyer: BUYER,
  price_floor: 500n,
  price_ceil: 1000n,
  stake_amount: STAKE,
  reveal_deadline: "2026-12-31T00:00:00Z",
  inconclusive_deadline: "2027-01-31T00:00:00Z",
  holder_committed: true,
  buyer_committed: true,
  holder_funded: true,
  buyer_funded: false,
  holder_claim: "",
  buyer_claim: "",
  holder_claimed: false,
  buyer_claimed: false,
  holder_proposed_price: 0n,
  buyer_proposed_price: 0n,
  deal_price: 0n,
  price_locked: false,
  holder_revealed: false,
  buyer_revealed: false,
  holder_revealed_state: 0n,
  buyer_revealed_state: 0n,
  adjudicated: false,
  settled: false,
  holder_label: "",
  buyer_label: "",
  holder_reasoning: "",
  buyer_reasoning: "",
  no_reveal_resolved: false,
  inconclusive_resolved: false,
  holder_claimable: 0n,
  buyer_claimable: 0n,
  sink_claimable: 0n,
  sink_address: SINK,
  pending_sink: ZERO_ADDRESS,
  holder_escrow: STAKE,
  buyer_escrow: 0n,
  escrow_total: STAKE,
  credited_total: 0n,
  paid_total: 0n,
  lock_deadline: 1_800_000_000n,
  refunded_before_lock: false,
  no_reveal_outcome: "",
  coherence_known: false,
  coherent: false,
};

beforeEach(installStorage);

describe("records", () => {
  it("round-trips an attempt", () => {
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    expect(readAttempt(7n, "commit", "holder")).toEqual({
      actionId: "commit",
      seat: "holder",
      startedAt: 1000,
      outcome: "pending",
    });
  });

  it("keeps records for different actions apart", () => {
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    writeAttempt(7n, "fund", "holder", "unconfirmed", 2000);
    expect(readAttempt(7n, "commit", "holder")?.outcome).toBe("pending");
    expect(readAttempt(7n, "fund", "holder")?.outcome).toBe("unconfirmed");
  });

  it("keeps records for different matches apart", () => {
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    expect(readAttempt(8n, "commit", "holder")).toBeNull();
  });

  it("returns null rather than throwing on stored garbage", () => {
    localStorage.setItem(keyFor("7", "commit", "holder"), "{not json");
    expect(readAttempt(7n, "commit", "holder")).toBeNull();
  });

  it("rejects a record with no timestamp", () => {
    localStorage.setItem(
      keyFor("7", "commit", "holder"),
      JSON.stringify({ outcome: "pending" }),
    );
    expect(readAttempt(7n, "commit", "holder")).toBeNull();
  });

  it("clears a record", () => {
    writeAttempt(7n, "commit", "holder", "pending");
    clearAttempt(7n, "commit", "holder");
    expect(readAttempt(7n, "commit", "holder")).toBeNull();
  });
});

describe("transaction hash", () => {
  it("stamps a hash without disturbing when the attempt started", () => {
    writeAttempt(7n, "reveal", "holder", "pending", 1000);
    noteHash(7n, "reveal", "holder", HASH);
    expect(readAttempt(7n, "reveal", "holder")).toEqual({
      actionId: "reveal",
      seat: "holder",
      startedAt: 1000,
      outcome: "pending",
      hash: HASH,
    });
  });

  it("carries the hash across an outcome change when it is passed back in", () => {
    writeAttempt(7n, "reveal", "holder", "pending", 1000);
    noteHash(7n, "reveal", "holder", HASH);
    const prior = readAttempt(7n, "reveal", "holder")!;
    writeAttempt(7n, "reveal", "holder", "unconfirmed", prior.startedAt, prior.hash);
    expect(readAttempt(7n, "reveal", "holder")).toEqual({
      actionId: "reveal",
      seat: "holder",
      startedAt: 1000,
      outcome: "unconfirmed",
      hash: HASH,
    });
  });

  it("does not let a fresh attempt inherit the dead one's hash", () => {
    writeAttempt(7n, "reveal", "holder", "pending", 1000);
    noteHash(7n, "reveal", "holder", HASH);
    writeAttempt(7n, "reveal", "holder", "pending", 5000);
    expect(readAttempt(7n, "reveal", "holder")?.hash).toBeUndefined();
  });

  it("does nothing when there is no attempt to stamp", () => {
    noteHash(7n, "reveal", "holder", HASH);
    expect(readAttempt(7n, "reveal", "holder")).toBeNull();
  });
});

describe("reconcile", () => {
  it("drops a record whose change is visible on-chain", () => {
    writeAttempt(base.match_id, "commit", "holder", "pending", 1000);
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "commit", "holder")).toBeNull();
  });

  it("keeps a record whose change has not landed", () => {
    writeAttempt(base.match_id, "fund", "holder", "pending", 1000);
    reconcile(base, "buyer");
    expect(readAttempt(base.match_id, "fund", "holder")?.outcome).toBe("pending");
  });

  it("reads the postcondition for the right seat", () => {
    writeAttempt(base.match_id, "fund", "holder", "pending", 1000);
    // The holder funded, the buyer did not. Same action, opposite answers.
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "fund", "holder")).toBeNull();
  });

  it("leaves an action that has no postcondition alone", () => {
    writeAttempt(base.match_id, "create_match", "holder", "pending", 1000);
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "create_match", "holder")?.outcome).toBe("pending");
  });

  it("sweeps every action in one pass", () => {
    writeAttempt(base.match_id, "commit", "holder", "pending", 1000);
    writeAttempt(base.match_id, "fund", "holder", "pending", 1000);
    writeAttempt(base.match_id, "reveal", "holder", "pending", 1000);
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "commit", "holder")).toBeNull();
    expect(readAttempt(base.match_id, "fund", "holder")).toBeNull();
    expect(readAttempt(base.match_id, "reveal", "holder")?.outcome).toBe("pending");
  });
});

/* ---------- orphaned records ------------------------------------------- */

/**
 * The bug these cover: an action started in one match and then abandoned by
 * navigating somewhere else. The panel that would have cleared the record is
 * gone, so the only thing that can retire it is the app-level sweep.
 */
describe("the app-level sweep", () => {
  const other = (id: bigint): MatchState => ({ ...base, match_id: id });

  it("clears a record for a match that is not the one on screen", () => {
    // Started on match 7, user navigated to match 9.
    const seven = { ...base, match_id: 7n, holder_committed: true };
    writeAttempt(7n, "commit", "holder", "pending", 1000);

    // The old per-match reconcile only ever saw the visible match.
    reconcile(other(9n), "holder");
    expect(readAttempt(7n, "commit", "holder")?.outcome).toBe("pending");

    // The sweep sees every match the wallet has a stake in.
    reconcileAll([other(9n), seven], HOLDER, 9);
    expect(readAttempt(7n, "commit", "holder")).toBeNull();
  });

  it("clears every orphaned action in one pass", () => {
    const m = {
      ...base,
      match_id: 7n,
      holder_committed: true,
      holder_funded: true,
      holder_claimed: true,
      holder_proposed_price: 750n,
      price_locked: true,
      holder_revealed: true,
      adjudicated: true,
      settled: true,
      holder_claimable: 0n,
      sink_claimable: 0n,
      refunded_before_lock: true,
    };
    for (const id of [
      "commit",
      "fund",
      "anchor_claim",
      "propose_price",
      "reveal",
      "adjudicate",
      "claim",
      "claim_sink",
      "refund_before_lock",
      "force_settle",
      "accept_sink",
    ] as const) {
      writeAttempt(7n, id, "holder", "pending", 1000);
    }

    reconcileAll([m], HOLDER, 7);

    for (const id of [
      "commit",
      "fund",
      "anchor_claim",
      "propose_price",
      "reveal",
      "adjudicate",
      "claim",
      "claim_sink",
      "refund_before_lock",
      "force_settle",
      "accept_sink",
    ] as const) {
      expect(readAttempt(7n, id, "holder"), `${id} should have been swept`).toBeNull();
    }
  });

  it("reads each match against its own seat", () => {
    // Wallet is the holder of one match and the buyer of another. Both have a
    // committed flag set for that wallet's own seat and not the other's.
    const asHolder = { ...base, match_id: 7n, holder_committed: true, buyer_committed: false };
    const asBuyer = {
      ...base,
      match_id: 8n,
      holder: BUYER,
      buyer: HOLDER,
      holder_committed: false,
      buyer_committed: true,
    };
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    // The wallet sits in the buyer seat here, so this is the buyer's record.
    writeAttempt(8n, "commit", "buyer", "pending", 1000);

    reconcileAll([asHolder, asBuyer], HOLDER, 8);

    expect(readAttempt(7n, "commit", "holder")).toBeNull();
    expect(readAttempt(8n, "commit", "buyer")).toBeNull();
  });

  it("leaves an attempt that genuinely has not landed", () => {
    writeAttempt(7n, "reveal", "holder", "pending", 1000);
    reconcileAll([{ ...base, match_id: 7n }], HOLDER, 7);
    expect(readAttempt(7n, "reveal", "holder")?.outcome).toBe("pending");
  });
});

describe("an orphaned create", () => {
  it("clears once the predicted id exists", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "holder", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", "holder", 6);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")?.target).toBe(6);

    // Discovery has not reached id 6 yet.
    reconcileCreate(5);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")?.outcome).toBe("pending");

    // Match 6 now answers, which is true at acceptance.
    reconcileCreate(6);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")).toBeNull();
  });

  it("clears through the app-level sweep as well", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "holder", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", "holder", 6);
    reconcileAll([], HOLDER, 6);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")).toBeNull();
  });

  it("keeps a create with no recorded target rather than guessing", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "holder", "pending", 1000);
    reconcileCreate(99);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")?.outcome).toBe("pending");
  });

  it("keeps the hash when the target is stamped on", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "holder", "pending", 1000);
    noteHash(CREATE_KEY_ID, "create_match", "holder", HASH);
    noteTarget(CREATE_KEY_ID, "create_match", "holder", 6);
    const rec = readAttempt(CREATE_KEY_ID, "create_match", "holder");
    expect(rec?.hash).toBe(HASH);
    expect(rec?.target).toBe(6);
    expect(rec?.startedAt).toBe(1000);
  });
});

describe("change notification", () => {
  it("tells listeners when a record is cleared", () => {
    let heard = 0;
    const stop = subscribe(() => { heard += 1; });
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    const afterWrite = heard;
    clearAttempt(7n, "commit", "holder");
    expect(heard).toBeGreaterThan(afterWrite);
    stop();
  });

  it("stops telling a listener that unsubscribed", () => {
    let heard = 0;
    const stop = subscribe(() => { heard += 1; });
    stop();
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    expect(heard).toBe(0);
  });

  it("fires for a sweep that clears somebody else's match", () => {
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    let heard = 0;
    const stop = subscribe(() => { heard += 1; });
    reconcileAll([{ ...base, match_id: 7n, holder_committed: true }], HOLDER, 7);
    expect(heard).toBeGreaterThan(0);
    stop();
  });

  it("survives a listener that throws", () => {
    let heard = 0;
    const bad = subscribe(() => { throw new Error("boom"); });
    const good = subscribe(() => { heard += 1; });
    expect(() => writeAttempt(7n, "commit", "holder", "pending", 1000)).not.toThrow();
    expect(heard).toBe(1);
    bad();
    good();
  });
});

describe("an orphaned sink proposal", () => {
  const NEW_SINK = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";

  const start = (target: string) => {
    writeAttempt(base.match_id, "propose_sink", "holder", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", "holder", target);
  };

  it("clears once pending_sink holds the proposed address", () => {
    start(NEW_SINK);

    // Nothing pending yet, so the proposal has not landed.
    reconcileSinkProposal(base);
    expect(readAttempt(base.match_id, "propose_sink", "holder")?.outcome).toBe("pending");

    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });
    expect(readAttempt(base.match_id, "propose_sink", "holder")).toBeNull();
  });

  it("matches the address whatever case it was typed in", () => {
    start(NEW_SINK.toLowerCase());
    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK.toUpperCase() });
    expect(readAttempt(base.match_id, "propose_sink", "holder")).toBeNull();
  });

  it("does not clear on somebody else's pending address", () => {
    start(NEW_SINK);
    reconcileSinkProposal({ ...base, pending_sink: BUYER });
    expect(readAttempt(base.match_id, "propose_sink", "holder")?.outcome).toBe("pending");
  });

  it("treats a cancel as landed when pending_sink goes back to zero", () => {
    // Proposing the zero address cancels a pending handover. Same comparison.
    const pending = { ...base, pending_sink: NEW_SINK };
    writeAttempt(base.match_id, "propose_sink", "holder", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", "holder", ZERO_ADDRESS);

    reconcileSinkProposal(pending);
    expect(readAttempt(base.match_id, "propose_sink", "holder")?.outcome).toBe("pending");

    reconcileSinkProposal({ ...base, pending_sink: ZERO_ADDRESS });
    expect(readAttempt(base.match_id, "propose_sink", "holder")).toBeNull();
  });

  it("keeps a proposal with no recorded address rather than guessing", () => {
    writeAttempt(base.match_id, "propose_sink", "holder", "pending", 1000);
    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });
    expect(readAttempt(base.match_id, "propose_sink", "holder")?.outcome).toBe("pending");
  });

  it("keeps the hash and the start time when the address is stamped on", () => {
    writeAttempt(base.match_id, "propose_sink", "holder", "pending", 1000);
    noteHash(base.match_id, "propose_sink", "holder", HASH);
    noteSinkTarget(base.match_id, "propose_sink", "holder", NEW_SINK);
    const rec = readAttempt(base.match_id, "propose_sink", "holder");
    expect(rec?.hash).toBe(HASH);
    expect(rec?.targetSink).toBe(NEW_SINK);
    expect(rec?.startedAt).toBe(1000);
  });

  it("clears through the app-level sweep, from any match", () => {
    start(NEW_SINK);
    // pending_sink is global contract state, so a different match answers too.
    const elsewhere = { ...base, match_id: 9n, pending_sink: NEW_SINK };
    reconcileAll([elsewhere, { ...base, pending_sink: NEW_SINK }], HOLDER, 9);
    expect(readAttempt(base.match_id, "propose_sink", "holder")).toBeNull();
  });
});

describe("closing propose_sink left everything else alone", () => {
  const NEW_SINK = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";

  it("does not touch another action's record on the same match", () => {
    writeAttempt(base.match_id, "propose_sink", "holder", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", "holder", NEW_SINK);
    writeAttempt(base.match_id, "reveal", "holder", "pending", 1000);
    writeAttempt(base.match_id, "accept_sink", "holder", "pending", 1000);

    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });

    expect(readAttempt(base.match_id, "propose_sink", "holder")).toBeNull();
    expect(readAttempt(base.match_id, "reveal", "holder")?.outcome).toBe("pending");
    expect(readAttempt(base.match_id, "accept_sink", "holder")?.outcome).toBe("pending");
  });

  it("leaves create_match reconciliation exactly as it was", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "holder", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", "holder", 6);
    // A sink proposal landing must not retire a create, and vice versa.
    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")?.outcome).toBe("pending");
    reconcileCreate(6);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")).toBeNull();
  });

  it("still clears accept_sink through the postcondition it always used", () => {
    writeAttempt(base.match_id, "accept_sink", "holder", "pending", 1000);
    reconcile({ ...base, pending_sink: ZERO_ADDRESS }, "holder");
    expect(readAttempt(base.match_id, "accept_sink", "holder")).toBeNull();
  });
});

/**
 * The base flow, guarded against the sweep having changed its meaning.
 *
 * The whole claim behind the app-level sweep is that only the caller moved,
 * never the test: a record is retired when its postcondition holds against
 * live state, exactly as before. These compare the two paths directly so a
 * future change to one that does not match the other fails here.
 */
describe("the criterion is the same one it always was", () => {
  // A claim is only ever journaled from a seat that has something to take,
  // so a realistic claim-in-flight state carries a nonzero claimable. Leaving
  // it at zero makes claim's postcondition true before anything is sent.
  const played = {
    ...base,
    holder_committed: true,
    holder_funded: true,
    holder_claimed: true,
    holder_proposed_price: 750n,
    price_locked: true,
    holder_revealed: true,
    adjudicated: true,
    settled: true,
    holder_claimable: STAKE,
  };

  const flow = [
    "commit",
    "fund",
    "anchor_claim",
    "propose_price",
    "reveal",
    "adjudicate",
    "claim",
  ] as const;

  const seed = () => {
    for (const id of flow) writeAttempt(base.match_id, id, "holder", "pending", 1000);
  };
  const survivors = () =>
    flow.filter((id) => readAttempt(base.match_id, id, "holder") !== null);

  it("retires the same actions through the sweep as through reconcile", () => {
    seed();
    reconcile(played, "holder");
    const viaReconcile = survivors();

    installStorage();
    seed();
    reconcileAll([played], HOLDER, 7);
    const viaSweep = survivors();

    expect(viaSweep).toEqual(viaReconcile);
  });

  it("retires exactly the steps that landed, and no others", () => {
    seed();
    reconcileAll([played], HOLDER, 7);
    // Every step this seat played is retired. claim is the one that has not
    // landed: the balance is still sitting there unclaimed.
    expect(survivors()).toEqual(["claim"]);
  });

  it("retires nothing on a match where nothing has landed", () => {
    installStorage();
    const fresh = {
      ...base,
      holder_committed: false,
      buyer_committed: false,
      holder_funded: false,
      holder_claimable: STAKE,
    };
    seed();
    reconcileAll([fresh], HOLDER, 7);
    expect(survivors()).toEqual([...flow]);
  });

  it("does not retire an action on a seat the wallet does not hold", () => {
    installStorage();
    // The holder played every step. A wallet sitting in the buyer seat has
    // landed nothing, and the sweep must read it that way.
    writeAttempt(base.match_id, "commit", "holder", "pending", 1000);
    writeAttempt(base.match_id, "reveal", "holder", "pending", 1000);
    reconcileAll([{ ...played, buyer_committed: false }], BUYER, 7);
    expect(readAttempt(base.match_id, "commit", "holder")?.outcome).toBe("pending");
    expect(readAttempt(base.match_id, "reveal", "holder")?.outcome).toBe("pending");
  });
});

/* ---------- one person, both wallets ------------------------------------ */

/**
 * The flow the README prescribes: two seats, two wallets, one browser, the
 * same person switching accounts between turns.
 *
 * Records used to be keyed by match and action only, so the two seats of one
 * match shared one. These are the two failures that followed, written as the
 * sequence that produced them.
 */
describe("two seats of one match do not share a record", () => {
  it("does not seed the buyer's panel from the holder's pending commit", () => {
    // The holder signs a commit. The record goes down as pending, with the
    // holder's hash on it.
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    noteHash(7n, "commit", "holder", HASH);

    // Before it confirms, the user switches to the buyer's wallet and the
    // buyer's CommitPanel mounts. resumable() reads exactly this, and a
    // non-null answer is what hid the buyer's form behind an in-flight notice
    // for a transaction the buyer never signed.
    expect(readAttempt(7n, "commit", "buyer")).toBeNull();

    // The holder's own record is untouched: it is still being watched.
    expect(readAttempt(7n, "commit", "holder")?.outcome).toBe("pending");
    expect(readAttempt(7n, "commit", "holder")?.hash).toBe(HASH);
  });

  it("does not clear the buyer's live commit when the sweep runs as holder", () => {
    // The buyer signs a commit and it is still in flight.
    writeAttempt(7n, "commit", "buyer", "pending", 1000);

    // The user switches to the holder's wallet. The app-level sweep runs on
    // every route, and the holder has already committed, so the holder's
    // postcondition holds. Against a shared record that cleared the buyer's
    // live attempt and re-enabled the button under a broadcast transaction.
    const m = { ...base, match_id: 7n, holder_committed: true, buyer_committed: false };
    reconcileAll([m], HOLDER, 7);

    expect(readAttempt(7n, "commit", "buyer")?.outcome).toBe("pending");
  });

  it("still clears each seat's record on its own postcondition", () => {
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    writeAttempt(7n, "commit", "buyer", "pending", 1000);
    const onlyHolder = { ...base, match_id: 7n, holder_committed: true, buyer_committed: false };

    reconcileAll([onlyHolder], HOLDER, 7);
    expect(readAttempt(7n, "commit", "holder")).toBeNull();
    expect(readAttempt(7n, "commit", "buyer")?.outcome).toBe("pending");

    const bothIn = { ...onlyHolder, buyer_committed: true };
    reconcileAll([bothIn], BUYER, 7);
    expect(readAttempt(7n, "commit", "buyer")).toBeNull();
  });

  it("keeps one shared record for an action both seats answer the same way", () => {
    // adjudicate is permissionless and its postcondition is a match-level
    // flag, so a single record is correct: either wallet's sweep retires it.
    writeAttempt(7n, "adjudicate", "holder", "pending", 1000);
    expect(readAttempt(7n, "adjudicate", "buyer")?.outcome).toBe("pending");
    expect(readAttempt(7n, "adjudicate", "buyer")?.seat).toBe("any");
  });
});

describe("the sweep skips a wallet with no seat", () => {
  it("leaves a seat's record alone when an outsider sweeps", () => {
    writeAttempt(7n, "commit", "holder", "pending", 1000);
    // OUTSIDER is neither seat. It used to be defaulted to holder, which read
    // the holder's postcondition and retired a record it had no claim on.
    reconcileAll([{ ...base, match_id: 7n, holder_committed: true }], OUTSIDER, 7);
    expect(readAttempt(7n, "commit", "holder")?.outcome).toBe("pending");
  });

  it("still reconciles a sink proposal for a wallet with no seat", () => {
    // The sink is normally an observer in every match, so skipping the seat
    // sweep must not take the sink's own reconciliation with it.
    const NEW_SINK = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";
    writeAttempt(base.match_id, "propose_sink", "holder", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", "holder", NEW_SINK);
    reconcileAll([{ ...base, pending_sink: NEW_SINK }], OUTSIDER, 7);
    expect(readAttempt(base.match_id, "propose_sink", "holder")).toBeNull();
  });

  it("still reconciles a create for a wallet with no seat", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "holder", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", "holder", 6);
    reconcileAll([], OUTSIDER, 6);
    expect(readAttempt(CREATE_KEY_ID, "create_match", "holder")).toBeNull();
  });
});

describe("the key is namespaced by contract", () => {
  it("ignores a record written under the old un-suffixed key", () => {
    // A redeploy mints its own ids from one. This is what a record from the
    // previous contract's match 1 looks like in a browser that has not been
    // cleared; it must not be picked up as this contract's match 1.
    localStorage.setItem(
      "carnage.attempt.1.commit",
      JSON.stringify({ actionId: "commit", startedAt: 1000, outcome: "pending" }),
    );
    expect(readAttempt(1n, "commit", "holder")).toBeNull();
  });

  it("writes under the contract this build talks to", () => {
    writeAttempt(1n, "commit", "holder", "pending", 1000);
    expect(localStorage.getItem(keyFor("1", "commit", "holder"))).not.toBeNull();
  });
});
