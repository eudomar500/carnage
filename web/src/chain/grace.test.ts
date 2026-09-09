import { beforeEach, describe, expect, it } from "vitest";
import { CARNAGE_ADDRESS } from "./client";
import type { MatchState } from "./contract";
import { ZERO_ADDRESS } from "./roles";
import {
  SETTLE_GRACE_SECONDS,
  forceSettleGate,
  formatWait,
  noteObserved,
  readObservedAt,
} from "./grace";

const HOLDER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const BUYER = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const SINK = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";
const STAKE = 1_000n;
const NOW = 1_800_000_000;

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

/** Adjudicated, verdict stored, settlement has not run. */
const base: MatchState = {
  match_id: 11n,
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
  buyer_funded: true,
  holder_claim: "mine is 780",
  buyer_claim: "mine is 900",
  holder_claimed: true,
  buyer_claimed: true,
  holder_proposed_price: 750n,
  buyer_proposed_price: 750n,
  deal_price: 750n,
  price_locked: true,
  holder_revealed: true,
  buyer_revealed: true,
  holder_revealed_state: 650n,
  buyer_revealed_state: 900n,
  adjudicated: true,
  settled: false,
  holder_label: "TRUE",
  buyer_label: "TRUE",
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
  buyer_escrow: STAKE,
  escrow_total: STAKE * 2n,
  credited_total: 0n,
  paid_total: 0n,
  lock_deadline: BigInt(NOW - 86400),
  refunded_before_lock: false,
  no_reveal_outcome: "",
  coherence_known: true,
  coherent: true,
};

const at = (m: Partial<MatchState>): MatchState => ({ ...base, ...m });

beforeEach(installStorage);

describe("recording the sighting", () => {
  it("records the first time an unsettled verdict is seen", () => {
    noteObserved(base, NOW);
    expect(readObservedAt(base.match_id)).toBe(NOW);
  });

  it("never moves the clock forward on a later sighting", () => {
    noteObserved(base, NOW);
    noteObserved(base, NOW + 3600);
    expect(readObservedAt(base.match_id)).toBe(NOW);
  });

  it("records nothing for a match that has not been adjudicated", () => {
    noteObserved(at({ adjudicated: false }), NOW);
    expect(readObservedAt(base.match_id)).toBeNull();
  });

  it("drops the record once settlement has run", () => {
    noteObserved(base, NOW);
    noteObserved(at({ settled: true }), NOW + 60);
    expect(readObservedAt(base.match_id)).toBeNull();
  });

  it("returns null rather than throwing on stored garbage", () => {
    const key = `carnage.adjudicated.${CARNAGE_ADDRESS.toLowerCase()}.${base.match_id}`;
    localStorage.setItem(key, "{not json");
    expect(readObservedAt(base.match_id)).toBeNull();
  });

  it("ignores a record with no usable timestamp", () => {
    const key = `carnage.adjudicated.${CARNAGE_ADDRESS.toLowerCase()}.${base.match_id}`;
    localStorage.setItem(key, JSON.stringify({ at: "soon" }));
    expect(readObservedAt(base.match_id)).toBeNull();
  });
});

describe("the gate", () => {
  it("is closed when there is no verdict", () => {
    expect(forceSettleGate(at({ adjudicated: false }), NOW).state).toBe("closed");
  });

  it("is closed once settlement has run", () => {
    expect(forceSettleGate(at({ settled: true }), NOW).state).toBe("closed");
  });

  it("waits the full grace from a first sighting with no record", () => {
    const gate = forceSettleGate(base, NOW);
    expect(gate).toEqual({
      state: "waiting",
      observedAt: NOW,
      readyAt: NOW + SETTLE_GRACE_SECONDS,
      secondsLeft: SETTLE_GRACE_SECONDS,
    });
  });

  it("counts down from the recorded sighting, not from now", () => {
    noteObserved(base, NOW);
    const gate = forceSettleGate(base, NOW + 3600);
    expect(gate.state).toBe("waiting");
    if (gate.state !== "waiting") throw new Error("expected waiting");
    expect(gate.secondsLeft).toBe(SETTLE_GRACE_SECONDS - 3600);
  });

  it("opens once the grace has passed", () => {
    noteObserved(base, NOW);
    expect(forceSettleGate(base, NOW + SETTLE_GRACE_SECONDS).state).toBe("open");
    expect(forceSettleGate(base, NOW + SETTLE_GRACE_SECONDS + 1).state).toBe("open");
  });

  it("stays shut one second before the grace expires", () => {
    noteObserved(base, NOW);
    expect(forceSettleGate(base, NOW + SETTLE_GRACE_SECONDS - 1).state).toBe("waiting");
  });
});

describe("the countdown line", () => {
  it("rounds a short wait up to a minute", () => {
    expect(formatWait(1)).toBe("about a minute");
    expect(formatWait(60)).toBe("about a minute");
  });

  it("reports minutes under an hour", () => {
    expect(formatWait(61)).toBe("about 2 min");
    expect(formatWait(1800)).toBe("about 30 min");
  });

  it("reports hours and minutes above an hour", () => {
    expect(formatWait(3600)).toBe("about 1h");
    expect(formatWait(SETTLE_GRACE_SECONDS)).toBe("about 2h");
    expect(formatWait(6420)).toBe("about 1h 47m");
  });
});
