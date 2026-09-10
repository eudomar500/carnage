import { beforeEach, describe, expect, it } from "vitest";
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
    writeAttempt(7n, "commit", "pending", 1000);
    expect(readAttempt(7n, "commit")).toEqual({
      actionId: "commit",
      startedAt: 1000,
      outcome: "pending",
    });
  });

  it("keeps records for different actions apart", () => {
    writeAttempt(7n, "commit", "pending", 1000);
    writeAttempt(7n, "fund", "unconfirmed", 2000);
    expect(readAttempt(7n, "commit")?.outcome).toBe("pending");
    expect(readAttempt(7n, "fund")?.outcome).toBe("unconfirmed");
  });

  it("keeps records for different matches apart", () => {
    writeAttempt(7n, "commit", "pending", 1000);
    expect(readAttempt(8n, "commit")).toBeNull();
  });

  it("returns null rather than throwing on stored garbage", () => {
    localStorage.setItem("carnage.attempt.7.commit", "{not json");
    expect(readAttempt(7n, "commit")).toBeNull();
  });

  it("rejects a record with no timestamp", () => {
    localStorage.setItem("carnage.attempt.7.commit", JSON.stringify({ outcome: "pending" }));
    expect(readAttempt(7n, "commit")).toBeNull();
  });

  it("clears a record", () => {
    writeAttempt(7n, "commit", "pending");
    clearAttempt(7n, "commit");
    expect(readAttempt(7n, "commit")).toBeNull();
  });
});

describe("transaction hash", () => {
  it("stamps a hash without disturbing when the attempt started", () => {
    writeAttempt(7n, "reveal", "pending", 1000);
    noteHash(7n, "reveal", HASH);
    expect(readAttempt(7n, "reveal")).toEqual({
      actionId: "reveal",
      startedAt: 1000,
      outcome: "pending",
      hash: HASH,
    });
  });

  it("carries the hash across an outcome change when it is passed back in", () => {
    writeAttempt(7n, "reveal", "pending", 1000);
    noteHash(7n, "reveal", HASH);
    const prior = readAttempt(7n, "reveal")!;
    writeAttempt(7n, "reveal", "unconfirmed", prior.startedAt, prior.hash);
    expect(readAttempt(7n, "reveal")).toEqual({
      actionId: "reveal",
      startedAt: 1000,
      outcome: "unconfirmed",
      hash: HASH,
    });
  });

  it("does not let a fresh attempt inherit the dead one's hash", () => {
    writeAttempt(7n, "reveal", "pending", 1000);
    noteHash(7n, "reveal", HASH);
    writeAttempt(7n, "reveal", "pending", 5000);
    expect(readAttempt(7n, "reveal")?.hash).toBeUndefined();
  });

  it("does nothing when there is no attempt to stamp", () => {
    noteHash(7n, "reveal", HASH);
    expect(readAttempt(7n, "reveal")).toBeNull();
  });
});

describe("reconcile", () => {
  it("drops a record whose change is visible on-chain", () => {
    writeAttempt(base.match_id, "commit", "pending", 1000);
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "commit")).toBeNull();
  });

  it("keeps a record whose change has not landed", () => {
    writeAttempt(base.match_id, "fund", "pending", 1000);
    reconcile(base, "buyer");
    expect(readAttempt(base.match_id, "fund")?.outcome).toBe("pending");
  });

  it("reads the postcondition for the right seat", () => {
    writeAttempt(base.match_id, "fund", "pending", 1000);
    // The holder funded, the buyer did not. Same action, opposite answers.
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "fund")).toBeNull();
  });

  it("leaves an action that has no postcondition alone", () => {
    writeAttempt(base.match_id, "create_match", "pending", 1000);
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "create_match")?.outcome).toBe("pending");
  });

  it("sweeps every action in one pass", () => {
    writeAttempt(base.match_id, "commit", "pending", 1000);
    writeAttempt(base.match_id, "fund", "pending", 1000);
    writeAttempt(base.match_id, "reveal", "pending", 1000);
    reconcile(base, "holder");
    expect(readAttempt(base.match_id, "commit")).toBeNull();
    expect(readAttempt(base.match_id, "fund")).toBeNull();
    expect(readAttempt(base.match_id, "reveal")?.outcome).toBe("pending");
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
    writeAttempt(7n, "commit", "pending", 1000);

    // The old per-match reconcile only ever saw the visible match.
    reconcile(other(9n), "holder");
    expect(readAttempt(7n, "commit")?.outcome).toBe("pending");

    // The sweep sees every match the wallet has a stake in.
    reconcileAll([other(9n), seven], HOLDER, 9);
    expect(readAttempt(7n, "commit")).toBeNull();
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
      writeAttempt(7n, id, "pending", 1000);
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
      expect(readAttempt(7n, id), `${id} should have been swept`).toBeNull();
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
    writeAttempt(7n, "commit", "pending", 1000);
    writeAttempt(8n, "commit", "pending", 1000);

    reconcileAll([asHolder, asBuyer], HOLDER, 8);

    expect(readAttempt(7n, "commit")).toBeNull();
    expect(readAttempt(8n, "commit")).toBeNull();
  });

  it("leaves an attempt that genuinely has not landed", () => {
    writeAttempt(7n, "reveal", "pending", 1000);
    reconcileAll([{ ...base, match_id: 7n }], HOLDER, 7);
    expect(readAttempt(7n, "reveal")?.outcome).toBe("pending");
  });
});

describe("an orphaned create", () => {
  it("clears once the predicted id exists", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", 6);
    expect(readAttempt(CREATE_KEY_ID, "create_match")?.target).toBe(6);

    // Discovery has not reached id 6 yet.
    reconcileCreate(5);
    expect(readAttempt(CREATE_KEY_ID, "create_match")?.outcome).toBe("pending");

    // Match 6 now answers, which is true at acceptance.
    reconcileCreate(6);
    expect(readAttempt(CREATE_KEY_ID, "create_match")).toBeNull();
  });

  it("clears through the app-level sweep as well", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", 6);
    reconcileAll([], HOLDER, 6);
    expect(readAttempt(CREATE_KEY_ID, "create_match")).toBeNull();
  });

  it("keeps a create with no recorded target rather than guessing", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "pending", 1000);
    reconcileCreate(99);
    expect(readAttempt(CREATE_KEY_ID, "create_match")?.outcome).toBe("pending");
  });

  it("keeps the hash when the target is stamped on", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "pending", 1000);
    noteHash(CREATE_KEY_ID, "create_match", HASH);
    noteTarget(CREATE_KEY_ID, "create_match", 6);
    const rec = readAttempt(CREATE_KEY_ID, "create_match");
    expect(rec?.hash).toBe(HASH);
    expect(rec?.target).toBe(6);
    expect(rec?.startedAt).toBe(1000);
  });
});

describe("change notification", () => {
  it("tells listeners when a record is cleared", () => {
    let heard = 0;
    const stop = subscribe(() => { heard += 1; });
    writeAttempt(7n, "commit", "pending", 1000);
    const afterWrite = heard;
    clearAttempt(7n, "commit");
    expect(heard).toBeGreaterThan(afterWrite);
    stop();
  });

  it("stops telling a listener that unsubscribed", () => {
    let heard = 0;
    const stop = subscribe(() => { heard += 1; });
    stop();
    writeAttempt(7n, "commit", "pending", 1000);
    expect(heard).toBe(0);
  });

  it("fires for a sweep that clears somebody else's match", () => {
    writeAttempt(7n, "commit", "pending", 1000);
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
    expect(() => writeAttempt(7n, "commit", "pending", 1000)).not.toThrow();
    expect(heard).toBe(1);
    bad();
    good();
  });
});

describe("an orphaned sink proposal", () => {
  const NEW_SINK = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";

  const start = (target: string) => {
    writeAttempt(base.match_id, "propose_sink", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", target);
  };

  it("clears once pending_sink holds the proposed address", () => {
    start(NEW_SINK);

    // Nothing pending yet, so the proposal has not landed.
    reconcileSinkProposal(base);
    expect(readAttempt(base.match_id, "propose_sink")?.outcome).toBe("pending");

    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });
    expect(readAttempt(base.match_id, "propose_sink")).toBeNull();
  });

  it("matches the address whatever case it was typed in", () => {
    start(NEW_SINK.toLowerCase());
    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK.toUpperCase() });
    expect(readAttempt(base.match_id, "propose_sink")).toBeNull();
  });

  it("does not clear on somebody else's pending address", () => {
    start(NEW_SINK);
    reconcileSinkProposal({ ...base, pending_sink: BUYER });
    expect(readAttempt(base.match_id, "propose_sink")?.outcome).toBe("pending");
  });

  it("treats a cancel as landed when pending_sink goes back to zero", () => {
    // Proposing the zero address cancels a pending handover. Same comparison.
    const pending = { ...base, pending_sink: NEW_SINK };
    writeAttempt(base.match_id, "propose_sink", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", ZERO_ADDRESS);

    reconcileSinkProposal(pending);
    expect(readAttempt(base.match_id, "propose_sink")?.outcome).toBe("pending");

    reconcileSinkProposal({ ...base, pending_sink: ZERO_ADDRESS });
    expect(readAttempt(base.match_id, "propose_sink")).toBeNull();
  });

  it("keeps a proposal with no recorded address rather than guessing", () => {
    writeAttempt(base.match_id, "propose_sink", "pending", 1000);
    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });
    expect(readAttempt(base.match_id, "propose_sink")?.outcome).toBe("pending");
  });

  it("keeps the hash and the start time when the address is stamped on", () => {
    writeAttempt(base.match_id, "propose_sink", "pending", 1000);
    noteHash(base.match_id, "propose_sink", HASH);
    noteSinkTarget(base.match_id, "propose_sink", NEW_SINK);
    const rec = readAttempt(base.match_id, "propose_sink");
    expect(rec?.hash).toBe(HASH);
    expect(rec?.targetSink).toBe(NEW_SINK);
    expect(rec?.startedAt).toBe(1000);
  });

  it("clears through the app-level sweep, from any match", () => {
    start(NEW_SINK);
    // pending_sink is global contract state, so a different match answers too.
    const elsewhere = { ...base, match_id: 9n, pending_sink: NEW_SINK };
    reconcileAll([elsewhere, { ...base, pending_sink: NEW_SINK }], HOLDER, 9);
    expect(readAttempt(base.match_id, "propose_sink")).toBeNull();
  });
});

describe("closing propose_sink left everything else alone", () => {
  const NEW_SINK = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";

  it("does not touch another action's record on the same match", () => {
    writeAttempt(base.match_id, "propose_sink", "pending", 1000);
    noteSinkTarget(base.match_id, "propose_sink", NEW_SINK);
    writeAttempt(base.match_id, "reveal", "pending", 1000);
    writeAttempt(base.match_id, "accept_sink", "pending", 1000);

    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });

    expect(readAttempt(base.match_id, "propose_sink")).toBeNull();
    expect(readAttempt(base.match_id, "reveal")?.outcome).toBe("pending");
    expect(readAttempt(base.match_id, "accept_sink")?.outcome).toBe("pending");
  });

  it("leaves create_match reconciliation exactly as it was", () => {
    writeAttempt(CREATE_KEY_ID, "create_match", "pending", 1000);
    noteTarget(CREATE_KEY_ID, "create_match", 6);
    // A sink proposal landing must not retire a create, and vice versa.
    reconcileSinkProposal({ ...base, pending_sink: NEW_SINK });
    expect(readAttempt(CREATE_KEY_ID, "create_match")?.outcome).toBe("pending");
    reconcileCreate(6);
    expect(readAttempt(CREATE_KEY_ID, "create_match")).toBeNull();
  });

  it("still clears accept_sink through the postcondition it always used", () => {
    writeAttempt(base.match_id, "accept_sink", "pending", 1000);
    reconcile({ ...base, pending_sink: ZERO_ADDRESS }, "holder");
    expect(readAttempt(base.match_id, "accept_sink")).toBeNull();
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
    for (const id of flow) writeAttempt(base.match_id, id, "pending", 1000);
  };
  const survivors = () =>
    flow.filter((id) => readAttempt(base.match_id, id) !== null);

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
    writeAttempt(base.match_id, "commit", "pending", 1000);
    writeAttempt(base.match_id, "reveal", "pending", 1000);
    reconcileAll([{ ...played, buyer_committed: false }], BUYER, 7);
    expect(readAttempt(base.match_id, "commit")?.outcome).toBe("pending");
    expect(readAttempt(base.match_id, "reveal")?.outcome).toBe("pending");
  });
});
