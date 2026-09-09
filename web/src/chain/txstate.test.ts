import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fixtures are the real match 3 adjudicate transactions, reduced to the
 * two fields the classifier reads. TX1 is the round that finalized and wrote
 * nothing; TX2 is the one that wrote the verdict now in state.
 */
const TX1 = "0x1e4e5dbc1c632892e3ee174fc695bd30547f00e2d11dae51465b0084eaf448eb";
const TX2 = "0xfe6cc1fb26c9f37152e569e1018b37a9a3838bdaa3112c07ee44ee30e3da22c8";

const chain: Record<string, { statusName: string; resultName: string }> = {
  [TX1]: { statusName: "FINALIZED", resultName: "TIMEOUT" },
  [TX2]: { statusName: "ACCEPTED", resultName: "AGREE" },
};

const getTransaction = vi.fn(async ({ hash }: { hash: string }) => {
  const tx = chain[hash];
  if (!tx) throw new Error("not found");
  return tx;
});

vi.mock("./client", () => ({ readClient: () => ({ getTransaction }) }));

const { readTxVerdict } = await import("./txstate");

beforeEach(() => {
  getTransaction.mockClear();
});

describe("the transaction that finalized without writing", () => {
  it("is terminal and discarded", async () => {
    const v = await readTxVerdict(TX1);
    expect(v).toEqual({
      terminal: true,
      discarded: true,
      statusName: "FINALIZED",
      resultName: "TIMEOUT",
    });
  });
});

describe("the transaction that wrote the verdict", () => {
  it("is not terminal yet, and not discarded", async () => {
    const v = await readTxVerdict(TX2);
    expect(v).toEqual({
      terminal: false,
      discarded: false,
      statusName: "ACCEPTED",
      resultName: "AGREE",
    });
  });

  it("stays undiscarded once it finalizes", async () => {
    chain[TX2] = { statusName: "FINALIZED", resultName: "AGREE" };
    const v = await readTxVerdict(TX2);
    expect(v).toEqual({
      terminal: true,
      discarded: false,
      statusName: "FINALIZED",
      resultName: "AGREE",
    });
    chain[TX2] = { statusName: "ACCEPTED", resultName: "AGREE" };
  });
});

describe("states that must not reopen a step", () => {
  const live = [
    "PENDING",
    "PROPOSING",
    "COMMITTING",
    "REVEALING",
    "ACCEPTED",
    "APPEAL_COMMITTING",
    "APPEAL_REVEALING",
    "READY_TO_FINALIZE",
    // These three can still be appealed or rolled into a further round, so
    // calling them dead would reopen a step under a live transaction.
    "UNDETERMINED",
    "VALIDATORS_TIMEOUT",
    "LEADER_TIMEOUT",
  ];

  for (const statusName of live) {
    it(`${statusName} is not terminal`, async () => {
      chain["0xlive"] = { statusName, resultName: "IDLE" };
      const v = await readTxVerdict("0xlive");
      expect(v?.terminal).toBe(false);
      expect(v?.discarded).toBe(false);
    });
  }
});

describe("terminal results", () => {
  const cases: [string, boolean][] = [
    ["AGREE", false],
    ["MAJORITY_AGREE", false],
    ["TIMEOUT", true],
    ["DISAGREE", true],
    ["MAJORITY_DISAGREE", true],
    ["NO_MAJORITY", true],
    ["DETERMINISTIC_VIOLATION", true],
    ["IDLE", true],
  ];

  for (const [resultName, discarded] of cases) {
    it(`FINALIZED with ${resultName} -> discarded=${discarded}`, async () => {
      chain["0xterm"] = { statusName: "FINALIZED", resultName };
      expect((await readTxVerdict("0xterm"))?.discarded).toBe(discarded);
    });
  }

  it("treats CANCELED as discarded whatever the result says", async () => {
    chain["0xcancel"] = { statusName: "CANCELED", resultName: "AGREE" };
    const v = await readTxVerdict("0xcancel");
    expect(v?.terminal).toBe(true);
    expect(v?.discarded).toBe(true);
  });
});

describe("read failures are not evidence", () => {
  it("returns null when the node cannot be reached", async () => {
    expect(await readTxVerdict("0xmissing")).toBeNull();
  });

  it("returns null for a transaction with no status", async () => {
    chain["0xempty"] = { statusName: "", resultName: "" };
    expect(await readTxVerdict("0xempty")).toBeNull();
  });
});
