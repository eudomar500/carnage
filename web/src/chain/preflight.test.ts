import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveNetwork } from "./client";
import { DEFAULT_NETWORK_ID } from "./networks";
import { stageOf } from "./errors";

/**
 * Which call the preflight actually simulates, per network and per value.
 *
 * This exists because of a failure on Studio Next that no type could catch.
 * fund_buyer is payable and the contract's last check is
 * `gl.message.value == stake_amount`, so a simulation that drops the value is
 * a simulation of a call the contract is bound to refuse. On Bradbury that
 * was survivable: the node returns the GenVM ReturnData, the refusal arrives
 * as "must fund exactly stake_amount", and reaching exactly that guard means
 * every earlier precondition passed, so it was treated as a pass. On Studio
 * Next the same failure carries no revert bytes at all. It surfaced as
 * "Missing or invalid parameters" before the wallet ever opened, with nothing
 * in it to recognise, and a seat that had committed could not fund.
 *
 * The two SDK majors are the reason the behaviour differs, and it was read
 * out of them rather than guessed: 1.2's simulateWriteContract destructures
 * account, address, functionName, args, kwargs and leaderOnly and never looks
 * at a value, while 2.0 writes a non-zero value into the gen_call params and
 * the Studio node honours it. So the value is attached where it is carried
 * and the guard allowance is kept where it is not, and both halves are pinned
 * here with a client that records what it was asked to do.
 */

const ACCOUNT = "0xFeE34b22628Fa0D5B8fA64Ba7c49835EcB18e752" as `0x${string}`;
const MATCH = 2n;
const STAKE = 10n ** 16n;
const HASH = "0x7cf79dc18a5714d6f0b0046b2011f74f95f7c84b87e57e3edd9d56d83ad0ab79";

/** Shaped like a Studio Next estimate for a call that emits no message. */
const ESTIMATE = {
  distribution: { leaderTimeunitsAllocation: "100" },
  feeValue: "613819200010352",
  messageAllocations: [],
};

type Recorded = { method: string; args: any };

const stub = vi.hoisted(() => ({
  calls: [] as Recorded[],
  /** Set to make the next simulateWriteContract reject with this error. */
  simulateError: null as Error | null,
  reset() {
    this.calls = [];
    this.simulateError = null;
  },
}));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  const client = {
    simulateWriteContract: async (args: any) => {
      stub.calls.push({ method: "simulateWriteContract", args });
      if (stub.simulateError) throw stub.simulateError;
      return null;
    },
    estimateTransactionFeesForWrite: async (args: any) => {
      stub.calls.push({ method: "estimateTransactionFeesForWrite", args });
      return ESTIMATE;
    },
    writeContract: async (args: any) => {
      stub.calls.push({ method: "writeContract", args });
      return HASH;
    },
    waitForTransactionReceipt: async (args: any) => {
      stub.calls.push({ method: "waitForTransactionReceipt", args });
      return { status: "ACCEPTED" };
    },
  };
  // A Proxy rather than a spread: CARNAGE_ADDRESS and friends are live
  // bindings that setActiveNetwork rewrites, and a spread would freeze them at
  // whichever network happened to be active when the mock was built.
  const overrides: Record<string, unknown> = {
    simulationClient: () => client,
    writeClient: () => client,
  };
  return new Proxy(actual, {
    get: (target, prop, recv) =>
      prop in overrides ? overrides[prop as string] : Reflect.get(target, prop, recv),
  });
});

const { fund, preflight } = await import("./actions");

/** Every method the stub was asked for, in order. */
function methods(): string[] {
  return stub.calls.map((c) => c.method);
}

function firstCall(method: string): any {
  return stub.calls.find((c) => c.method === method)?.args;
}

beforeEach(() => {
  stub.reset();
  setActiveNetwork(DEFAULT_NETWORK_ID);
});

describe("preflight", () => {
  it("simulates a payable call with its value on a network that carries one", async () => {
    setActiveNetwork("studio-next");
    await preflight(ACCOUNT, { functionName: "fund_buyer", args: [MATCH], value: STAKE });
    expect(methods()).toEqual(["simulateWriteContract"]);
    expect(firstCall("simulateWriteContract").value).toBe(STAKE);
  });

  it("leaves Bradbury's simulation exactly as it was, with no value argument", async () => {
    setActiveNetwork("bradbury");
    await preflight(ACCOUNT, { functionName: "fund_buyer", args: [MATCH], value: STAKE });
    // Not `value: undefined`: the 1.2 SDK ignores the key either way, and the
    // point of the gate is that the call it builds is unchanged.
    expect("value" in firstCall("simulateWriteContract")).toBe(false);
  });

  it("adds no value to a call that has none, on either network", async () => {
    for (const id of ["bradbury", "studio-next"] as const) {
      stub.reset();
      setActiveNetwork(id);
      await preflight(ACCOUNT, { functionName: "commit_buyer", args: [MATCH, "0x00"] });
      expect("value" in firstCall("simulateWriteContract")).toBe(false);
    }
  });

  it("reports a refusal at the preflight stage, so nothing was sent", async () => {
    setActiveNetwork("studio-next");
    stub.simulateError = new Error("sender is not the buyer");
    const err = await preflight(ACCOUNT, { functionName: "fund_buyer", args: [MATCH] }).catch(
      (e) => e,
    );
    expect(stageOf(err)).toBe("preflight");
    expect(err.message).toContain("sender is not the buyer");
  });
});

describe("fund", () => {
  it("preflights, quotes and sends the same value on Studio Next", async () => {
    setActiveNetwork("studio-next");
    await fund(ACCOUNT, MATCH, "buyer", STAKE);
    // The estimator runs its own simulation with the value, so on this network
    // the call is executed twice before the wallet opens and refused twice if
    // it cannot pass. Order matters: nothing is quoted for a call the node has
    // already refused.
    expect(methods()).toEqual([
      "simulateWriteContract",
      "estimateTransactionFeesForWrite",
      "writeContract",
      "waitForTransactionReceipt",
    ]);
    expect(firstCall("simulateWriteContract").value).toBe(STAKE);
    expect(firstCall("estimateTransactionFeesForWrite").value).toBe(STAKE);
    expect(firstCall("writeContract").value).toBe(STAKE);
    expect(firstCall("writeContract").fees.feeValue).toBe(ESTIMATE.feeValue);
  });

  it("does not swallow the value guard where the value was simulated", async () => {
    setActiveNetwork("studio-next");
    stub.simulateError = new Error("must fund exactly stake_amount");
    const err = await fund(ACCOUNT, MATCH, "buyer", STAKE).catch((e) => e);
    expect(stageOf(err)).toBe("preflight");
    // Refused with the value we would have sent, so sending it anyway is only
    // a wallet confirmation spent to be told the same thing.
    expect(methods()).toEqual(["simulateWriteContract"]);
  });

  it("still treats the value guard as a pass on Bradbury, which cannot simulate it", async () => {
    setActiveNetwork("bradbury");
    stub.simulateError = new Error("[EXPECTED] must fund exactly stake_amount");
    const result = await fund(ACCOUNT, MATCH, "holder", STAKE);
    expect(result.hash).toBe(HASH);
    // No fee quote: that network takes no deposit.
    expect(methods()).toEqual([
      "simulateWriteContract",
      "writeContract",
      "waitForTransactionReceipt",
    ]);
    expect(firstCall("writeContract").value).toBe(STAKE);
    expect("fees" in firstCall("writeContract")).toBe(false);
  });

  it("stops on Bradbury for any refusal that is not the value guard", async () => {
    setActiveNetwork("bradbury");
    stub.simulateError = new Error("[EXPECTED] both sides must commit before funding");
    const err = await fund(ACCOUNT, MATCH, "holder", STAKE).catch((e) => e);
    expect(stageOf(err)).toBe("preflight");
    expect(err.message).toContain("both sides must commit");
    expect(methods()).toEqual(["simulateWriteContract"]);
  });
});
