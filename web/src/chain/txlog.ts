import { abi } from "genlayer-js";
import { fromRlp, hexToBytes, parseAbiItem, type AbiEvent } from "viem";
import { CARNAGE_ADDRESS, CHAIN, readClient } from "./client";
import { isRateLimited } from "./errors";

/**
 * Recovers the real transaction hash behind each step of a match.
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
  "claim",
  "resolve_no_reveal",
  "resolve_inconclusive",
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
  /** How many windows were actually read. */
  windowsScanned: number;
  /** Total blocks covered by those windows. */
  blocksScanned: number;
  /** True when the budget ran out before every required method was found. */
  exhausted: boolean;
  /** Set when the scan stopped early for a transport reason. */
  degraded: string | null;
};

/**
 * Bradbury caps eth_getLogs ranges. Measured directly against the node: 20000
 * blocks and wider are rejected outright, 10000 is accepted.
 */
const WINDOW = 10_000n;

/**
 * How far back to look before giving up.
 *
 * At the observed block time of about 0.8s the chain advances roughly 108k
 * blocks a day, so this covers a little under four days. The bound is the
 * honest part of the design: a match older than this reports that its
 * transactions were not located, rather than showing nothing or, worse,
 * something invented.
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
 * The consensus event this scan depends on, taken from the chain definition
 * rather than trusted blindly.
 *
 * The filter below is only meaningful if `recipient` is an indexed topic. If a
 * future chain release renames the event or unindexes that field, this returns
 * null and the feature degrades to "not available" instead of silently
 * matching nothing and looking like a match with no transactions.
 */
function newTransactionEvent(): AbiEvent | null {
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
 * they always happen after settlement and the scan walks backwards from the
 * chain tip, they are seen before the transaction that requires them.
 */
export function requiredMethods(m: {
  settled: boolean;
  no_reveal_resolved: boolean;
  inconclusive_resolved: boolean;
}): LinkedMethod[] {
  if (m.no_reveal_resolved) return ["resolve_no_reveal"];
  if (m.inconclusive_resolved) return ["resolve_inconclusive"];
  if (m.settled) return ["adjudicate", "settle"];
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
function decodeCall(txCalldata: unknown): { method: string; args: unknown[] } | null {
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
async function pool<T, R>(items: T[], workers: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
  const event = newTransactionEvent();
  const consensus = CHAIN.consensusMainContract?.address as `0x${string}` | undefined;
  const empty: ScanOutcome = {
    txs: [], windowsScanned: 0, blocksScanned: 0, exhausted: false, degraded: null,
  };
  if (!event || !consensus) {
    return { ...empty, degraded: "this chain does not expose the transaction index" };
  }

  const client = readClient() as any;
  const wanted = String(matchId);
  const found: MatchTx[] = [];
  const seen = new Set<string>();
  const stillNeeded = new Set<string>(required);

  let latest: bigint;
  try {
    latest = await withBackoff(() => client.getBlockNumber());
  } catch (err) {
    return { ...empty, degraded: readableFailure(err) };
  }

  /** One window of logs, or a failure we can report without losing progress. */
  const fetchWindow = async (i: number) => {
    const to = latest - BigInt(i) * WINDOW;
    if (to <= 0n) return { i, logs: [] as any[], error: null as unknown };
    const from = to - WINDOW + 1n > 0n ? to - WINDOW + 1n : 0n;
    try {
      const logs = await withBackoff(() =>
        client.getLogs({
          address: consensus,
          event,
          args: { recipient: CARNAGE_ADDRESS },
          fromBlock: from,
          toBlock: to,
        }),
      );
      return { i, logs: logs as any[], error: null as unknown };
    } catch (error) {
      return { i, logs: [] as any[], error };
    }
  };

  let scanned = 0;

  for (let base = 0; base < MAX_WINDOWS; base += LOG_BATCH) {
    if (opts.isCancelled?.()) break;

    const batch = [];
    for (let k = 0; k < LOG_BATCH && base + k < MAX_WINDOWS; k++) batch.push(base + k);
    const windows = await Promise.all(batch.map(fetchWindow));

    for (const w of windows) {
      // A window that failed ends the scan here. Partial results are still
      // worth showing, but they must never be cached: the gap is the
      // network's doing, not evidence that the transaction does not exist.
      if (w.error) {
        return {
          txs: found,
          windowsScanned: scanned,
          blocksScanned: scanned * Number(WINDOW),
          exhausted: stillNeeded.size > 0,
          degraded: readableFailure(w.error),
        };
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
      opts.onProgress?.(scanned, MAX_WINDOWS);

      if (stillNeeded.size === 0) {
        return {
          txs: found,
          windowsScanned: scanned,
          blocksScanned: scanned * Number(WINDOW),
          exhausted: false,
          degraded: readFailure,
        };
      }

      if (readFailure) {
        return {
          txs: found,
          windowsScanned: scanned,
          blocksScanned: scanned * Number(WINDOW),
          exhausted: true,
          degraded: readFailure,
        };
      }
    }
  }

  return {
    txs: found,
    windowsScanned: scanned,
    blocksScanned: scanned * Number(WINDOW),
    exhausted: stillNeeded.size > 0,
    degraded: null,
  };
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
  if (outcome.degraded || outcome.exhausted) return;
  if (!required.every((m) => outcome.txs.some((t) => t.method === m))) return;
  if (!outcome.txs.every((t) => t.status === "FINALIZED")) return;
  try {
    const record: CacheRecord = { v: CACHE_VERSION, txs: outcome.txs };
    localStorage.setItem(cacheKey(matchId), JSON.stringify(record));
  } catch {
    // Storage can be unavailable. The scan still works, it just repeats.
  }
}
