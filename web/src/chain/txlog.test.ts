import { describe, expect, it, vi } from "vitest";

/**
 * The chain, mocked at the client boundary.
 *
 * Every RPC entry point is a spy, so "did this cost a request" is a question
 * the test can answer directly rather than by timing anything.
 */
const rpc = vi.hoisted(() => {
  const getBlockNumber = vi.fn(async () => 0n);
  const getLogs = vi.fn(async () => [] as unknown[]);
  const getTransaction = vi.fn(async () => ({}) as unknown);
  const readClient = vi.fn(() => ({ getBlockNumber, getLogs, getTransaction }));
  return { getBlockNumber, getLogs, getTransaction, readClient };
});

vi.mock("./client", () => ({
  CARNAGE_ADDRESS: "0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A",
  CHAIN: {
    consensusMainContract: {
      address: "0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575",
      abi: [
        {
          type: "event",
          name: "NewTransaction",
          inputs: [
            { name: "txId", type: "bytes32", indexed: true },
            { name: "recipient", type: "address", indexed: true },
            { name: "activator", type: "address", indexed: true },
          ],
        },
      ],
    },
    blockExplorers: { default: { url: "https://explorer-bradbury.genlayer.com" } },
  },
  readClient: rpc.readClient,
}));

import { scanMatchTransactions } from "./txlog";

describe("a match the committed index already answers", () => {
  it("costs no RPC at all", async () => {
    rpc.readClient.mockClear();
    rpc.getBlockNumber.mockClear();
    rpc.getLogs.mockClear();
    rpc.getTransaction.mockClear();

    // Match 2 settled below the snapshot block, so its adjudicate call is in
    // the index with a terminal status.
    const out = await scanMatchTransactions(2n, ["adjudicate"]);

    expect(rpc.readClient).not.toHaveBeenCalled();
    expect(rpc.getBlockNumber).not.toHaveBeenCalled();
    expect(rpc.getLogs).not.toHaveBeenCalled();
    expect(rpc.getTransaction).not.toHaveBeenCalled();

    expect(out.txs.some((t) => t.method === "adjudicate")).toBe(true);
    expect(out.indexResolved).toBe(true);
    expect(out.exhausted).toBe(false);
    expect(out.degraded).toBeNull();
    expect(out.windowsScanned).toBe(0);
    expect(out.blocksScanned).toBe(0);
    expect(out.tailCapped).toBe(false);
  });

  it("still reaches the chain for a match the index does not hold", async () => {
    rpc.readClient.mockClear();
    rpc.getBlockNumber.mockClear();

    // An id with nothing in the index. The mocked head sits below the snapshot,
    // so the walk plans no windows and returns after the one block read.
    const out = await scanMatchTransactions(999n, ["adjudicate"]);

    expect(rpc.readClient).toHaveBeenCalled();
    expect(rpc.getBlockNumber).toHaveBeenCalled();
    expect(out.indexResolved).toBe(false);
    expect(out.exhausted).toBe(true);
  });
});
