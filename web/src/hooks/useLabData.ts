import { useEffect, useRef, useState } from "react";
import { CARNAGE_ADDRESS, CHAIN, readClient } from "../chain/client";
import { coverageNote, discoverAllMatches, type Discovery } from "../chain/discovery";
import type { MatchState } from "../chain/contract";
import {
  decodeCall,
  MAX_WINDOWS,
  newTransactionEvent,
  pool,
  tailWindows,
} from "../chain/txlog";
import { historyByMethod, SNAPSHOT_BLOCK } from "../chain/history";
import {
  convergenceOf,
  isApplied,
  type Attempt,
  type MatchConvergence,
} from "../chain/labs";

/**
 * The lab's two loads.
 *
 * Claims, labels and everything computed from them come from get_match, which
 * discovery already knows how to walk. That is the first tier. It is a read
 * per match id against a chain that answers in a couple of seconds, so it
 * takes a moment, and the page shows a running count rather than a screen of
 * zeros while it waits.
 *
 * Transaction hashes and consensus history are the second tier. get_match
 * records that a match was adjudicated, never which transaction did it or how
 * many attempts it took, and the contract cannot: a discarded round leaves no
 * on-chain trace. The only place that history exists is the consensus
 * contract's transaction log.
 *
 * That log is read from two sources, for the reason set out in txlog.ts: the
 * committed index answers everything through its snapshot block, and only the
 * blocks after it are scanned live. Without the index this tier would have to
 * walk the contract's whole history on every visit, which grows by about ten
 * windows a day and would drop the oldest matches off the page within days.
 */

/**
 * Ceiling on the live tail, shared with txlog.ts.
 *
 * The tail is only what the committed index does not already cover, so on a
 * current index this is never reached. It binds when the index has been left
 * to drift for several days, which is the expected state once the index is
 * frozen. That costs nothing already in the index: every adjudication below
 * the snapshot is still present and every figure derived from them still
 * stands. What it costs is visibility of matches played after the tail's
 * reach, so the page says that rather than calling the numbers degraded.
 */
export const SCAN_WINDOWS = MAX_WINDOWS;

/**
 * Log queries issued at once, and transaction reads in flight within each.
 *
 * The product is what the node actually sees, and Bradbury starts refusing
 * connections above roughly a dozen. These are the numbers txlog.ts settled on
 * against the same node.
 */
const LOG_BATCH = 3;
const READ_CONCURRENCY = 4;

/**
 * Transient failures tolerated per read before the walk gives up.
 *
 * Every read here is idempotent, so retrying one is free of consequences, and
 * a single dropped connection should not cost a reader every transaction hash
 * on the page.
 */
const READ_RETRIES = 3;
const RETRY_BASE_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retryRead<T>(fn: () => Promise<T>): Promise<T> {
  let wait = RETRY_BASE_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= READ_RETRIES - 1) throw err;
      await sleep(wait);
      wait *= 2;
    }
  }
}

export type LabData = {
  matches: MatchState[];
  discovery: Discovery | null;
  coverage: string;
  loading: boolean;
  /** Matches read so far. Only meaningful while `loading` is true. */
  found: number;
  error: string | null;
};

export function useLabMatches(): LabData {
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [found, setFound] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = { cancelled: false };
    void (async () => {
      try {
        const result = await discoverAllMatches((n) => {
          if (!run.cancelled) setFound(n);
        });
        if (run.cancelled) return;
        setMatches(result.matches);
        setDiscovery(result);
      } catch {
        if (!run.cancelled) setError("could not read the contract");
      } finally {
        if (!run.cancelled) setLoading(false);
      }
    })();
    return () => {
      run.cancelled = true;
    };
  }, []);

  return {
    matches,
    discovery,
    coverage: discovery ? coverageNote(discovery) : "",
    loading,
    found,
    error,
  };
}

/* ---------- adjudicate transactions -------------------------------------- */

export type AdjudicationFeed = {
  /** Consensus history per match, ascending by match id. */
  byMatch: MatchConvergence[];
  /**
   * The transaction that actually wrote each match's verdict, keyed by the
   * match id in decimal. A match whose attempts are all discarded has no entry,
   * because no transaction wrote its labels.
   */
  verdicts: Map<string, Attempt>;
  scanning: boolean;
  /** Live-tail windows read so far. */
  progress: number;
  /** Live-tail windows this scan will read in total. */
  total: number;
  degraded: string | null;
  /** True once the walk has finished, cleanly or not. */
  done: boolean;
  /** The block the committed index answers through. */
  snapshotBlock: number;
  /** True when the live tail was wider than the budget could cover. */
  tailCapped: boolean;
};

const EMPTY_FEED: AdjudicationFeed = {
  byMatch: [],
  verdicts: new Map(),
  scanning: false,
  progress: 0,
  total: 0,
  degraded: null,
  done: false,
  snapshotBlock: SNAPSHOT_BLOCK,
  tailCapped: false,
};

/**
 * Every adjudicate transaction the committed index holds.
 *
 * Complete through the snapshot block by construction, including the rounds
 * consensus discarded: the index records what the log said, not what contract
 * state kept.
 */
export function indexedAttempts(): Map<string, Attempt[]> {
  const out = new Map<string, Attempt[]>();
  for (const e of historyByMethod("adjudicate")) {
    if (!e.matchId) continue;
    const list = out.get(e.matchId) ?? [];
    list.push({
      txId: e.hash,
      block: e.block,
      statusName: e.status,
      resultName: e.result,
      rounds: e.rounds,
      applied: isApplied(e.status, e.result),
    });
    out.set(e.matchId, list);
  }
  return out;
}

/** The attempt whose verdict reached contract state, if any did. */
function appliedAttempt(attempts: Attempt[]): Attempt | undefined {
  return [...attempts].reverse().find((a) => a.applied);
}

function feedFrom(found: Map<string, Attempt[]>): Pick<AdjudicationFeed, "byMatch" | "verdicts"> {
  const byMatch = [...found.entries()]
    .map(([id, attempts]) => convergenceOf(BigInt(id), [...attempts].sort((a, b) => a.block - b.block)))
    .sort((a, b) => Number(a.matchId - b.matchId));

  const verdicts = new Map<string, Attempt>();
  for (const row of byMatch) {
    const applied = appliedAttempt(row.attempts);
    if (applied) verdicts.set(String(row.matchId), applied);
  }
  return { byMatch, verdicts };
}

/**
 * Every adjudicate transaction, from the index and then from the live tail.
 *
 * The index is loaded synchronously, so the page has the whole historical
 * record before a single request goes out. Starts on its own as soon as
 * `enabled` goes true, and publishes after every batch of tail windows rather
 * than at the end.
 */
export function useAdjudications(enabled: boolean): AdjudicationFeed {
  const [feed, setFeed] = useState<AdjudicationFeed | null>(null);
  const run = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    if (!enabled) return;
    const mine = { cancelled: false };
    run.current = mine;

    void (async () => {
      const event = newTransactionEvent();
      const consensus = CHAIN.consensusMainContract?.address as `0x${string}` | undefined;
      if (!event || !consensus) {
        setFeed({
          ...EMPTY_FEED,
          degraded: "this chain does not expose the transaction index",
          done: true,
        });
        return;
      }

      const client = readClient() as any;
      const found = indexedAttempts();
      let degraded: string | null = null;

      let tail: { from: bigint; to: bigint }[] = [];
      let capped = false;

      // Declared before `tail` is filled, called only after it is.
      const readWindow = async (i: number) => {
        const w = tail[i];
        const logs: any[] = await retryRead(() =>
          client.getLogs({
            address: consensus,
            event,
            args: { recipient: CARNAGE_ADDRESS },
            fromBlock: w.from,
            toBlock: w.to,
          }),
        );
        return pool(logs, READ_CONCURRENCY, async (log) => {
          const txId = log?.args?.txId as string | undefined;
          if (!txId) return null;
          const tx: any = await retryRead(() => client.getTransaction({ hash: txId }));
          const call = decodeCall(tx?.txCalldata);
          if (!call || call.method !== "adjudicate") return null;
          const statusName = String(tx?.statusName ?? "");
          const resultName = String(tx?.resultName ?? "");
          return {
            matchId: String(call.args[0] ?? ""),
            attempt: {
              txId,
              block: Number(log.blockNumber ?? 0),
              statusName,
              resultName,
              rounds: Number(tx?.numOfRounds ?? 0),
              applied: isApplied(statusName, resultName),
            } as Attempt,
          };
        });
      };

      try {
        const latest: bigint = await retryRead(() => client.getBlockNumber());
        const planned = tailWindows(latest, SNAPSHOT_BLOCK, SCAN_WINDOWS);
        tail = planned.windows;
        capped = planned.capped;
      } catch {
        // The index still stands on its own; only the tail is unread.
        setFeed({
          ...EMPTY_FEED,
          ...feedFrom(found),
          degraded: "could not reach the transaction log, showing the committed index only",
          done: true,
        });
        return;
      }

      if (!tail.length) {
        setFeed({
          ...EMPTY_FEED,
          ...feedFrom(found),
          progress: 0,
          total: 0,
          degraded,
          done: true,
          tailCapped: capped,
        });
        return;
      }

      let scanned = 0;
      for (let base = 0; base < tail.length; base += LOG_BATCH) {
        if (mine.cancelled) return;
        const batch: number[] = [];
        for (let k = 0; k < LOG_BATCH && base + k < tail.length; k++) batch.push(base + k);

        try {
          const windows = await Promise.all(batch.map(readWindow));
          for (const entries of windows) {
            for (const entry of entries) {
              if (!entry) continue;
              const list = found.get(entry.matchId) ?? [];
              // Windows overlap at their edges under no circumstance, but a
              // retry could still deliver the same transaction twice.
              if (list.some((a) => a.txId === entry.attempt.txId)) continue;
              list.push(entry.attempt);
              found.set(entry.matchId, list);
            }
            scanned += 1;
          }
        } catch {
          degraded = "the live scan stopped early, so recent transactions may be missing";
          if (mine.cancelled) return;
          setFeed({
            ...feedFrom(found),
            scanning: false,
            progress: scanned,
            total: tail.length,
            degraded,
            done: true,
            snapshotBlock: SNAPSHOT_BLOCK,
            tailCapped: capped,
          });
          return;
        }

        if (mine.cancelled) return;
        setFeed({
          ...feedFrom(found),
          scanning: scanned < tail.length,
          progress: scanned,
          total: tail.length,
          degraded,
          done: false,
          snapshotBlock: SNAPSHOT_BLOCK,
          tailCapped: capped,
        });
      }

      if (mine.cancelled) return;
      setFeed({
        ...feedFrom(found),
        scanning: false,
        progress: scanned,
        total: tail.length,
        degraded,
        done: true,
        snapshotBlock: SNAPSHOT_BLOCK,
        tailCapped: capped,
      });
    })();

    return () => {
      mine.cancelled = true;
    };
  }, [enabled]);

  // Null means the walk has not published anything yet. The index is already
  // known at that point, so it is shown immediately and only the tail is
  // reported as pending. Derived here rather than written from the effect,
  // which would cost a render that only says "working".
  return feed ?? { ...EMPTY_FEED, ...feedFrom(indexedAttempts()), scanning: enabled };
}

/* ---------- per round drill-down ----------------------------------------- */

const LABEL_WORDS = ["TRUE", "FALSE", "MISLEADING", "AMBIGUOUS", "UNSUPPORTED"] as const;

export type RoundLabels = { round: number; holder: string | null; buyer: string | null };

/**
 * Pulls one party's label out of a raw execution result.
 *
 * The result is calldata-encoded, and the field names survive as plain ASCII,
 * so `holder_label` is followed by a short length marker and then the word
 * itself. Reading the label that follows its own key is the only way to get
 * this right: scanning the blob for label words instead returns them in
 * whatever order the scanner happens to use, which silently swaps the two
 * parties whenever they were labelled differently.
 */
function labelAfter(text: string, key: string): string | null {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const start = at + key.length;
  // The length marker is one byte for every word in the rubric, but a couple
  // of bytes of slack costs nothing and survives a wider encoding.
  for (let skip = 0; skip <= 4; skip++) {
    const rest = text.slice(start + skip);
    const hit = LABEL_WORDS.find((w) => rest.startsWith(w));
    if (hit) return hit;
  }
  return null;
}

/** Raw bytes to latin1, so the ASCII field names inside are searchable. */
function toText(returnData: unknown): string {
  const hex = String(returnData ?? "").replace(/^0x/, "");
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * What each round of a single transaction decided, for both parties.
 *
 * One trace read per round, so this is opt-in and pointed at one match. It is
 * the only way to watch a label change between rotations: a discarded round
 * writes nothing, so the labels it produced exist only inside the transaction.
 */
export async function readRoundLabels(txId: string, rounds: number): Promise<RoundLabels[]> {
  const client = readClient() as any;
  const out: RoundLabels[] = [];
  for (let round = 0; round <= rounds; round++) {
    try {
      const trace = await client.debugTraceTransaction({ hash: txId, round });
      const text = toText(trace?.return_data);
      out.push({
        round,
        holder: labelAfter(text, "holder_label"),
        buyer: labelAfter(text, "buyer_label"),
      });
    } catch {
      out.push({ round, holder: null, buyer: null });
    }
  }
  return out;
}
