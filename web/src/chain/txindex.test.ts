import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Studio Next transaction source, against what the node actually returned.
 *
 * src/chain/txindex.fixture.json is one real response from
 * sim_getTransactionsForAddress, recorded on 2026-09-16 against the deployed
 * contract. Every field the module reads is verbatim; what was dropped is the
 * contract_snapshot and fee ledger attached to each transaction, which this app
 * never touches and which would have put 7.7 MB in the repository to pin
 * nothing. The calldata is untouched base64, so the decoder here runs against
 * real bytes rather than against something a test wrote to be decodable.
 *
 * The client is mocked because these are pure mapping questions: which method a
 * transaction called, which match it belongs to, whether its verdict was
 * applied. The one test that goes through fetch mocks fetch, not the mapping.
 */

vi.mock("./client", () => ({
  CARNAGE_ADDRESS: "0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0",
  // Studio Next's address, so history.ts loads Studio Next's committed index
  // rather than Bradbury's, and Studio Next's capability, so the scan routes
  // to this source instead of to the log walk.
  capabilities: () => ({ txIndexSource: "rpc-index" }),
  activeNetwork: () => ({ rpcUrl: "https://studio-next.genlayer.com/api" }),
  CHAIN: { consensusMainContract: undefined },
  readClient: () => ({}),
}));

import fixture from "./txindex.fixture.json";
import {
  consensusResult,
  decodeListedCall,
  fetchContractTransactions,
  forgetContractTransactions,
  listedToEntries,
  listedToEntry,
} from "./txindex";
import { isApplied, oldestFirst } from "./labs";
import { convergenceOf, convergenceSummary } from "./labs";

const LISTED = fixture.result as any[];
const ENTRIES = listedToEntries(LISTED);

afterEach(() => {
  forgetContractTransactions();
  vi.unstubAllGlobals();
});

/* ---------- the response itself ------------------------------------------ */

describe("the recorded response", () => {
  it("is the whole history of the contract in one reply", () => {
    // 41 is what the node returned and what the explorer's own header says for
    // this address. The point of the source is that this is not a page.
    expect(LISTED).toHaveLength(41);
    expect(fixture.contract).toBe("0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0");
  });
});

/* ---------- decoding ------------------------------------------------------ */

describe("decoding a listed call", () => {
  it("reads the method and its arguments out of real calldata", () => {
    // This node's calldata is the bare GenLayer blob in base64, with no RLP
    // envelope, and genlayer-js 2.0 keys the method under the empty string.
    // Getting either wrong returns null for every transaction on the network.
    const settle = LISTED.find((t) => t.hash.startsWith("0x0c17328d"));
    expect(decodeListedCall(settle.data.calldata)).toEqual({
      method: "settle",
      args: [3n],
    });
  });

  it("reads the deployment as arguments with no method", () => {
    // The constructor call, withdrawals_enabled=false. It links to no step, and
    // the committed indexes record their own deployments the same way.
    const deploy = LISTED.find((t) => t.hash.startsWith("0x12fca484"));
    expect(decodeListedCall(deploy.data.calldata)).toEqual({ method: null, args: [false] });
  });

  it("returns null rather than throwing on anything that is not calldata", () => {
    expect(decodeListedCall(undefined)).toBeNull();
    expect(decodeListedCall("")).toBeNull();
    expect(decodeListedCall("not base64 at all")).toBeNull();
  });

  it("decodes every transaction the node returned", () => {
    // One undecodable transaction is one proof link that silently never
    // renders, so the whole response is put through the decoder, not a sample.
    const named = ENTRIES.filter((e) => e.method !== null);
    expect(named).toHaveLength(40);
    expect(ENTRIES.filter((e) => e.method === null)).toHaveLength(1);
  });
});

/* ---------- attribution --------------------------------------------------- */

describe("attributing a transaction to a match", () => {
  it("takes the match id from the first argument of a per-match call", () => {
    const adjudications = ENTRIES.filter((e) => e.method === "adjudicate");
    expect(adjudications.map((e) => e.matchId)).toEqual(["1", "2", "3"]);
  });

  it("names no match for create_match, whose id is its return value", () => {
    const created = ENTRIES.filter((e) => e.method === "create_match");
    expect(created).toHaveLength(3);
    expect(created.every((e) => e.matchId === null)).toBe(true);
  });

  it("covers every per-match call in the record, not only the linked ones", () => {
    // Attribution has to hold for the whole lifecycle: if commit_holder were
    // mis-parsed, the bug would only surface on a later match shape.
    const scoped = ENTRIES.filter(
      (e) => e.method !== null && e.method !== "create_match",
    );
    expect(scoped.every((e) => e.matchId !== null)).toBe(true);
    expect([...new Set(scoped.map((e) => e.matchId))].sort()).toEqual(["1", "2", "3"]);
  });
});

/* ---------- the two facts this node reports separately -------------------- */

describe("whether a verdict was applied", () => {
  it("reads the node's own word for consensus taking the execution", () => {
    // ACCEPTED is this node's AGREE. It is carried through rather than renamed,
    // and chain/labs.ts knows both words.
    const adjudications = ENTRIES.filter((e) => e.method === "adjudicate");
    expect(adjudications.map((e) => e.result)).toEqual(["ACCEPTED", "ACCEPTED", "ACCEPTED"]);
    expect(adjudications.every((e) => isApplied(e.status, e.result))).toBe(true);
  });

  it("refuses an execution that reverted, however consensus voted", () => {
    // The claim on match 1, which the contract rejected because withdrawals do
    // not execute on this network. Consensus accepted the transaction; the call
    // still wrote nothing. Counting it as applied would credit a withdrawal
    // that never happened.
    const claim = ENTRIES.find((e) => e.method === "claim");
    expect(claim?.status).toBe("FINALIZED");
    expect(claim?.result).toBe("ERRORED");
    expect(isApplied(claim!.status, claim!.result)).toBe(false);
  });

  it("separates the consensus decision from the execution outcome", () => {
    expect(
      consensusResult({
        txExecutionResultName: "FINISHED_WITH_RETURN",
        consensus_history: { latestDecision: { status: "ACCEPTED" } },
      }),
    ).toBe("ACCEPTED");
    expect(
      consensusResult({
        txExecutionResultName: "FINISHED_WITH_ERROR",
        consensus_history: { latestDecision: { status: "ACCEPTED" } },
      }),
    ).toBe("ERRORED");
  });
});

/* ---------- blocks this network does not have ----------------------------- */

describe("a network that numbers no blocks", () => {
  it("carries a time and never invents a block", () => {
    // A zero here would print as "block 0" under a hash a reader could look up,
    // which is worse than saying nothing.
    expect(ENTRIES.every((e) => e.block === null)).toBe(true);
    expect(ENTRIES.every((e) => typeof e.at === "string" && e.at.endsWith("Z"))).toBe(true);
  });

  it("orders by time, oldest first, so a re-read is comparable", () => {
    const times = ENTRIES.map((e) => e.at as string);
    expect([...times].sort()).toEqual(times);
  });

  it("normalises the node's microseconds to whole seconds", () => {
    // created_at arrives as "2026-09-15T15:09:48.629409+00:00". Rendering that
    // under a verdict is noise, and it would make two snapshots of the same
    // transaction compare unequal on the fractional part alone.
    const settle = listedToEntry(LISTED.find((t) => t.hash.startsWith("0x0c17328d")));
    expect(settle.at).toBe("2026-09-15T15:09:48Z");
  });

  it("sorts attempts by time where there is no block to sort by", () => {
    const attempts = ENTRIES.filter((e) => e.method === "adjudicate").map((e) => ({
      txId: e.hash,
      block: e.block,
      at: e.at ?? null,
      statusName: e.status,
      resultName: e.result,
      rounds: e.rounds,
      applied: isApplied(e.status, e.result),
    }));
    const shuffled = [attempts[2], attempts[0], attempts[1]];
    expect([...shuffled].sort(oldestFirst).map((a) => a.txId)).toEqual(
      attempts.map((a) => a.txId),
    );
  });
});

/* ---------- convergence --------------------------------------------------- */

describe("convergence off this source", () => {
  it("counts rotations from the node's own rotation_count", () => {
    // The field that replaces Bradbury's numOfRounds. Every transaction in the
    // record settled on the first pass, which is a measurement and not a
    // missing value: the fixture's rotation counts are all real zeros.
    expect(ENTRIES.every((e) => Number.isInteger(e.rounds) && e.rounds >= 0)).toBe(true);
    expect(ENTRIES.filter((e) => e.method === "adjudicate").map((e) => e.rounds)).toEqual([0, 0, 0]);
  });

  it("reports three clean matches with nothing discarded", () => {
    const byMatch = new Map<string, any[]>();
    for (const e of ENTRIES) {
      if (e.method !== "adjudicate" || !e.matchId) continue;
      const list = byMatch.get(e.matchId) ?? [];
      list.push({
        txId: e.hash, block: e.block, at: e.at ?? null,
        statusName: e.status, resultName: e.result, rounds: e.rounds,
        applied: isApplied(e.status, e.result),
      });
      byMatch.set(e.matchId, list);
    }
    const rows = [...byMatch.entries()]
      .map(([id, a]) => convergenceOf(BigInt(id), [...a].sort(oldestFirst)))
      .sort((a, b) => Number(a.matchId - b.matchId));
    expect(convergenceSummary(rows)).toEqual({
      matches: 3,
      withVerdict: 3,
      attempts: 3,
      clean: 3,
      discarded: 0,
    });
  });
});

/* ---------- the request --------------------------------------------------- */

describe("the request itself", () => {
  const ok = (result: unknown) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) as any);

  it("asks the active network's RPC for this contract's transactions", async () => {
    const fetchSpy = ok(LISTED);
    vi.stubGlobal("fetch", fetchSpy);

    const out = await fetchContractTransactions();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, any];
    expect(url).toBe("https://studio-next.genlayer.com/api");
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_getTransactionsForAddress",
      params: ["0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0"],
    });
    expect(out).toHaveLength(41);
  });

  it("costs one request however many callers ask", async () => {
    // The replay and the lab both want this, and the response is 164 KB on the
    // wire. Two of them racing would be two.
    const fetchSpy = ok(LISTED);
    vi.stubGlobal("fetch", fetchSpy);

    const [a, b] = await Promise.all([
      fetchContractTransactions(),
      fetchContractTransactions(),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("does not cache a failure, so the next caller may try again", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", failing as any);
    await expect(fetchContractTransactions()).rejects.toThrow("network down");

    const fetchSpy = ok(LISTED);
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchContractTransactions()).resolves.toHaveLength(41);
  });

  it("reports the node's own words when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ error: { message: "Rate limit exceeded: 30 requests per minute" } }),
      })) as any,
    );
    await expect(fetchContractTransactions()).rejects.toThrow("Rate limit exceeded");
  });

  it("refuses a reply that is not a list rather than reading it as empty", async () => {
    // An empty result and a malformed one are different facts. Treating the
    // second as the first would print "no transaction found" over a contract
    // whose transactions the node simply did not send.
    vi.stubGlobal("fetch", ok({ unexpected: true }));
    await expect(fetchContractTransactions()).rejects.toThrow("no transaction list");
  });
});

/* ---------- the scan, routed to this source ------------------------------- */

describe("a match lookup on a network with no consensus log", () => {
  /*
   * scanMatchTransactions dispatches on txIndexSource before it touches a
   * chain. The point of these is that on this network it never reaches
   * getLogs, which answers [] here for every range, and that what it returns
   * is the same MatchTx shape the replay already renders.
   */
  const ok = (result: unknown) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) as any);

  it("answers from the listing, with no log query at all", async () => {
    vi.stubGlobal("fetch", ok(LISTED));
    const { scanMatchTransactions } = await import("./txlog");

    const out = await scanMatchTransactions(3n, ["adjudicate"]);

    expect(out.source).toBe("rpc-index");
    expect(out.degraded).toBeNull();
    expect(out.exhausted).toBe(false);
    // Never a window count on a source that has no windows.
    expect(out.windowsScanned).toBe(0);
    expect(out.tailCapped).toBe(false);

    const adjudicate = out.txs.find((t) => t.method === "adjudicate");
    expect(adjudicate?.txId).toBe(
      "0x8010f9dd56de561ff55ea7537067ed0b2e09f327965ad8c08d982858e1c00b05",
    );
    expect(adjudicate?.status).toBe("FINALIZED");
    // The hash is what a proof link needs; the block is what this chain has
    // not got, and the time is what it prints instead.
    expect(adjudicate?.block).toBeNull();
    expect(adjudicate?.at).toBe("2026-09-15T15:08:54Z");
  });

  it("links the settlement as well as the verdict", async () => {
    vi.stubGlobal("fetch", ok(LISTED));
    const { scanMatchTransactions } = await import("./txlog");
    const out = await scanMatchTransactions(3n, ["adjudicate"]);
    expect(out.txs.find((t) => t.method === "settle")?.txId).toBe(
      "0x0c17328d817facdb0f026fce953a0c4c500635936457c2b9cb605b873d9d503a",
    );
  });

  it("attributes nothing to a match the contract never minted", async () => {
    vi.stubGlobal("fetch", ok(LISTED));
    const { scanMatchTransactions } = await import("./txlog");
    const out = await scanMatchTransactions(99n, ["adjudicate"]);
    expect(out.txs).toEqual([]);
    expect(out.exhausted).toBe(true);
  });

  it("survives the node being unreachable, because the index already answered", async () => {
    // This is the whole reason the index is committed on a chain that resets by
    // design. A match the file holds needs no request at all, so no outage and
    // no state wipe can take its hashes away, and the links still open on the
    // explorer. The same short-circuit is what stops the 164 KB listing being
    // fetched to rediscover something already in hand.
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", failing as any);

    const { scanMatchTransactions } = await import("./txlog");
    const out = await scanMatchTransactions(3n, ["adjudicate"]);

    expect(failing).not.toHaveBeenCalled();
    expect(out.degraded).toBeNull();
    expect(out.indexResolved).toBe(true);
    expect(out.txs.some((t) => t.method === "adjudicate")).toBe(true);
  });

  it("reports an unreachable node rather than calling a match absent", async () => {
    // A match the index does not hold is the case that needs the listing. When
    // the request fails there is nothing to show, and the difference between
    // "not found" and "could not look" has to survive to the reader.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as any,
    );
    const { scanMatchTransactions } = await import("./txlog");
    const out = await scanMatchTransactions(4n, ["adjudicate"]);
    expect(out.degraded).toContain("network down");
    expect(out.exhausted).toBe(true);
  });
});
