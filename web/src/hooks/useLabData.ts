import { useCallback, useEffect, useRef, useState } from "react";
import { abi } from "genlayer-js";
import { fromRlp, hexToBytes, parseAbiItem, type AbiEvent } from "viem";
import { CARNAGE_ADDRESS, CHAIN, readClient } from "../chain/client";
import { coverageNote, discoverAllMatches, type Discovery } from "../chain/discovery";
import type { MatchState } from "../chain/contract";
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
 * discovery already knows how to walk. That is the fast tier and it renders
 * immediately.
 *
 * Convergence is different. get_match records that a match was adjudicated,
 * never how many attempts it took, and the contract says so itself: a
 * discarded round leaves no on-chain trace. The only place retries and
 * rotations exist is the consensus contract's transaction index, which means
 * a log scan plus a read per transaction. That is slow, so it loads on its
 * own behind a scanning state and never blocks the page.
 */

const WINDOW = 10_000n;

/**
 * How far back the convergence scan looks.
 *
 * Same bound txlog.ts settled on. It covers the whole record today, and it is
 * reported rather than hidden so a match that ages out of range reads as out
 * of range instead of as a match that never had an adjudication.
 */
export const SCAN_WINDOWS = 40;

export type LabData = {
  matches: MatchState[];
  discovery: Discovery | null;
  coverage: string;
  loading: boolean;
  error: string | null;
};

export function useLabMatches(): LabData {
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = { cancelled: false };
    void (async () => {
      try {
        const found = await discoverAllMatches();
        if (run.cancelled) return;
        setMatches(found.matches);
        setDiscovery(found);
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
    error,
  };
}

/* ---------- convergence -------------------------------------------------- */

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

export type ConvergenceFeed = {
  byMatch: MatchConvergence[];
  scanning: boolean;
  progress: number;
  degraded: string | null;
  started: boolean;
  start: () => void;
};

/**
 * Walks the consensus log for adjudicate transactions, newest window first.
 *
 * Opt-in. Nothing runs until the reader asks for it, because a cold scan is
 * dozens of reads and the rest of the page has already told its story by then.
 */
export function useConvergence(): ConvergenceFeed {
  const [byMatch, setByMatch] = useState<MatchConvergence[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const run = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(
    () => () => {
      run.current.cancelled = true;
    },
    [],
  );

  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
    setScanning(true);
    const mine = { cancelled: false };
    run.current = mine;

    void (async () => {
      const event = newTransactionEvent();
      const consensus = CHAIN.consensusMainContract?.address as `0x${string}` | undefined;
      if (!event || !consensus) {
        setDegraded("this chain does not expose the transaction index");
        setScanning(false);
        return;
      }

      const client = readClient() as any;
      const found = new Map<string, Attempt[]>();
      try {
        const latest: bigint = await client.getBlockNumber();
        for (let i = 0; i < SCAN_WINDOWS; i++) {
          if (mine.cancelled) return;
          const to = latest - BigInt(i) * WINDOW;
          if (to <= 0n) break;
          const from = to - WINDOW + 1n > 0n ? to - WINDOW + 1n : 0n;
          const logs = await client.getLogs({
            address: consensus,
            event,
            args: { recipient: CARNAGE_ADDRESS },
            fromBlock: from,
            toBlock: to,
          });
          for (const log of logs as any[]) {
            if (mine.cancelled) return;
            const txId = log?.args?.txId as string | undefined;
            if (!txId) continue;
            const tx: any = await client.getTransaction({ hash: txId });
            const call = decodeCall(tx?.txCalldata);
            if (!call || call.method !== "adjudicate") continue;
            const matchId = String(call.args[0] ?? "");
            const statusName = String(tx?.statusName ?? "");
            const resultName = String(tx?.resultName ?? "");
            const list = found.get(matchId) ?? [];
            list.push({
              txId,
              block: Number(log.blockNumber ?? 0),
              statusName,
              resultName,
              rounds: Number(tx?.numOfRounds ?? 0),
              applied: isApplied(statusName, resultName),
            });
            found.set(matchId, list);
          }
          if (mine.cancelled) return;
          setProgress(i + 1);
        }
      } catch {
        if (!mine.cancelled) setDegraded("the scan stopped early, so some matches may be missing");
      }

      if (mine.cancelled) return;
      const rows = [...found.entries()]
        .map(([id, attempts]) =>
          convergenceOf(
            BigInt(id),
            attempts.sort((a, b) => a.block - b.block),
          ),
        )
        .sort((a, b) => Number(a.matchId - b.matchId));
      setByMatch(rows);
      setScanning(false);
    })();
  }, [started]);

  return { byMatch, scanning, progress, degraded, started, start };
}

/* ---------- per round drill-down ----------------------------------------- */

const LABEL_WORDS = ["FALSE", "TRUE", "MISLEADING", "AMBIGUOUS", "UNSUPPORTED"] as const;

/** ASCII to hex. The trace returns raw bytes and there is no Buffer here. */
function asciiHex(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; i++) out += word.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

export type RoundLabels = { round: number; labels: string[] };

/**
 * The labels a single transaction produced in each of its rounds.
 *
 * One trace read per round, so this is opt-in and used on one match. It is the
 * only way to see a leader change its answer between rotations: a discarded
 * round writes nothing, so the labels it produced exist only inside the
 * transaction.
 *
 * The return data carries both parties' labels, holder first.
 */
export async function readRoundLabels(txId: string, rounds: number): Promise<RoundLabels[]> {
  const client = readClient() as any;
  const out: RoundLabels[] = [];
  for (let round = 0; round <= rounds; round++) {
    try {
      const trace = await client.debugTraceTransaction({ hash: txId, round });
      const hex = String(trace?.return_data ?? "").toLowerCase();
      const labels = LABEL_WORDS.filter((w) => hex.includes(asciiHex(w)));
      out.push({ round, labels: [...labels] });
    } catch {
      out.push({ round, labels: [] });
    }
  }
  return out;
}
