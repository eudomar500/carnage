import { CARNAGE_ADDRESS } from "./client";
import bradburyIndex from "./history.json";
import studioNextIndex from "./history-studio-next.json";

/**
 * The committed transaction indexes, and the one this load is for.
 *
 * Why they exist is documented once, in txlog.ts. This module is only the
 * typed door onto the JSON plus the two questions every consumer asks of it:
 * which entries belong to a match, and which entries cannot be trusted as
 * final.
 *
 * There is one file per deployment and they are not interchangeable. The index
 * is chosen by contract address rather than by network id, because the address
 * is the thing the file is actually about: pointing a network row at a
 * redeploy without re-running its snapshot should degrade to an empty index,
 * not to another deployment's transactions presented as this one's proof.
 *
 * The two files do not describe the same kind of chain, and the type says so
 * rather than papering over it. Bradbury numbers blocks and Studio Next does
 * not, so `block` is nullable and `at` carries the time where blocks are
 * absent. Every ordering below goes through `orderOf`, which reads whichever
 * one the network has.
 */

export type HistoryEntry = {
  hash: `0x${string}`;
  /**
   * Block the transaction landed in, or null on a network that numbers none.
   * Null on every Studio Next entry; `at` is what orders those.
   */
  block: number | null;
  /**
   * When the node recorded the transaction, ISO 8601 to the second, or null
   * where the source does not report it. Absent from the Bradbury index, whose
   * source is a log filter that reports blocks and not times.
   */
  at?: string | null;
  /** null for the deployment, whose calldata is source rather than a call. */
  method: string | null;
  /** Decimal match id, or null for calls that name no match. */
  matchId: string | null;
  sender: string;
  /** Status and result as observed at snapshot time. */
  status: string;
  result: string;
  /** Consensus rounds the transaction burned. Not derivable from contract state. */
  rounds: number;
};

export type History = {
  contract: string;
  chainId: number;
  /**
   * What produced this file, in one sentence. Absent from the Bradbury index,
   * which predates the field; its source is scripts/snapshot.mjs.
   */
  source?: string;
  /** The day the snapshot was taken, ISO. Absent for the same reason. */
  snapshotAt?: string;
  /** Null on a network that numbers no blocks. */
  deployBlock: number | null;
  snapshotBlock: number | null;
  transactions: HistoryEntry[];
};

/**
 * Every committed index in the repository.
 *
 * Adding a deployment means adding a file and a line here. It should not mean
 * touching anything below.
 */
const INDEXES = [bradburyIndex, studioNextIndex] as unknown as History[];

const EMPTY: History = {
  contract: CARNAGE_ADDRESS,
  chainId: 0,
  deployBlock: null,
  snapshotBlock: null,
  transactions: [],
};

/**
 * An index built against a different contract is not evidence about this one.
 *
 * Pointing CARNAGE_ADDRESS at a redeploy without re-running the snapshot would
 * otherwise surface another contract's transactions as this one's proof. No
 * match degrades to an empty index, which reads as "read it live" rather than
 * as a wrong answer.
 */
const LOADED =
  INDEXES.find((i) => i.contract.toLowerCase() === CARNAGE_ADDRESS.toLowerCase()) ?? null;

export const HISTORY_MATCHES_CONTRACT = LOADED !== null;

export const HISTORY: History = LOADED ?? EMPTY;

/** The block the contract was deployed in, or null where there are no blocks. */
export const DEPLOY_BLOCK = HISTORY.deployBlock;

/**
 * The last block the index covers.
 *
 * On a network with blocks, everything at or below this is answered from the
 * committed file and everything above it has to be scanned live. Null where
 * the network numbers no blocks, and null when no index matches the contract,
 * which is what sends the live source out to cover the whole history rather
 * than trusting a file about something else.
 */
export const SNAPSHOT_BLOCK = HISTORY.snapshotBlock;

/** What produced the index this load is reading, or null when none matched. */
export const HISTORY_SOURCE = LOADED?.source ?? null;

/** The day the index this load is reading was taken, or null when none matched. */
export const SNAPSHOT_AT = LOADED?.snapshotAt ?? null;

/**
 * Where one entry sits in its network's own order.
 *
 * Blocks where the network has them, seconds where it does not. The two are
 * never compared against each other: one index describes one deployment, and
 * every entry in it reports the same one of the two.
 */
export function orderOf(e: { block: number | null; at?: string | null }): number {
  if (e.block !== null) return e.block;
  const ms = Date.parse(String(e.at ?? ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Statuses after which a transaction can no longer change. */
const TERMINAL = new Set(["FINALIZED", "CANCELED"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/**
 * Index entries for one match, newest first.
 *
 * `methods` filters to the callers' own vocabulary. Entries whose status was
 * not terminal at snapshot time are returned like any other: it is the
 * caller's job to re-read those live, because only the caller knows whether it
 * is about to show the status to anybody.
 */
export function historyFor(
  matchId: bigint | number | string,
  methods?: Set<string>,
): HistoryEntry[] {
  const wanted = String(matchId);
  return HISTORY.transactions
    .filter((e) => e.matchId === wanted && (!methods || (e.method !== null && methods.has(e.method))))
    .sort((a, b) => orderOf(b) - orderOf(a));
}

/** Every index entry carrying the given method, newest first. */
export function historyByMethod(method: string): HistoryEntry[] {
  return HISTORY.transactions
    .filter((e) => e.method === method)
    .sort((a, b) => orderOf(b) - orderOf(a));
}

/** Entries the runtime must re-read rather than trust. Normally empty. */
export function staleEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e) => !isTerminalStatus(e.status));
}
