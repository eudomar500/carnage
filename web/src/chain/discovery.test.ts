import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchState } from "./contract";

/**
 * Where the match walk stops, and what it says when it stops early.
 *
 * The walk has one stop condition: an id the contract does not know. Getting
 * that wrong in either direction is expensive. Read a transport fault as the
 * end and the page silently publishes a truncated record as complete. Read the
 * end as a fault and the page prints "a read failed, so the match list may be
 * incomplete" under a list that is, in fact, complete.
 *
 * The second is what Labs did on studio-next with three matches on the
 * contract. Both errors below are the real ones, captured from the live node
 * on 2026-09-15 by probing ids 4 and 5 of
 * 0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0.
 */

/** Ids 4 and 5: the contract's own UserError, base64 inside the receipt. */
const UNKNOWN_ID = () =>
  Object.assign(
    new Error("Missing or invalid parameters.\nDouble check you have provided the correct parameters."),
    {
      name: "InvalidInputRpcError",
      code: -32000,
      details: "execution failed",
      cause: {
        code: -32000,
        message: "execution failed",
        data: {
          receipt: {
            execution_result: "ERROR",
            result: "AVtFWFBFQ1RFRF0gdW5rbm93biBtYXRjaF9pZA==",
          },
        },
      },
    },
  );

/** The same probe once the visit has spent its thirty requests for the minute. */
const THROTTLED = () =>
  Object.assign(new Error("Rate limit exceeded: 30 requests per minute"), {
    name: "UnknownRpcError",
    code: -1,
    details: "Rate limit exceeded: 30 requests per minute",
    cause: { code: -32029, message: "Rate limit exceeded: 30 requests per minute" },
  });

/** A node that is simply not there. Retried, then reported. */
const TRANSPORT = () =>
  Object.assign(new Error("HTTP request failed."), {
    name: "HttpRequestError",
    details: "fetch failed",
  });

const match = (id: number) => ({ match_id: BigInt(id) }) as MatchState;

/** When each id was asked for, relative to the start of the walk. */
let askedAt: number[] = [];

/** Answers for id 1 upward, in order. A function throws; a number exists. */
let script: ((id: number) => MatchState)[] = [];
let calls: number[] = [];

vi.mock("./contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./contract")>();
  return {
    ...actual,
    getMatch: async (id: number | bigint) => {
      const n = Number(id);
      calls.push(n);
      askedAt.push(Date.now());
      const step = script[n - 1];
      if (!step) throw UNKNOWN_ID();
      return step(n);
    },
  };
});

const { discoverAllMatches } = await import("./discovery");
const { setActiveNetwork } = await import("./client");
const { takeDiscoverySlot } = await import("./pacing");

/** Runs the walk with every retry wait skipped rather than waited out. */
async function walkNow() {
  vi.useFakeTimers();
  try {
    const pending = discoverAllMatches();
    await vi.advanceTimersByTimeAsync(120_000);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(async () => {
  calls = [];
  askedAt = [];
  // The pacer keys its queue on the active network, so a read taken on the
  // unmetered one empties it. Each test below installs its own clock, and a
  // queue built against another test's clock is not one this test should
  // inherit.
  setActiveNetwork("bradbury");
  await takeDiscoverySlot();
  setActiveNetwork("studio-next");
});

afterEach(() => {
  setActiveNetwork("bradbury");
});

describe("a genuine unknown id", () => {
  it("ends the walk cleanly on the three matches the contract holds", async () => {
    script = [match, match, match];
    const r = await walkNow();
    expect(r.ids).toEqual([1, 2, 3]);
    expect(r.scannedTo).toBe(3);
    expect(r.degraded).toBeNull();
    expect(r.capped).toBe(false);
  });

  it("is not retried, because there is nothing there to read", async () => {
    script = [match, match, match];
    await walkNow();
    expect(calls.filter((id) => id === 4)).toHaveLength(1);
  });
});

describe("a throttled read", () => {
  it("is waited out rather than taken for the end of the record", async () => {
    // The failing case: ids 1 to 3 spend the last of the minute's budget and
    // the probe of id 4 is refused. Labs showed three matches and told the
    // reader the list might be missing some.
    let refused = false;
    script = [
      match,
      match,
      match,
      () => {
        if (refused) throw UNKNOWN_ID();
        refused = true;
        throw THROTTLED();
      },
    ];
    const r = await walkNow();
    expect(r.ids).toEqual([1, 2, 3]);
    expect(r.degraded).toBeNull();
    expect(calls.filter((id) => id === 4)).toHaveLength(2);
  });
});

describe("pacing on a network that meters reads", () => {
  it("walks the ids in single file, one every four seconds", async () => {
    // Four at a time against thirty reads a minute is three refusals and an
    // answer, and the refusals cost retries that leave the walk further behind
    // than running it in single file would have.
    script = [match, match, match];
    await walkNow();
    expect(calls).toEqual([1, 2, 3, 4]);
    const start = askedAt[0];
    expect(askedAt.map((t) => t - start)).toEqual([0, 4_000, 8_000, 12_000]);
  });

  it("asks for everything at once where reads are not counted", async () => {
    // Bradbury behaviour, unchanged: a batch of four and no gap between them.
    setActiveNetwork("bradbury");
    script = [match, match, match];
    await walkNow();
    expect(calls.slice(0, 4).sort()).toEqual([1, 2, 3, 4]);
    const start = askedAt[0];
    expect(askedAt.slice(0, 4).map((t) => t - start)).toEqual([0, 0, 0, 0]);
  });
});

describe("a fault that does not clear", () => {
  it("still degrades, and says the list may be incomplete", async () => {
    script = [
      match,
      () => {
        throw TRANSPORT();
      },
    ];
    const r = await walkNow();
    expect(r.degraded).toBe("a read failed, so the match list may be incomplete");
    // Tried, not assumed: three attempts before the walk gives up on the id.
    expect(calls.filter((id) => id === 2)).toHaveLength(3);
  });

  it("degrades on a throttle the node never lifts", async () => {
    script = [
      match,
      () => {
        throw THROTTLED();
      },
    ];
    const r = await walkNow();
    expect(r.degraded).toBe("a read failed, so the match list may be incomplete");
  });
});
