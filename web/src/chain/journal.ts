import type { ActionId } from "./roles";

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
export type AttemptOutcome = "pending" | "confirmed" | "unconfirmed" | "failed";

export type Attempt = {
  actionId: ActionId;
  /** Epoch ms at which the attempt was submitted. */
  startedAt: number;
  outcome: AttemptOutcome;
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

export function writeAttempt(
  matchId: bigint | number,
  actionId: ActionId,
  outcome: AttemptOutcome,
  startedAt = Date.now(),
): void {
  try {
    const record: Attempt = { actionId, startedAt, outcome };
    localStorage.setItem(key(matchId, actionId), JSON.stringify(record));
  } catch {
    // Recovery still works within the session; only the reload path is lost.
  }
}

export function clearAttempt(matchId: bigint | number, actionId: ActionId): void {
  try {
    localStorage.removeItem(key(matchId, actionId));
  } catch {
    // Nothing to do.
  }
}
