import { beforeEach, describe, expect, it } from "vitest";
import type { MatchState } from "./contract";
import { ZERO_ADDRESS } from "./roles";
import { clearAttempt, noteHash, readAttempt, reconcile, writeAttempt } from "./journal";

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
