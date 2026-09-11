import { abi } from "genlayer-js";
import { fromRlp, hexToBytes, parseAbiItem, type AbiEvent } from "viem";
import { CARNAGE_ADDRESS, CHAIN, readClient } from "./client";
import { isRateLimited } from "./errors";
import {
  historyFor,
  isTerminalStatus,
  SNAPSHOT_BLOCK,
  staleEntries,
  type HistoryEntry,
} from "./history";

/**
 * Recovers the real transaction hash behind each step of a match.
 *
 * Two sources, and this is the one place the split is explained. Everything up
 * to the index's snapshot block is answered from src/chain/history.json, a
 * file built by scripts/snapshot.mjs and committed. Everything after it is
 * scanned live from the consensus log.
 *
 * The index is not an optimisation, it is the only thing that keeps old
 * matches reachable. Bradbury refuses any eth_getLogs range wider than 10000
 * blocks and produces a block every 0.76 s, so the contract's history costs
 * one window per 10000 blocks and grows by about ten windows a day forever.
 * Carnage ships as a static build with no server to keep an index warm and no
 * way to page a visitor's first load, so a scan that walks the whole chain
 * would pass any sane page budget within weeks and match 1 would simply stop
 * resolving. Committing the history fixes the cost of the past at zero and
 * leaves only the tail to read.
 *
 * get_match returns state, not history, so the hashes have to come from
 * somewhere else. They are not contract events: a GenVM `gl.Event` is part of
 * an execution result, returned once you already hold the transaction, and it
 * is not an indexed log. Reading eth_getLogs at the intelligent contract's own
 * address returns nothing at all, so there is no log stream there to query.
 *
 * What does work is one level down. Every call to a GenLayer contract is
 * announced by the consensus contract as
 *
 *   NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)
 *
 * with `recipient` indexed and equal to the intelligent contract address. So
 * filtering that event by recipient enumerates every transaction ever sent to
 * Carnage, and each txId's own calldata says which method it called and with
 * what arguments. Every per-match method takes match_id as its first argument,
 * so attribution is exact rather than inferred.
 *
 * None of this needs a contract change, and it works retroactively for matches
 * that were played before this code existed.
 */

/** Methods the replay is willing to show a verification link for. */
export const LINKED_METHODS = [
  "adjudicate",
  "settle",
  "force_settle",
  "claim",
  "resolve_no_reveal",
  "resolve_inconclusive",
  "refund_before_lock",
] as const;

export type LinkedMethod = (typeof LINKED_METHODS)[number];

const LINKED = new Set<string>(LINKED_METHODS);

export type MatchTx = {
  method: LinkedMethod;
  txId: `0x${string}`;
  /** Block the consensus contract announced it in. */
  block: string;
  /** Transaction status at the time it was read, e.g. FINALIZED. */
  status: string;
};

export type ScanOutcome = {
  /** Newest first, at most one entry per method except `claim`. */
  txs: MatchTx[];
  /** How many live-tail windows were actually read. */
  windowsScanned: number;
  /** Blocks of the live tail those windows covered. */
  blocksScanned: number;
  /** True when the budget ran out before every required method was found. */
  exhausted: boolean;
  /** Set when the scan stopped early for a transport reason. */
  degraded: string | null;
  /** The block the committed index answers through. */
  snapshotBlock: number;
  /**
   * True when the live tail was wider than MAX_WINDOWS could cover, so the
   * blocks immediately above the snapshot were never read.
   *
   * A fact about the scan, not a verdict on the result. Whether it cost this
   * match anything is `indexResolved`.
   */
  tailCapped: boolean;
  /**
   * Every required method was answered from the committed index, with a
   * terminal status.
   *
   * When this holds the result is complete and a capped tail took nothing
   * away: the match finished below the snapshot and no later block can change
   * what it did. Only a match that still needs something from the tail is
   * harmed by the cap.
   */
  indexResolved: boolean;
};

/**
 * Bradbury caps eth_getLogs ranges. Measured directly against the node: 20000
 * blocks and wider are rejected outright, 10000 is accepted.
 */
export const WINDOW = 10_000n;

/**
 * Ceiling on the live tail, in windows.
 *
 * The tail is everything after the index's snapshot block, so on a freshly
 * regenerated index it is nearly empty and this never binds. It binds when the
 * index has been left to go stale: at roughly ten windows a day, forty windows
 * is about four days of drift before the scan can no longer reach the
 * snapshot. Past that the outcome carries tailCapped and the caller says so,
 * rather than presenting a gap as a complete answer.
 */
export const MAX_WINDOWS = 40;

/**
 * Log queries issued at once.
 *
 * Windows are still processed newest first, so the early exit and the ordering
 * that guarantees claims are seen before settlement both hold. This only
 * overlaps the waiting: a scan that has to walk back several days takes about
 * a third of the wall time it would sequentially.
 */
const LOG_BATCH = 3;

/** Transaction reads per window run in parallel, gently. */
const READ_CONCURRENCY = 4;

const RETRIES = 4;
const RETRY_BASE_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The consensus event every scan depends on, taken from the chain definition
 * rather than trusted blindly.
 *
 * Exported because the lab walks the same index for a different question, and
 * two copies of this check would drift the moment the chain renamed anything.
 *
 * The filter below is only meaningful if `recipient` is an indexed topic. If a
 * future chain release renames the event or unindexes that field, this returns
 * null and the feature degrades to "not available" instead of silently
 * matching nothing and looking like a match with no transactions.
 */
export function newTransactionEvent(): AbiEvent | null {
  const entries = (CHAIN.consensusMainContract?.abi ?? []) as any[];
  const found = entries.find((e) => e?.type === "event" && e?.name === "NewTransaction");
  if (!found) return null;
  const recipient = (found.inputs ?? []).find((i: any) => i?.name === "recipient");
  if (!recipient?.indexed) return null;
  return parseAbiItem(
    "event NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)",
  ) as AbiEvent;
}

/** Full URL for a transaction on the chain's own explorer. */
export function explorerTxUrl(txId: string): string | null {
  const base = CHAIN.blockExplorers?.default?.url;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/tx/${txId}`;
}

/**
 * Which methods have to be found before the scan can stop.
 *
 * `claim` is deliberately excluded: a settled match may have nought, one or
 * two claims depending on who has withdrawn, so waiting for one would make
 * every scan run to exhaustion. Claims are collected when seen, and because
 * they always happen after settlement and the live tail is still walked
 * backwards from the chain tip, they are seen before the transaction that
 * requires them. The index does not disturb this: it is merged in whole, so a
 * claim recorded before the snapshot arrives with its own settle rather than
 * depending on the order anything was scanned in.
 */
export function requiredMethods(m: {
  settled: boolean;
  no_reveal_resolved: boolean;
  inconclusive_resolved: boolean;
  refunded_before_lock: boolean;
}): LinkedMethod[] {
  if (m.no_reveal_resolved) return ["resolve_no_reveal"];
  if (m.inconclusive_resolved) return ["resolve_inconclusive"];
  if (m.refunded_before_lock) return ["refund_before_lock"];
  // A settled match was settled either by the scheduled self-call or by the
  // permissionless fallback. Requiring `settle` alone would run every
  // force-settled match's scan to exhaustion looking for a transaction that
  // was never sent, so the verdict is what has to be found.
  if (m.settled) return ["adjudicate"];
  return [];
}

/** Retries only what is worth retrying: a busy node, never a bad request. */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let wait = RETRY_BASE_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRIES - 1 || !isRateLimited(err)) throw err;
      await sleep(wait);
      wait *= 2;
    }
  }
}

/**
 * Pulls the method name and arguments out of a transaction's calldata.
 *
 * txCalldata is RLP; the GenLayer calldata blob is its first element. The
 * decoder returns a Map, which is why the SDK's own txDataDecoded.callData
 * looks empty when it is serialised.
 */
export function decodeCall(txCalldata: unknown): { method: string; args: unknown[] } | null {
  if (typeof txCalldata !== "string" || !txCalldata.startsWith("0x")) return null;
  try {
    const parts = fromRlp(txCalldata as `0x${string}`, "hex");
    const blob = (Array.isArray(parts) ? parts[0] : parts) as `0x${string}`;
    const decoded = (abi as any).calldata.decode(hexToBytes(blob));
    if (!(decoded instanceof Map)) return null;
    const method = decoded.get("method");
    if (typeof method !== "string") return null;
    const args = decoded.get("args");
    return { method, args: Array.isArray(args) ? args : [] };
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with a fixed number of workers, preserving order. */
export async function pool<T, R>(items: T[], workers: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** An index entry in the shape the rest of the app already speaks. */
export function historyEntryToTx(e: HistoryEntry): MatchTx | null {
  if (!e.method || !LINKED.has(e.method)) return null;
  return {
    method: e.method as LinkedMethod,
    txId: e.hash,
    block: String(e.block),
    status: e.status,
  };
}

/**
 * Live results over indexed ones, newest first.
 *
 * Live wins on a collision because the index records a status observed at
 * snapshot time and the live read is by definition not older. Every method
 * keeps one entry except `claim`, which each party sends separately and which
 * therefore accumulates.
 */
export function mergeMatchTxs(live: MatchTx[], indexed: MatchTx[]): MatchTx[] {
  const out: MatchTx[] = [];
  const seenId = new Set<string>();
  const seenMethod = new Set<string>();

  for (const tx of [...live, ...indexed]) {
    if (seenId.has(tx.txId)) continue;
    if (tx.method !== "claim" && seenMethod.has(tx.method)) continue;
    seenId.add(tx.txId);
    seenMethod.add(tx.method);
    out.push(tx);
  }

  return out.sort((a, b) => Number(b.block) - Number(a.block));
}

/**
 * The live tail, as windows, walked backwards from the tip.
 *
 * Floored at the block after the snapshot, because everything below that is
 * already answered. Returns `capped` when the tail needs more windows than the
 * budget allows, which is the one case where the result has a hole in it.
 */
export function tailWindows(
  latest: bigint,
  snapshotBlock: number,
  maxWindows: number,
): { windows: { from: bigint; to: bigint }[]; capped: boolean } {
  const floor = BigInt(snapshotBlock) + 1n;
  if (latest < floor) return { windows: [], capped: false };

  const windows: { from: bigint; to: bigint }[] = [];
  let to = latest;
  let capped = false;

  while (to >= floor) {
    if (windows.length >= maxWindows) {
      capped = true;
      break;
    }
    const from = to - WINDOW + 1n > floor ? to - WINDOW + 1n : floor;
    windows.push({ from, to });
    if (from === floor) break;
    to = from - 1n;
  }

  return { windows, capped };
}

/**
 * Whether the committed index alone already answers this match.
 *
 * Terminal status is the condition that matters. An entry still in flight when
 * the snapshot ran could change, so it does not count as answered no matter
 * which method it carries.
 */
export function indexAnswersMatch(required: LinkedMethod[], indexed: MatchTx[]): boolean {
  return required.every((m) =>
    indexed.some((tx) => tx.method === m && isTerminalStatus(tx.status)),
  );
}

export type ScanOptions = {
  onProgress?: (windowsDone: number, windowsTotal: number) => void;
  /** Checked between windows so a unmounting view stops the scan promptly. */
  isCancelled?: () => boolean;
};

/**
 * Walks back from the chain tip until every required method has been found.
 *
 * Reads newest first so that a live match, whose interesting transactions are
 * near the tip, resolves in one or two windows.
 */
export async function scanMatchTransactions(
  matchId: bigint,
  required: LinkedMethod[],
  opts: ScanOptions = {},
): Promise<ScanOutcome> {
  // The index first. It is free, it is already complete for everything at or
  // below the snapshot, and knowing what it holds is what lets the live walk
  // stop early instead of hunting for a transaction that is already in hand.
  const indexed: MatchTx[] = [];
  const stale: HistoryEntry[] = staleEntries(historyFor(matchId, LINKED));
  for (const entry of historyFor(matchId, LINKED)) {
    const tx = historyEntryToTx(entry);
    if (tx) indexed.push(tx);
  }

  const base: ScanOutcome = {
    txs: indexed,
    windowsScanned: 0,
    blocksScanned: 0,
    exhausted: false,
    degraded: null,
    snapshotBlock: SNAPSHOT_BLOCK,
    tailCapped: false,
    indexResolved: indexAnswersMatch(required, indexed),
  };

  const event = newTransactionEvent();
  const consensus = CHAIN.consensusMainContract?.address as `0x${string}` | undefined;
  if (!event || !consensus) {
    return { ...base, degraded: "this chain does not expose the transaction index" };
  }

  const client = readClient() as any;
  const wanted = String(matchId);
  const found: MatchTx[] = [];
  const seen = new Set<string>();

  // Only what the index could not answer. A match settled before the snapshot
  // needs nothing from the tail, so its walk stops after one window.
  const stillNeeded = new Set<string>(
    required.filter((m) => !indexed.some((tx) => tx.method === m)),
  );

  let latest: bigint;
  try {
    latest = await withBackoff(() => client.getBlockNumber());
  } catch (err) {
    return { ...base, degraded: readableFailure(err), exhausted: !base.indexResolved };
  }

  // An entry that was not terminal when the snapshot ran has to be re-read
  // before anybody sees its status. Normally there are none.
  const refreshed = new Map<string, string>();
  for (const entry of stale) {
    try {
      const tx: any = await withBackoff(() => client.getTransaction({ hash: entry.hash }));
      refreshed.set(entry.hash, String(tx?.statusName ?? entry.status));
    } catch {
      // Leave the snapshot value in place; a failed read is not new evidence.
    }
  }
  const indexedNow = refreshed.size
    ? indexed.map((tx) => ({ ...tx, status: refreshed.get(tx.txId) ?? tx.status }))
    : indexed;

  const { windows: tail, capped } = tailWindows(latest, SNAPSHOT_BLOCK, MAX_WINDOWS);

  // Decided once, from the index alone. A match the index already answers is
  // complete whatever the tail did, so the cap below must not touch it.
  const indexResolved = indexAnswersMatch(required, indexedNow);

  /**
   * The gap that a capped tail actually costs.
   *
   * Only reachable when the index did not answer the match, which is the one
   * case where the unread blocks could have held the missing transaction.
   */
  const CAPPED_GAP =
    "the blocks between the committed index and the live scan were not read, " +
    "so a transaction in that range would not be found";

  const settle = (over: MatchTx[], scanned: number, degraded: string | null): ScanOutcome => {
    const txs = mergeMatchTxs(over, indexedNow);
    // Completeness is read off the answer, not off which half produced it. A
    // method the live tail found is just as found as one the index held.
    const complete = required.every((m) => txs.some((t) => t.method === m));
    return {
      txs,
      windowsScanned: scanned,
      blocksScanned: tail.slice(0, scanned).reduce((n, w) => n + Number(w.to - w.from) + 1, 0),
      exhausted: !complete,
      degraded: degraded ?? (capped && !complete ? CAPPED_GAP : null),
      snapshotBlock: SNAPSHOT_BLOCK,
      tailCapped: capped,
      indexResolved,
    };
  };

  if (!tail.length) {
    return settle([], 0, null);
  }

  /** One window of logs, or a failure we can report without losing progress. */
  const fetchWindow = async (i: number) => {
    const w = tail[i];
    try {
      const logs = await withBackoff(() =>
        client.getLogs({
          address: consensus,
          event,
          args: { recipient: CARNAGE_ADDRESS },
          fromBlock: w.from,
          toBlock: w.to,
        }),
      );
      return { i, logs: logs as any[], error: null as unknown };
    } catch (error) {
      return { i, logs: [] as any[], error };
    }
  };

  let scanned = 0;

  for (let start = 0; start < tail.length; start += LOG_BATCH) {
    if (opts.isCancelled?.()) break;

    const batch = [];
    for (let k = 0; k < LOG_BATCH && start + k < tail.length; k++) batch.push(start + k);
    const windows = await Promise.all(batch.map(fetchWindow));

    for (const w of windows) {
      // A window that failed ends the scan here. Partial results are still
      // worth showing, but they must never be cached: the gap is the
      // network's doing, not evidence that the transaction does not exist.
      if (w.error) {
        return settle(found, scanned, readableFailure(w.error));
      }

      // Newest first within the window, so claims are collected before the
      // settlement that lets the scan stop.
      const ordered = [...w.logs].reverse();
      let readFailure: string | null = null;

      const decoded = await pool(ordered, READ_CONCURRENCY, async (log) => {
        const txId = log?.args?.txId as `0x${string}` | undefined;
        if (!txId || seen.has(txId)) return null;
        try {
          const tx: any = await withBackoff(() => client.getTransaction({ hash: txId }));
          const call = decodeCall(tx?.txCalldata);
          if (!call) return null;
          return {
            txId,
            block: String(log.blockNumber ?? ""),
            status: String(tx?.statusName ?? ""),
            call,
          };
        } catch (err) {
          readFailure = readableFailure(err);
          return null;
        }
      });

      for (const entry of decoded) {
        if (!entry) continue;
        seen.add(entry.txId);
        const { method, args } = entry.call;
        if (!LINKED.has(method)) continue;
        // Every per-match method takes match_id first. A transaction for
        // another match is not this match's evidence.
        if (String(args[0] ?? "") !== wanted) continue;
        // One entry per method, except claim, which each party sends
        // separately.
        if (method !== "claim" && found.some((f) => f.method === method)) continue;
        found.push({
          method: method as LinkedMethod,
          txId: entry.txId,
          block: entry.block,
          status: entry.status,
        });
        stillNeeded.delete(method);
      }

      scanned += 1;
      opts.onProgress?.(scanned, tail.length);

      if (stillNeeded.size === 0) {
        return settle(found, scanned, readFailure);
      }

      if (readFailure) {
        return settle(found, scanned, readFailure);
      }
    }
  }

  return settle(found, scanned, null);
}

function readableFailure(err: unknown): string {
  if (isRateLimited(err)) return "the node is rate limiting this scan";
  const message = String((err as any)?.shortMessage ?? (err as any)?.message ?? err);
  return message.replace(/\s+/g, " ").trim().slice(0, 140);
}

/* ---------- cache ------------------------------------------------------- */

/**
 * Why this cache never goes stale.
 *
 * Only a completed scan of a resolved match is written, and only when every
 * transaction in it reads FINALIZED. A finalized GenLayer transaction cannot
 * be reorganised or replaced, and a match that has settled, or resolved
 * through either deterministic exit, cannot gain new lifecycle transactions.
 * So a stored record describes something that can no longer change.
 *
 * A partial, exhausted or degraded scan is deliberately never written. If the
 * node was busy, the next visit must be free to try again rather than inherit
 * a permanent gap.
 */
const CACHE_VERSION = 2;
const CACHE_PREFIX = "carnage.txlog";

type CacheRecord = {
  v: number;
  txs: MatchTx[];
};

function cacheKey(matchId: bigint): string {
  return `${CACHE_PREFIX}.${CARNAGE_ADDRESS.toLowerCase()}.${matchId}`;
}

export function readCachedTransactions(matchId: bigint): MatchTx[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheRecord;
    if (parsed?.v !== CACHE_VERSION || !Array.isArray(parsed.txs)) return null;
    if (!parsed.txs.every((t) => typeof t?.txId === "string" && LINKED.has(t?.method))) return null;
    return parsed.txs;
  } catch {
    return null;
  }
}

/** Writes only a result that is complete and entirely final. See above. */
export function writeCachedTransactions(
  matchId: bigint,
  outcome: ScanOutcome,
  required: LinkedMethod[],
): void {
  // A capped tail only makes the result partial when the index did not already
  // answer the match. When it did, the match finished below the snapshot and
  // nothing above it can change what happened, so this is safe to store.
  if (outcome.degraded || outcome.exhausted) return;
  if (outcome.tailCapped && !outcome.indexResolved) return;
  if (!required.every((m) => outcome.txs.some((t) => t.method === m))) return;
  if (!outcome.txs.every((t) => t.status === "FINALIZED")) return;
  try {
    const record: CacheRecord = { v: CACHE_VERSION, txs: outcome.txs };
    localStorage.setItem(cacheKey(matchId), JSON.stringify(record));
  } catch {
    // Storage can be unavailable. The scan still works, it just repeats.
  }
}
