import { CARNAGE_ADDRESS } from "./client";
import type { MatchState } from "./contract";

/**
 * A local estimate of when force_settle becomes callable.
 *
 * The contract refuses force_settle until SETTLE_GRACE_SECONDS have passed
 * since adjudicated_at, and get_match does not expose adjudicated_at. So the
 * UI cannot compute the real deadline, and until now it offered the button
 * from the moment a verdict appeared: the wallet opened, the preflight came
 * back with "settle grace period has not passed yet", and the user cancelled a
 * prompt they should never have been shown.
 *
 * What the browser can do is write down when it FIRST saw the match sitting
 * adjudicated and unsettled, and count from there. That is a lower bound on
 * the real adjudication time, never an upper one, so the estimate can only
 * ever be too cautious: it may hold the button back after the contract would
 * have accepted the call, and it can never open it before.
 *
 * The one case that goes wrong is a match adjudicated while this browser was
 * not looking. Open the page three hours after the verdict and the clock
 * starts at zero, so it asks for two more hours that the contract does not
 * want. The panel offers a way past that, and the preflight is still the thing
 * that actually decides.
 */

/** Mirrors SETTLE_GRACE_SECONDS in contracts/carnage.py. */
export const SETTLE_GRACE_SECONDS = 7200;

const PREFIX = "carnage.adjudicated";

/**
 * Keyed by contract as well as match, following the txlog cache. A redeploy
 * mints its own match ids from one, so an observation from the old contract
 * must not time a match on the new one.
 */
function key(matchId: bigint | number): string {
  return `${PREFIX}.${CARNAGE_ADDRESS.toLowerCase()}.${matchId}`;
}

/** Epoch seconds this browser first saw the verdict, or null. */
export function readObservedAt(matchId: bigint | number): number | null {
  try {
    const raw = localStorage.getItem(key(matchId));
    if (!raw) return null;
    const at = Number(JSON.parse(raw)?.at);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/**
 * Records the first sighting, and only the first.
 *
 * Safe to call on every poll: an existing record is never overwritten, or the
 * clock would restart on every read and the button would never open. A match
 * that is settled, or not adjudicated at all, has its record dropped, so a
 * redeployed contract reusing an id does not inherit a stale clock.
 */
export function noteObserved(
  m: MatchState,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  try {
    if (!m.adjudicated || m.settled) {
      localStorage.removeItem(key(m.match_id));
      return;
    }
    if (readObservedAt(m.match_id) !== null) return;
    localStorage.setItem(key(m.match_id), JSON.stringify({ at: nowSeconds }));
  } catch {
    // Storage can be unavailable. forceSettleGate then times from the current
    // render instead, which is the same answer a first sighting would give.
  }
}

export type ForceSettleGate =
  /** Not adjudicated, or already settled. The action does not apply. */
  | { state: "closed" }
  /** Inside the estimated grace period. */
  | { state: "waiting"; observedAt: number; readyAt: number; secondsLeft: number }
  /** The estimated grace has passed. The contract has the final word. */
  | { state: "open"; observedAt: number; readyAt: number };

/**
 * Read-only. Falls back to `nowSeconds` when there is no record, because a
 * missing record means this is the first sighting and the clock starts here.
 * noteObserved persists that same instant a moment later.
 */
export function forceSettleGate(m: MatchState, nowSeconds: number): ForceSettleGate {
  if (!m.adjudicated || m.settled) return { state: "closed" };

  const observedAt = readObservedAt(m.match_id) ?? nowSeconds;
  const readyAt = observedAt + SETTLE_GRACE_SECONDS;
  const secondsLeft = readyAt - nowSeconds;

  return secondsLeft > 0
    ? { state: "waiting", observedAt, readyAt, secondsLeft }
    : { state: "open", observedAt, readyAt };
}

/** "about 1h 47m", for a countdown nobody should read to the second. */
export function formatWait(seconds: number): string {
  if (seconds <= 60) return "about a minute";
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `about ${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `about ${hours}h` : `about ${hours}h ${rest}m`;
}
