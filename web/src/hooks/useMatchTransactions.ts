import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_WINDOWS,
  readCachedTransactions,
  scanMatchTransactions,
  writeCachedTransactions,
  type LinkedMethod,
  type MatchTx,
  type ScanOutcome,
} from "../chain/txlog";

export type TxLookup =
  /** Not asked for yet. The scan costs RPC, so it waits to be needed. */
  | { state: "idle" }
  | { state: "scanning"; done: number; total: number }
  | {
      state: "ready";
      txs: MatchTx[];
      /** Ran out of scan budget before finding everything that was required. */
      exhausted: boolean;
      /** Stopped early for a transport reason; what is here may be partial. */
      degraded: string | null;
      blocksScanned: number;
    };

type Progress = { key: string; done: number; total: number };
type Result = { key: string; outcome: ScanOutcome };

/**
 * Finds the on-chain transactions behind a resolved match, once.
 *
 * Lazy on purpose. The scan is a sequence of log queries and transaction reads
 * against a rate-limited node, so it does not run until something on screen
 * actually needs a link. It never runs twice for the same match either: a
 * cached result short-circuits it before the effect, and a ref guard keeps the
 * twelve-second match poll, and reopening a frame, from restarting it.
 *
 * State here is only ever written from an async callback. The cached and
 * pending cases are derived during render instead, so opening a frame whose
 * answer is already stored costs no extra render and shows no flicker.
 */
export function useMatchTransactions(
  matchId: bigint | null,
  required: LinkedMethod[],
  enabled: boolean,
): TxLookup {
  const requiredKey = required.join(",");
  const active = enabled && matchId !== null && requiredKey !== "";
  const key = active ? `${matchId}:${requiredKey}` : "";

  // Reading storage during render is safe: it is synchronous, has no effect on
  // anything outside this component, and returns the same value every time for
  // a given key.
  const cached = useMemo(
    () => (active ? readCachedTransactions(matchId as bigint) : null),
    [active, matchId],
  );

  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  /** Key of the scan in flight or already answered, so it runs once. */
  const startedFor = useRef<string | null>(null);
  /** Key of a scan that reached an answer, so reopening a frame is free. */
  const settledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!active || cached) return;
    if (startedFor.current === key) return;
    startedFor.current = key;

    const needed = requiredKey.split(",") as LinkedMethod[];
    let alive = true;

    void scanMatchTransactions(matchId as bigint, needed, {
      isCancelled: () => !alive,
      onProgress: (done, total) => {
        if (alive) setProgress({ key, done, total });
      },
    })
      .then((outcome) => {
        settledFor.current = key;
        writeCachedTransactions(matchId as bigint, outcome, needed);
        if (alive) setResult({ key, outcome });
      })
      .catch((err) => {
        settledFor.current = key;
        if (!alive) return;
        setResult({
          key,
          outcome: {
            txs: [],
            windowsScanned: 0,
            blocksScanned: 0,
            exhausted: true,
            degraded: String((err as any)?.message ?? err).replace(/\s+/g, " ").slice(0, 140),
          },
        });
      });

    return () => {
      alive = false;
      // Release the guard only if this scan never reached an answer. A scan
      // cut short by navigating away has to be retryable, but a finished one
      // must not run again every time the frame is reopened.
      if (settledFor.current !== key) startedFor.current = null;
    };
  }, [active, cached, key, matchId, requiredKey]);

  if (!active) return { state: "idle" };

  if (cached) {
    return { state: "ready", txs: cached, exhausted: false, degraded: null, blocksScanned: 0 };
  }

  if (result?.key === key) {
    const o = result.outcome;
    return {
      state: "ready",
      txs: o.txs,
      exhausted: o.exhausted,
      degraded: o.degraded,
      blocksScanned: o.blocksScanned,
    };
  }

  const p = progress?.key === key ? progress : null;
  return { state: "scanning", done: p?.done ?? 0, total: p?.total ?? MAX_WINDOWS };
}
