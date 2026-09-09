import { confirmationFor } from "./confirm";
import type { MatchState } from "./contract";
import { ACTION_IDS, type ActionId, type Role } from "./roles";

/**
 * A one-record-per-step log of what this browser last tried to do.
 *
 * Contract state says what happened; it cannot say what was attempted. After
 * a reload, "both sides revealed and adjudicated is false" reads identically
 * whether nobody has summoned the jury yet or a round was fired and thrown
 * away. Only the client knows the difference, so it has to write it down.
 *
 * Two things depend on this:
 *
 *   - A reload while a transaction is still in flight resumes watching
 *     instead of offering a retry that would double-fire it.
 *   - A reload after a discarded round explains what happened rather than
 *     leaving a bare enabled button, which is how match 2 ended up being
 *     diagnosed from the CLI.
 *
 * A second tab reads the same records, so it gets the same protection.
 */
/**
 * "failed" is no longer written. A failure that reached this outcome is one
 * where nothing was broadcast, and the record is dropped instead, so the next
 * page load offers a clean form rather than a retry for a transaction that
 * never existed. It stays in the union because records written before that
 * change can still be sitting in a browser.
 */
export type AttemptOutcome = "pending" | "confirmed" | "unconfirmed" | "failed";

export type Attempt = {
  actionId: ActionId;
  /** Epoch ms at which the attempt was submitted. */
  startedAt: number;
  outcome: AttemptOutcome;
  /**
   * The transaction hash, once the wallet has handed one back.
   *
   * Optional because the record is written before the wallet even opens: at
   * that point we know an attempt is being made and nothing else. It is
   * stamped on afterwards, and a record without one is still a valid record,
   * it just cannot offer an explorer link.
   */
  hash?: string;
};

const PREFIX = "carnage.attempt";

function key(matchId: bigint | number, actionId: ActionId): string {
  return `${PREFIX}.${matchId}.${actionId}`;
}

/** Storage can be unavailable (private mode, disabled cookies). Never throw. */
export function readAttempt(matchId: bigint | number, actionId: ActionId): Attempt | null {
  try {
    const raw = localStorage.getItem(key(matchId, actionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Attempt;
    if (typeof parsed?.startedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The hash is passed explicitly rather than carried over from whatever was
 * stored before. A fresh attempt has no hash yet, and inheriting the dead
 * one's would point the user at a transaction that is not the one they are
 * waiting on.
 */
export function writeAttempt(
  matchId: bigint | number,
  actionId: ActionId,
  outcome: AttemptOutcome,
  startedAt = Date.now(),
  hash?: string,
): void {
  try {
    const record: Attempt = { actionId, startedAt, outcome, ...(hash ? { hash } : {}) };
    localStorage.setItem(key(matchId, actionId), JSON.stringify(record));
  } catch {
    // Recovery still works within the session; only the reload path is lost.
  }
}

/**
 * Stamps the transaction hash onto an attempt already on record.
 *
 * Read-modify-write rather than a fresh record, because `startedAt` is what
 * the resume path measures against and rewriting it here would restart the
 * clock at the moment of signing rather than the moment of trying.
 */
export function noteHash(
  matchId: bigint | number,
  actionId: ActionId,
  hash: string,
): void {
  const prior = readAttempt(matchId, actionId);
  if (!prior) return;
  try {
    localStorage.setItem(key(matchId, actionId), JSON.stringify({ ...prior, hash }));
  } catch {
    // The attempt is still on record, just without its link.
  }
}

export function clearAttempt(matchId: bigint | number, actionId: ActionId): void {
  try {
    localStorage.removeItem(key(matchId, actionId));
  } catch {
    // Nothing to do.
  }
}

/**
 * Drops every record whose state change is now visible on-chain.
 *
 * The panel that started an attempt is not necessarily around to see it land.
 * A commit that registers while the tab is closed, or between two polls, takes
 * its own panel off the screen the moment deriveTurn stops offering it, and
 * the record it left behind would otherwise sit in storage forever and greet
 * the next visitor with an in-flight notice for something that finished.
 *
 * So the reconciliation runs off the match feed instead, on every successful
 * read, and answers the only question that matters from contract state: did
 * the thing this attempt was trying to do happen?
 */
export function reconcile(m: MatchState, role: Role): void {
  for (const id of ACTION_IDS) {
    const prior = readAttempt(m.match_id, id);
    if (!prior) continue;
    const landed = confirmationFor(id, role).landed;
    if (landed && landed(m)) clearAttempt(m.match_id, id);
  }
}
