import { describe, expect, it } from "vitest";
import {
  claimGate,
  sinkClaimGate,
  withdrawalsEnabled,
  WITHDRAWALS_DISABLED_NOTE,
  type MatchState,
} from "./contract";

/**
 * The claim gate on a deployment that cannot pay.
 *
 * Studio Next finalizes emit_transfer without moving value, so the contract
 * deployed there carries withdrawals_enabled=false and refuses claim() before
 * it touches a balance. The app must not offer the call: the fee estimator on
 * that network rejects it ahead of sending and reports only "execution
 * failed", so a reader who pressed a button would be shown a generic error
 * instead of the contract's own explanation.
 *
 * The important property is that the balance survives. A gate that reported
 * "nothing to claim" would be a lie about the ledger.
 */

const HOLDER = "0x612f985025feeB57B617d548Baf46371E310EaAF";
const BUYER = "0xA55C20DbD9096420F310b0a4E7c0DEe62660B85a";
const SINK = "0x1111111111111111111111111111111111111111";

function settled(over: Partial<MatchState> = {}): MatchState {
  return {
    match_id: 1n,
    holder: HOLDER,
    buyer: BUYER,
    sink_address: SINK,
    settled: true,
    no_reveal_resolved: false,
    inconclusive_resolved: false,
    refunded_before_lock: false,
    holder_claimable: 0n,
    buyer_claimable: 20000000000000000n,
    sink_claimable: 0n,
    ...over,
  } as unknown as MatchState;
}

describe("withdrawalsEnabled", () => {
  it("treats a contract without the field as paying, which Bradbury always did", () => {
    expect(withdrawalsEnabled(settled())).toBe(true);
  });

  it("reads the flag when the deployment carries one", () => {
    expect(withdrawalsEnabled(settled({ withdrawals_enabled: true }))).toBe(true);
    expect(withdrawalsEnabled(settled({ withdrawals_enabled: false }))).toBe(false);
  });
});

describe("claimGate with withdrawals disabled", () => {
  it("reports the credited balance rather than offering the claim", () => {
    const gate = claimGate(settled({ withdrawals_enabled: false }), BUYER as `0x${string}`);
    expect(gate.state).toBe("withdrawals-disabled");
    if (gate.state !== "withdrawals-disabled") throw new Error("unreachable");
    expect(gate.amount).toBe(20000000000000000n);
    expect(gate.reason).toBe(WITHDRAWALS_DISABLED_NOTE);
  });

  it("never reports ready, so no surface can render a claim button", () => {
    const gate = claimGate(settled({ withdrawals_enabled: false }), BUYER as `0x${string}`);
    expect(gate.state).not.toBe("ready");
  });

  it("still says nothing to claim when the party is owed nothing", () => {
    // The restriction is only worth mentioning to someone it costs something.
    const gate = claimGate(settled({ withdrawals_enabled: false }), HOLDER as `0x${string}`);
    expect(gate.state).toBe("nothing-to-claim");
  });

  it("still refuses a wallet that is not a party", () => {
    const gate = claimGate(settled({ withdrawals_enabled: false }), SINK as `0x${string}`);
    expect(gate.state).toBe("not-a-party");
  });

  it("still waits for settlement before saying anything about withdrawals", () => {
    const gate = claimGate(
      settled({ withdrawals_enabled: false, settled: false }),
      BUYER as `0x${string}`,
    );
    expect(gate.state).toBe("not-settled");
  });

  it("is unchanged on a deployment that pays", () => {
    const gate = claimGate(settled({ withdrawals_enabled: true }), BUYER as `0x${string}`);
    expect(gate.state).toBe("ready");
  });
});

describe("sinkClaimGate with withdrawals disabled", () => {
  it("reports the sink balance without offering the claim", () => {
    const m = settled({ withdrawals_enabled: false, sink_claimable: 5000n });
    const gate = sinkClaimGate(m, SINK as `0x${string}`);
    expect(gate.state).toBe("withdrawals-disabled");
    if (gate.state !== "withdrawals-disabled") throw new Error("unreachable");
    expect(gate.amount).toBe(5000n);
  });

  it("is unchanged on a deployment that pays", () => {
    const m = settled({ withdrawals_enabled: true, sink_claimable: 5000n });
    expect(sinkClaimGate(m, SINK as `0x${string}`).state).toBe("ready");
  });
});
