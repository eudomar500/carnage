import { beforeEach, describe, expect, it, vi } from "vitest";
import { feeFieldsOf, quoteFees, withFees } from "./fees";
import { setActiveNetwork, type ChainClient } from "./client";
import { DEFAULT_NETWORK_ID } from "./networks";

/**
 * The fee path, which exists entirely because consensus v0.6 refuses a write
 * without a deposit. Two failures are being guarded against, and both were
 * seen on the live network before this code existed:
 *
 *   a zero deposit          -> FeeValueMustBeNonZero(1), reverted at the
 *                              consensus contract
 *   allocations dropped     -> Mode1MessageFeesRequireGenVMPerEmissionSupport,
 *                              accepted, run, then rolled back
 *
 * Both are silent at the type level, so they are pinned here instead.
 */

const SPEC = {
  address: "0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0" as `0x${string}`,
  functionName: "adjudicate",
  args: [1],
};

/** Shaped like a real estimate for adjudicate, which emits the settle message. */
const ESTIMATE = {
  distribution: {
    leaderTimeunitsAllocation: "100",
    validatorTimeunitsAllocation: "200",
    totalMessageFees: "120000000000010352",
    rotations: ["3"],
  },
  feeValue: "120628548000020704",
  messageAllocations: [
    {
      messageType: 1,
      recipient: "0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0",
      callKey: "0x736574746c650000000000000000000000000000000000000000000000000000",
      budget: "120000000000010352",
    },
  ],
  // The estimator returns more than this; anything not named is not forwarded.
  policy: { enabled: true },
  observed: { messageFeeBudget: "120000000000010352" },
};

function clientWith(estimate: unknown): ChainClient {
  return {
    estimateTransactionFeesForWrite: vi.fn(async () => estimate),
  } as unknown as ChainClient;
}

beforeEach(() => {
  setActiveNetwork(DEFAULT_NETWORK_ID);
});

describe("feeFieldsOf", () => {
  it("forwards distribution and feeValue exactly as quoted", () => {
    const fields = feeFieldsOf(ESTIMATE);
    expect(fields.distribution).toBe(ESTIMATE.distribution);
    expect(fields.feeValue).toBe(ESTIMATE.feeValue);
  });

  it("forwards the allocation tree when the call emits a message", () => {
    expect(feeFieldsOf(ESTIMATE).messageAllocations).toBe(ESTIMATE.messageAllocations);
  });

  it("carries nothing the estimator did not return", () => {
    expect(Object.keys(feeFieldsOf(ESTIMATE)).sort()).toEqual([
      "distribution",
      "feeValue",
      "messageAllocations",
    ]);
  });

  it("omits the allocation key entirely for a call that emits nothing", () => {
    // Not an empty array: a write with no message must look to the SDK exactly
    // like a write that was never given allocations.
    const plain = feeFieldsOf({ ...ESTIMATE, messageAllocations: [] });
    expect("messageAllocations" in plain).toBe(false);
    const absent = feeFieldsOf({ distribution: {}, feeValue: "1" });
    expect("messageAllocations" in absent).toBe(false);
  });
});

describe("quoteFees", () => {
  it("does nothing on a network that takes no deposit", async () => {
    setActiveNetwork("bradbury");
    const client = clientWith(ESTIMATE);
    expect(await quoteFees(client, SPEC)).toBeUndefined();
    expect(client.estimateTransactionFeesForWrite).not.toHaveBeenCalled();
  });

  it("quotes before the write on a network that requires one", async () => {
    setActiveNetwork("studio-next");
    const client = clientWith(ESTIMATE);
    const fees = await quoteFees(client, SPEC);
    expect(fees?.feeValue).toBe(ESTIMATE.feeValue);
    expect(fees?.messageAllocations).toBe(ESTIMATE.messageAllocations);
    expect(client.estimateTransactionFeesForWrite).toHaveBeenCalledWith({
      address: SPEC.address,
      functionName: "adjudicate",
      args: [1],
      value: 0n,
    });
  });

  it("passes a payable call's value through to the estimate", async () => {
    setActiveNetwork("studio-next");
    const client = clientWith(ESTIMATE);
    await quoteFees(client, { ...SPEC, functionName: "fund_holder", value: 10n ** 16n });
    expect(client.estimateTransactionFeesForWrite).toHaveBeenCalledWith(
      expect.objectContaining({ value: 10n ** 16n }),
    );
  });

  it("refuses readably when the SDK cannot quote on a network that needs it", async () => {
    setActiveNetwork("studio-next");
    await expect(quoteFees({} as ChainClient, SPEC)).rejects.toThrow(/cannot estimate/);
  });
});

describe("withFees", () => {
  it("adds no argument at all when there are no fees", () => {
    const args = { address: SPEC.address, functionName: "claim", args: [1], value: 0n };
    const out = withFees(args, undefined);
    expect("fees" in out).toBe(false);
    expect(out).toEqual(args);
  });

  it("attaches the quote under `fees` without disturbing the call", () => {
    const args = { address: SPEC.address, functionName: "claim", args: [1], value: 0n };
    const fees = feeFieldsOf(ESTIMATE);
    const out = withFees(args, fees) as typeof args & { fees: unknown };
    expect(out.fees).toBe(fees);
    expect(out.functionName).toBe("claim");
    expect(out.value).toBe(0n);
  });
});
