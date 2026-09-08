import { describe, expect, it } from "vitest";
import type { MatchState } from "./contract";
import { ZERO_ADDRESS } from "./roles";
import {
  actionCount,
  buildRoster,
  notificationsForMatch,
  notificationsForMatches,
} from "./notifications";

const HOLDER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const BUYER = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const SINK = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";
const STRANGER = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";

const NOW = 1_800_000_000;
const STAKE = 1_000n;

/** A funded, priced, revealed, settled match with both sides honest. */
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
  settled: true,
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
  credited_total: STAKE * 2n,
  paid_total: 0n,
  lock_deadline: BigInt(NOW - 3600),
  refunded_before_lock: false,
  no_reveal_outcome: "",
  coherence_known: true,
  coherent: true,
};

const at = (m: Partial<MatchState>): MatchState => ({ ...base, ...m });
const kinds = (m: MatchState, w: string | null) =>
  notificationsForMatch(m, w, NOW).map((n) => n.kind);

describe("no wallet, no notifications", () => {
  it("returns nothing when no wallet is connected", () => {
    expect(notificationsForMatch(base, null, NOW)).toEqual([]);
  });
});

describe("funds to claim", () => {
  it("notifies a party with a settled balance", () => {
    const m = at({ holder_claimable: STAKE * 2n });
    expect(kinds(m, HOLDER)).toContain("claim");
    expect(kinds(m, BUYER)).not.toContain("claim");
  });

  it("notifies the sink when the sink is owed", () => {
    const m = at({ sink_claimable: STAKE, holder_label: "FALSE", buyer_label: "FALSE" });
    expect(kinds(m, SINK)).toContain("claim");
  });

  it("reports one item when a wallet is owed as both party and sink", () => {
    const m = at({
      sink_address: HOLDER,
      holder_claimable: STAKE,
      sink_claimable: STAKE,
      holder_label: "MISLEADING",
      buyer_label: "MISLEADING",
    });
    const claims = notificationsForMatch(m, HOLDER, NOW).filter((n) => n.kind === "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].detail).toContain("both");
  });

  it("clears itself once the balance is withdrawn", () => {
    const owed = at({ holder_claimable: STAKE * 2n });
    const taken = at({ holder_claimable: 0n });
    expect(kinds(owed, HOLDER)).toContain("claim");
    expect(kinds(taken, HOLDER)).not.toContain("claim");
  });

  it("says nothing before the match resolves", () => {
    const m = at({ settled: false, adjudicated: false, holder_claimable: STAKE });
    expect(kinds(m, HOLDER)).not.toContain("claim");
  });
});

describe("your move", () => {
  it("notifies the side that owes the next step", () => {
    const m = at({
      adjudicated: false,
      settled: false,
      holder_committed: false,
      buyer_committed: true,
      holder_funded: false,
      buyer_funded: false,
      holder_claimed: false,
      buyer_claimed: false,
      price_locked: false,
      holder_revealed: false,
      buyer_revealed: false,
      holder_proposed_price: 0n,
      buyer_proposed_price: 0n,
      credited_total: 0n,
    });
    expect(kinds(m, HOLDER)).toContain("your-move");
    expect(kinds(m, BUYER)).not.toContain("your-move");
  });

  it("says nothing to a stranger", () => {
    const m = at({ adjudicated: false, settled: false, holder_committed: false });
    expect(kinds(m, STRANGER)).toEqual([]);
  });
});

describe("recovery", () => {
  const stalled = at({
    adjudicated: false,
    settled: false,
    price_locked: false,
    holder_revealed: false,
    buyer_revealed: false,
    holder_proposed_price: 0n,
    buyer_proposed_price: 0n,
    credited_total: 0n,
    lock_deadline: BigInt(NOW - 60),
  });

  it("offers the refund once the lock deadline has passed", () => {
    expect(kinds(stalled, HOLDER)).toContain("recovery");
  });

  it("stays quiet before the lock deadline", () => {
    const early = at({ ...stalled, lock_deadline: BigInt(NOW + 3600) });
    expect(kinds(early, HOLDER)).not.toContain("recovery");
  });

  it("stops once the refund has been taken", () => {
    const done = at({ ...stalled, refunded_before_lock: true });
    expect(kinds(done, HOLDER)).not.toContain("recovery");
  });

  it("offers force settlement for an adjudicated but unsettled match", () => {
    const m = at({ settled: false });
    expect(kinds(m, HOLDER)).toContain("recovery");
  });

  it("does not nag a stranger about someone else's stuck match", () => {
    expect(kinds(stalled, STRANGER)).toEqual([]);
  });

  it("does tell the sink, which has money at stake", () => {
    const m = at({ settled: false, sink_address: STRANGER });
    expect(kinds(m, STRANGER)).toContain("recovery");
  });
});

describe("pending sink", () => {
  it("notifies only the proposed address", () => {
    const m = at({ pending_sink: STRANGER });
    expect(kinds(m, STRANGER)).toContain("pending-sink");
    expect(kinds(m, SINK)).not.toContain("pending-sink");
  });

  it("ignores a zero pending sink", () => {
    expect(kinds(base, SINK)).not.toContain("pending-sink");
  });
});

describe("both sides adverse", () => {
  const bothLied = at({
    holder_label: "FALSE",
    buyer_label: "MISLEADING",
    sink_claimable: STAKE + STAKE / 2n,
    buyer_claimable: STAKE - STAKE / 2n,
  });

  it("tells a party where the slashed stake went", () => {
    const items = notificationsForMatch(bothLied, HOLDER, NOW);
    const info = items.find((n) => n.kind === "sink-forfeit");
    expect(info).toBeDefined();
    expect(info?.severity).toBe("info");
    expect(info?.detail).toContain("protocol sink");
  });

  it("does not tell a stranger", () => {
    expect(kinds(bothLied, STRANGER)).not.toContain("sink-forfeit");
  });

  it("stays silent when only one side lied", () => {
    const m = at({ holder_label: "FALSE", buyer_label: "TRUE", buyer_claimable: STAKE * 2n });
    expect(kinds(m, HOLDER)).not.toContain("sink-forfeit");
  });
});

describe("keys and counting", () => {
  it("keys are stable across polls and unique per match and kind", () => {
    const m = at({ holder_claimable: STAKE });
    const first = notificationsForMatch(m, HOLDER, NOW);
    const second = notificationsForMatch(m, HOLDER, NOW + 600);
    expect(first.map((n) => n.key)).toEqual(second.map((n) => n.key));
    expect(new Set(first.map((n) => n.key)).size).toBe(first.length);
  });

  it("counts action items only", () => {
    const items = notificationsForMatch(
      at({ holder_label: "FALSE", buyer_label: "FALSE", holder_claimable: STAKE }),
      HOLDER,
      NOW,
    );
    expect(items.some((n) => n.severity === "info")).toBe(true);
    expect(actionCount(items)).toBe(items.filter((n) => n.severity === "action").length);
  });

  it("flattens several matches", () => {
    const a = at({ match_id: 1n, holder_claimable: STAKE });
    const b = at({ match_id: 2n, holder_claimable: STAKE });
    const items = notificationsForMatches([a, b], HOLDER, NOW);
    expect(items.map((n) => n.matchId)).toEqual([1n, 2n]);
  });

  it("an empty match list produces nothing", () => {
    expect(notificationsForMatches([], HOLDER, NOW)).toEqual([]);
  });
});

describe("roster", () => {
  it("is empty with no wallet", () => {
    expect(buildRoster([base], null, [])).toEqual([]);
  });

  it("names the wallet's role in each match", () => {
    const roster = (w: string) => buildRoster([base], w, [])[0];
    expect(roster(HOLDER).role).toBe("HOLDER");
    expect(roster(BUYER).role).toBe("BUYER");
    expect(roster(SINK).role).toBe("SINK");
  });

  it("takes its status from derivePhase, including the refund terminal", () => {
    const settled = buildRoster([base], HOLDER, [])[0];
    expect(settled.status).toBe("SETTLED");

    const refunded = at({
      match_id: 9n,
      adjudicated: false,
      settled: false,
      price_locked: false,
      holder_revealed: false,
      buyer_revealed: false,
      refunded_before_lock: true,
    });
    expect(buildRoster([refunded], HOLDER, [])[0].status).toBe("REFUNDED");

    const negotiating = at({
      match_id: 4n,
      adjudicated: false,
      settled: false,
      price_locked: false,
      holder_claimed: false,
      buyer_claimed: false,
      holder_revealed: false,
      buyer_revealed: false,
    });
    expect(buildRoster([negotiating], HOLDER, [])[0].status).toBe("NEGOTIATING");
  });

  it("puts matches needing action first, then the newest", () => {
    const one = at({ match_id: 1n });
    const two = at({ match_id: 2n });
    const three = at({ match_id: 3n, holder_claimable: STAKE });
    const items = notificationsForMatches([one, two, three], HOLDER, NOW);
    const roster = buildRoster([one, two, three], HOLDER, items);
    expect(roster.map((r) => Number(r.matchId))).toEqual([3, 2, 1]);
    expect(roster[0].needsAction).toBe(true);
    expect(roster[1].needsAction).toBe(false);
  });

  it("ranks an older match needing action above a newer quiet one", () => {
    const old = at({ match_id: 1n, holder_claimable: STAKE });
    const recent = at({ match_id: 8n });
    const items = notificationsForMatches([old, recent], HOLDER, NOW);
    const roster = buildRoster([old, recent], HOLDER, items);
    expect(roster.map((r) => Number(r.matchId))).toEqual([1, 8]);
  });

  it("does not mark a match as needing action for an info item alone", () => {
    const bothLied = at({
      match_id: 5n,
      holder_label: "FALSE",
      buyer_label: "FALSE",
      sink_claimable: STAKE * 2n,
    });
    const items = notificationsForMatch(bothLied, HOLDER, NOW);
    expect(items.every((n) => n.severity === "info")).toBe(true);
    expect(buildRoster([bothLied], HOLDER, items)[0].needsAction).toBe(false);
  });
});
