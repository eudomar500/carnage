import { beforeEach, describe, expect, it } from "vitest";
import {
  historyEntryToTx,
  indexAnswersMatch,
  mergeMatchTxs,
  readCachedTransactions,
  tailWindows,
  writeCachedTransactions,
  type LinkedMethod,
  type MatchTx,
  type ScanOutcome,
} from "./txlog";
import {
  DEPLOY_BLOCK,
  HISTORY,
  historyByMethod,
  historyFor,
  isTerminalStatus,
  SNAPSHOT_BLOCK,
  staleEntries,
} from "./history";
import { indexedAttempts } from "../hooks/useLabData";
import { convergenceOf, convergenceSummary } from "./labs";
import type { HistoryEntry } from "./history";

const tx = (method: string, txId: string, block: string, status = "FINALIZED"): MatchTx =>
  ({ method, txId, block, status }) as MatchTx;

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  hash: "0xaa" as `0x${string}`,
  block: 1,
  method: "adjudicate",
  matchId: "1",
  sender: "0xf0",
  status: "FINALIZED",
  result: "AGREE",
  rounds: 0,
  ...over,
});

/* ---------- the committed index ----------------------------------------- */

describe("the committed index", () => {
  it("covers the contract from its deploy block", () => {
    expect(DEPLOY_BLOCK).toBe(HISTORY.deployBlock);
    expect(SNAPSHOT_BLOCK).toBeGreaterThan(DEPLOY_BLOCK);
    expect(HISTORY.transactions.every((e) => e.block >= DEPLOY_BLOCK)).toBe(true);
    expect(HISTORY.transactions.every((e) => e.block <= SNAPSHOT_BLOCK)).toBe(true);
  });

  it("is sorted by block, so a regenerated file stays comparable", () => {
    const blocks = HISTORY.transactions.map((e) => e.block);
    expect([...blocks].sort((a, b) => a - b)).toEqual(blocks);
  });

  it("holds every adjudicate attempt, discarded rounds included", () => {
    const adj = historyByMethod("adjudicate");
    expect(adj.length).toBe(10);
    const discarded = adj.filter((e) => e.result !== "AGREE" && e.result !== "MAJORITY_AGREE");
    expect(discarded.map((e) => e.result).sort()).toEqual(["NO_MAJORITY", "TIMEOUT"]);
  });

  it("reports any entry that was still in flight, so the runtime re-reads it", () => {
    // A snapshot can legitimately catch a transaction before it finalizes.
    // What must hold is that such an entry is visible as stale rather than
    // trusted, which is what sends it back to the node at runtime.
    const notTerminal = HISTORY.transactions.filter((e) => !isTerminalStatus(e.status));
    expect(staleEntries(HISTORY.transactions)).toEqual(notTerminal);
  });

  it("records consensus rounds, which contract state does not hold", () => {
    const adj = historyByMethod("adjudicate");
    // Rounds are what the convergence chart measures, so a zero everywhere
    // would silently turn every fought verdict into a clean one.
    expect(adj.some((e) => e.rounds > 0)).toBe(true);
    expect(adj.every((e) => Number.isInteger(e.rounds) && e.rounds >= 0)).toBe(true);
  });

  it("records a match id for per-match calls and none for create_match", () => {
    for (const e of HISTORY.transactions) {
      if (e.method === "adjudicate" || e.method === "settle") expect(e.matchId).not.toBeNull();
      if (e.method === "create_match") expect(e.matchId).toBeNull();
    }
  });
});

/* ---------- entry conversion -------------------------------------------- */

describe("index entries become transactions", () => {
  it("converts a linked method", () => {
    expect(historyEntryToTx(entry({ method: "settle", block: 7 }))).toEqual({
      method: "settle",
      txId: "0xaa",
      block: "7",
      status: "FINALIZED",
    });
  });

  it("drops the deployment, which links to no step", () => {
    expect(historyEntryToTx(entry({ method: null }))).toBeNull();
  });

  it("drops a method the replay does not link", () => {
    expect(historyEntryToTx(entry({ method: "commit_holder" }))).toBeNull();
  });
});

/* ---------- merge -------------------------------------------------------- */

describe("merging the live tail over the index", () => {
  it("keeps both when they describe different steps", () => {
    const out = mergeMatchTxs([tx("claim", "0x1", "20")], [tx("settle", "0x2", "10")]);
    expect(out.map((t) => t.method)).toEqual(["claim", "settle"]);
  });

  it("prefers the live entry for the same method", () => {
    const out = mergeMatchTxs(
      [tx("adjudicate", "0xlive", "30", "FINALIZED")],
      [tx("adjudicate", "0xold", "10", "ACCEPTED")],
    );
    expect(out).toHaveLength(1);
    expect(out[0].txId).toBe("0xlive");
  });

  it("never lists the same transaction twice", () => {
    const out = mergeMatchTxs([tx("settle", "0xsame", "10")], [tx("settle", "0xsame", "10")]);
    expect(out).toHaveLength(1);
  });

  it("accumulates claims, which each party sends separately", () => {
    const out = mergeMatchTxs(
      [tx("claim", "0xlive", "30")],
      [tx("claim", "0xold", "10"), tx("settle", "0xs", "9")],
    );
    expect(out.filter((t) => t.method === "claim").map((t) => t.txId)).toEqual(["0xlive", "0xold"]);
  });

  it("returns newest first", () => {
    const out = mergeMatchTxs([tx("claim", "0x3", "300")], [tx("settle", "0x1", "100"), tx("claim", "0x2", "200")]);
    expect(out.map((t) => t.block)).toEqual(["300", "200", "100"]);
  });

  it("returns the index alone when the tail found nothing", () => {
    const indexed = [tx("adjudicate", "0xa", "5"), tx("settle", "0xb", "6")];
    expect(mergeMatchTxs([], indexed)).toHaveLength(2);
  });
});

/* ---------- tail planning ------------------------------------------------ */

describe("planning the live tail", () => {
  it("asks for nothing when the chain has not moved past the snapshot", () => {
    expect(tailWindows(1000n, 1000, 40)).toEqual({ windows: [], capped: false });
    expect(tailWindows(999n, 1000, 40)).toEqual({ windows: [], capped: false });
  });

  it("floors at the block after the snapshot rather than reading it again", () => {
    const { windows, capped } = tailWindows(1500n, 1000, 40);
    expect(capped).toBe(false);
    expect(windows).toEqual([{ from: 1001n, to: 1500n }]);
  });

  it("walks backwards from the tip so the newest blocks are read first", () => {
    const { windows } = tailWindows(30000n, 0, 40);
    expect(windows[0].to).toBe(30000n);
    expect(windows[0].from).toBeGreaterThan(windows[1].from);
  });

  it("covers the whole tail with no gap and no overlap", () => {
    const { windows, capped } = tailWindows(25000n, 1000, 40);
    expect(capped).toBe(false);
    const ascending = [...windows].sort((a, b) => Number(a.from - b.from));
    expect(ascending[0].from).toBe(1001n);
    expect(ascending[ascending.length - 1].to).toBe(25000n);
    for (let i = 1; i < ascending.length; i++) {
      expect(ascending[i].from).toBe(ascending[i - 1].to + 1n);
    }
  });

  it("reports capped rather than silently dropping the oldest blocks", () => {
    const { windows, capped } = tailWindows(1000000n, 0, 3);
    expect(capped).toBe(true);
    expect(windows).toHaveLength(3);
    // The tip is covered; the blocks just above the snapshot are what is lost.
    expect(windows[0].to).toBe(1000000n);
  });

  it("is not capped when the budget exactly fits", () => {
    const { windows, capped } = tailWindows(20000n, 0, 2);
    expect(capped).toBe(false);
    expect(windows).toHaveLength(2);
  });
});

/* ---------- what the lab reads off the index ----------------------------- */

describe("convergence figures from the index alone", () => {
  it("matches what a full live scan produced before the index existed", () => {
    const rows = [...indexedAttempts().entries()]
      .map(([id, a]) => convergenceOf(BigInt(id), [...a].sort((x, y) => x.block - y.block)))
      .sort((a, b) => Number(a.matchId - b.matchId));
    // Verified against a full backwards walk of the consensus log: ten
    // adjudicate transactions across eight matches, all eight carrying a
    // verdict in contract state, five matches settled on a single transaction
    // with no rotation, and two transactions finalized without writing one.
    expect(convergenceSummary(rows)).toEqual({
      matches: 8,
      withVerdict: 8,
      attempts: 10,
      clean: 5,
      discarded: 2,
    });
  });
});

/* ---------- a frozen index against a chain that keeps moving -------------- */

/**
 * The state the submission ships in: the index stops at a block, the chain
 * carries on, and the live tail eventually cannot reach back to the snapshot.
 * A match the index already answers is unaffected by that; a match that still
 * needs the tail is not.
 */

/** The journal tests do the same. The cache only ever talks to localStorage. */
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
});

const outcome = (over: Partial<ScanOutcome>): ScanOutcome => ({
  txs: [],
  windowsScanned: 40,
  blocksScanned: 400000,
  exhausted: false,
  degraded: null,
  snapshotBlock: SNAPSHOT_BLOCK,
  tailCapped: true,
  indexResolved: true,
  ...over,
});

const settled: MatchTx[] = [
  tx("adjudicate", "0xadj", "100"),
  tx("settle", "0xset", "101"),
];

describe("a match the index already answers", () => {
  const required: LinkedMethod[] = ["adjudicate"];

  it("is resolved by the index", () => {
    expect(indexAnswersMatch(required, settled)).toBe(true);
  });

  it("is not resolved when the index entry was still in flight", () => {
    expect(indexAnswersMatch(required, [tx("adjudicate", "0xadj", "100", "ACCEPTED")])).toBe(false);
  });

  it("is cached even though the tail was capped", () => {
    // Nothing above the snapshot can change a match that finished below it,
    // so refusing to cache here would re-scan forever for no reason.
    writeCachedTransactions(77n, outcome({ txs: settled, indexResolved: true }), required);
    expect(readCachedTransactions(77n)).toHaveLength(2);
  });
});

describe("a match that still needs the live tail", () => {
  const required: LinkedMethod[] = ["adjudicate"];

  it("is not resolved by the index", () => {
    expect(indexAnswersMatch(required, [tx("settle", "0xset", "101")])).toBe(false);
  });

  it("is not cached when the tail was capped", () => {
    // The unread blocks could have held the missing transaction, so storing
    // this would make the gap permanent for this browser.
    writeCachedTransactions(
      78n,
      outcome({ txs: settled, indexResolved: false, tailCapped: true }),
      required,
    );
    expect(readCachedTransactions(78n)).toBeNull();
  });

  it("is still cached when the tail was not capped", () => {
    writeCachedTransactions(
      79n,
      outcome({ txs: settled, indexResolved: false, tailCapped: false }),
      required,
    );
    expect(readCachedTransactions(79n)).toHaveLength(2);
  });

  it("is never cached once genuinely degraded", () => {
    writeCachedTransactions(
      80n,
      outcome({ txs: settled, indexResolved: true, degraded: "the node is rate limiting this scan" }),
      required,
    );
    expect(readCachedTransactions(80n)).toBeNull();
  });
});

describe("the real index, against the matches it holds", () => {
  it("answers every settled match without needing the live tail", () => {
    // This is what keeps the submission readable after the index is frozen:
    // the reviewer's browser resolves these from the file, whatever the chain
    // has done since.
    const ids = [...new Set(HISTORY.transactions.map((e) => e.matchId))].filter(
      (id): id is string => id !== null,
    );
    expect(ids.length).toBe(8);
    for (const id of ids) {
      const indexed = historyFor(id, new Set(["adjudicate", "settle", "claim"]))
        .map(historyEntryToTx)
        .filter((t): t is MatchTx => t !== null);
      expect(indexAnswersMatch(["adjudicate"], indexed)).toBe(true);
    }
  });
});
