import { describe, expect, it } from "vitest";
import { settlementCaption } from "./settlement-copy";

/**
 * The settlement frame is the one place the replay talks about money leaving.
 * On a deployment that cannot execute a transfer it used to say the unclaimed
 * figures "fall to zero as claim() is called", printed directly above a figure
 * that never falls, because claim() reverts on that contract before it reads a
 * balance.
 */
describe("the settlement frame caption", () => {
  it("promises the drain only where withdrawals execute", () => {
    expect(settlementCaption(true)).toBe(
      "Awards are recomputed from the recorded outcome using the contract's own rule, so they stay correct after each side withdraws. The unclaimed figures are live and fall to zero as claim() is called.",
    );
  });

  it("says why the figures stay put where they do not", () => {
    const caption = settlementCaption(false);
    expect(caption).toBe(
      "Awards are recomputed from the recorded outcome using the contract's own rule, so they stay correct whatever the ledger reads. Withdrawals are disabled on this deployment, so the unclaimed figures are what settlement credited and claim() cannot move them.",
    );
    expect(caption).not.toContain("fall to zero");
    expect(caption).not.toContain("after each side withdraws");
  });

  it("recomputes the awards either way, because that part does not depend on the network", () => {
    for (const withdrawals of [true, false]) {
      expect(settlementCaption(withdrawals)).toContain(
        "Awards are recomputed from the recorded outcome using the contract's own rule",
      );
    }
  });
});
