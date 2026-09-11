import { CARNAGE_ADDRESS } from "./client";
import raw from "./history.json";

/**
 * The committed transaction index.
 *
 * Why it exists is documented once, in txlog.ts. This module is only the typed
 * door onto the JSON plus the two questions every consumer asks of it: which
 * entries belong to a match, and which entries cannot be trusted as final.
 */

export type HistoryEntry = {
  hash: `0x${string}`;
  block: number;
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
  deployBlock: number;
  snapshotBlock: number;
  transactions: HistoryEntry[];
};

const LOADED = raw as History;

/**
 * An index built against a different contract is not evidence about this one.
 *
 * Pointing CARNAGE_ADDRESS at a redeploy without re-running the snapshot would
 * otherwise surface another contract's transactions as this one's proof. The
 * mismatch degrades to an empty index, which reads as "scan everything live"
 * rather than as a wrong answer.
 */
export const HISTORY_MATCHES_CONTRACT =
  LOADED.contract.toLowerCase() === CARNAGE_ADDRESS.toLowerCase();

export const HISTORY: History = HISTORY_MATCHES_CONTRACT
  ? LOADED
  : { ...LOADED, transactions: [] };

/** The block the contract was deployed in, read from the index, not a constant. */
export const DEPLOY_BLOCK = LOADED.deployBlock;

/**
 * The last block the index covers.
 *
 * Everything at or below this is answered from the committed file; everything
 * above it has to be scanned live. When the index does not match the contract
 * this drops to the deploy block, so the live scan is asked to cover the whole
 * history rather than trusting a file about something else.
 */
export const SNAPSHOT_BLOCK = HISTORY_MATCHES_CONTRACT
  ? LOADED.snapshotBlock
  : LOADED.deployBlock - 1;

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
    .sort((a, b) => b.block - a.block);
}

/** Every index entry carrying the given method, newest first. */
export function historyByMethod(method: string): HistoryEntry[] {
  return HISTORY.transactions
    .filter((e) => e.method === method)
    .sort((a, b) => b.block - a.block);
}

/** Entries the runtime must re-read rather than trust. Normally empty. */
export function staleEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e) => !isTerminalStatus(e.status));
}
