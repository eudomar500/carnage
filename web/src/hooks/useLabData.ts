import { useEffect, useRef, useState } from "react";
import { CARNAGE_ADDRESS, CHAIN, readClient } from "../chain/client";
import { coverageNote, discoverAllMatches, type Discovery } from "../chain/discovery";
import type { MatchState } from "../chain/contract";
import { decodeCall, newTransactionEvent, pool, WINDOW } from "../chain/txlog";
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
 * contract's transaction index, which means a log scan plus a read per
 * transaction. That is slower, so it runs behind the first tier and fills the
 * page in as it goes instead of blocking it.
 */

/**
 * How far back the second tier looks.
 *
 * Same bound txlog.ts settled on. It covers the whole record today, and it is
 * reported rather than hidden so a match that ages out of range reads as out
 * of range instead of as a match that was never adjudicated.
 */
export const SCAN_WINDOWS = 40;

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
  /** Windows read so far, out of SCAN_WINDOWS. */
  progress: number;
  degraded: string | null;
  /** True once the walk has finished, cleanly or not. */
  done: boolean;
};

const EMPTY_FEED: AdjudicationFeed = {
  byMatch: [],
  verdicts: new Map(),
  scanning: false,
  progress: 0,
  degraded: null,
  done: false,
};

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
 * Walks the consensus log for adjudicate transactions, newest window first.
 *
 * Starts on its own as soon as `enabled` goes true, which the page does once
 * the matches are in. It publishes after every batch of windows rather than at
 * the end, so each match's transaction hash appears as the walk reaches it
 * instead of everything arriving at once several seconds later.
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
      const found = new Map<string, Attempt[]>();
      let degraded: string | null = null;

      let latest = 0n;

      // Declared before `latest` is read, called only after it is set.
      const readWindow = async (i: number) => {
        const to = latest - BigInt(i) * WINDOW;
        if (to <= 0n) return [];
        const from = to - WINDOW + 1n > 0n ? to - WINDOW + 1n : 0n;
        const logs: any[] = await retryRead(() =>
          client.getLogs({
            address: consensus,
            event,
            args: { recipient: CARNAGE_ADDRESS },
            fromBlock: from,
            toBlock: to,
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
        latest = await retryRead(() => client.getBlockNumber());
      } catch {
        setFeed({
          ...EMPTY_FEED,
          degraded: "could not reach the transaction index",
          done: true,
        });
        return;
      }

      let scanned = 0;
      for (let base = 0; base < SCAN_WINDOWS; base += LOG_BATCH) {
        if (mine.cancelled) return;
        const batch: number[] = [];
        for (let k = 0; k < LOG_BATCH && base + k < SCAN_WINDOWS; k++) batch.push(base + k);

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
          degraded = "the scan stopped early, so some transactions may be missing";
          if (mine.cancelled) return;
          setFeed({ ...feedFrom(found), scanning: false, progress: scanned, degraded, done: true });
          return;
        }

        if (mine.cancelled) return;
        setFeed({
          ...feedFrom(found),
          scanning: scanned < SCAN_WINDOWS,
          progress: scanned,
          degraded,
          done: false,
        });
      }

      if (mine.cancelled) return;
      setFeed({ ...feedFrom(found), scanning: false, progress: scanned, degraded, done: true });
    })();

    return () => {
      mine.cancelled = true;
    };
  }, [enabled]);

  // Null means the walk has not published anything yet. Whether that counts as
  // scanning is decided by `enabled` alone, so it is derived here rather than
  // written from the effect, which would cost a render that only says "working".
  return feed ?? { ...EMPTY_FEED, scanning: enabled };
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
