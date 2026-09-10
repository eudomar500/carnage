import { confirmationFor } from "./confirm";
import type { MatchState } from "./contract";
import { ACTION_IDS, seatOf, type ActionId, type Role } from "./roles";

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
  /**
   * The match id this attempt is expected to bring into existence.
   *
   * Only create_match sets it. Every other action names its match in the key
   * and proves itself with a postcondition against that match's state, but a
   * create has no match to read until it lands, so the id the simulation
   * predicted is written down here and the sweep watches for it to appear.
   */
  target?: number;
  /**
   * The address a sink proposal is expected to leave in pending_sink.
   *
   * Only propose_sink sets it. Like create_match, this action has no
   * postcondition in the confirmation table, because the value it produces is
   * only known at click time: proposing an address sets pending_sink to it and
   * proposing the zero address clears it, so no predicate over match state
   * alone covers both. Writing the proposed address down turns both cases into
   * the same test, pending_sink equals what we asked for.
   */
  targetSink?: string;
};

/** create_match has no match of its own, so its records live under id 0. */
export const CREATE_KEY_ID = 0;

const PREFIX = "carnage.attempt";

/* ---------- change notification ----------------------------------------- */

/**
 * Who to tell when a record changes.
 *
 * The journal is read during render by every action panel, and it is written
 * from three places that are not those panels: the panel's own watch, the
 * app-level sweep, and another tab. Without a channel back, a panel that was
 * showing an in-flight notice kept showing it after the sweep had already
 * cleared the record, because nothing told it to look again. That is half of
 * what made an orphaned create linger on screen.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function announce(): void {
  // Copied first: a listener is free to unsubscribe itself while reacting.
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // One bad listener must not stop the others from hearing about it.
    }
  }
}

// Another tab clearing a record counts as a change here too. Same protection
// the single-tab case gets, for free.
try {
  addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith(PREFIX)) announce();
  });
} catch {
  // No window (tests, SSR). Nothing to listen to.
}


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
  announce();
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
  announce();
}

/**
 * Records which match id a create is waiting for.
 *
 * Written between the simulation and the send, so the sweep has something to
 * watch for even if the tab navigates away a second later.
 */
export function noteTarget(
  matchId: bigint | number,
  actionId: ActionId,
  target: number,
): void {
  const prior = readAttempt(matchId, actionId);
  if (!prior) return;
  try {
    localStorage.setItem(key(matchId, actionId), JSON.stringify({ ...prior, target }));
  } catch {
    // Without it the create falls back to clearing when its panel finishes.
  }
  announce();
}

/**
 * Records which address a sink proposal is waiting to see in pending_sink.
 *
 * Same timing rule as noteTarget: written before the send, so a tab that
 * navigates away mid-proposal still leaves the sweep something to recognise.
 */
export function noteSinkTarget(
  matchId: bigint | number,
  actionId: ActionId,
  targetSink: string,
): void {
  const prior = readAttempt(matchId, actionId);
  if (!prior) return;
  try {
    localStorage.setItem(key(matchId, actionId), JSON.stringify({ ...prior, targetSink }));
  } catch {
    // Without it the proposal falls back to clearing when its panel finishes.
  }
  announce();
}

export function clearAttempt(matchId: bigint | number, actionId: ActionId): void {
  try {
    localStorage.removeItem(key(matchId, actionId));
  } catch {
    // Nothing to do.
  }
  announce();
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
  let changed = false;
  for (const id of ACTION_IDS) {
    const prior = readAttempt(m.match_id, id);
    if (!prior) continue;
    const landed = confirmationFor(id, role).landed;
    if (landed && landed(m)) {
      clearAttempt(m.match_id, id);
      changed = true;
    }
  }
  if (changed) announce();
}

/**
 * Retires a create once the match it was minting exists.
 *
 * create_match is the one action with no postcondition to test, because there
 * is no match to read until it lands and the id it will take is a guess until
 * then. So it gets the only other thing that is true at acceptance: the
 * contract now answers for the id the simulation predicted.
 *
 * `scannedTo` is discovery's high-water mark, the highest id confirmed to
 * exist. Match ids are dense and start at one, so an id at or below that mark
 * exists, which makes this exactly as strong as a per-match postcondition and
 * true at exactly the same moment: acceptance.
 */
export function reconcileCreate(scannedTo: number): void {
  const prior = readAttempt(CREATE_KEY_ID, "create_match");
  if (!prior) return;
  if (typeof prior.target !== "number") return;
  if (scannedTo < prior.target) return;
  clearAttempt(CREATE_KEY_ID, "create_match");
}

/**
 * Retires a sink proposal once pending_sink holds what it asked for.
 *
 * pending_sink is global contract state that every match's view reports, so
 * any match answers for it. Reading it against the address we wrote down makes
 * the cancel case fall out for free: proposing the zero address lands when
 * pending_sink is the zero address, which is the same comparison.
 *
 * If the proposal was a no-op, asking for an address that was already pending,
 * this clears on the first pass. That is the same answer the action layer
 * already gives elsewhere: a postcondition that is true before you send means
 * there is nothing to wait for.
 */
export function reconcileSinkProposal(m: MatchState): void {
  const prior = readAttempt(m.match_id, "propose_sink");
  if (!prior) return;
  if (typeof prior.targetSink !== "string") return;
  if (m.pending_sink.toLowerCase() !== prior.targetSink.toLowerCase()) return;
  clearAttempt(m.match_id, "propose_sink");
}

/**
 * The app-level sweep. One pass over everything this wallet can see.
 *
 * This is the fix for the whole class of orphaned records. A panel only clears
 * its own attempt while it stays mounted, and the per-match reconcile only
 * ever saw the match currently on screen, so starting an action and then
 * navigating anywhere else left the record with nobody watching it. It then
 * sat there until the resume budget expired, which is not clearing at all, it
 * is just the notice ageing out of view.
 *
 * Run from the notification sweep, which already reads every match this wallet
 * has a stake in and runs from the top of the tree on every route. So the
 * criterion is the same one the in-session path uses, the postcondition
 * against live state, and it no longer depends on which view is mounted.
 */
export function reconcileAll(
  matches: MatchState[],
  wallet: string | null,
  scannedTo: number,
): void {
  for (const m of matches) {
    const seat = seatOf(m, wallet);
    reconcile(m, seat === "buyer" ? "buyer" : "holder");
    reconcileSinkProposal(m);
  }
  reconcileCreate(scannedTo);
}
