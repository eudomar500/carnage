import { activeNetworkId, capabilities } from "./client";
import type { NetworkId } from "./networks";

/**
 * How fast this app is allowed to read the contract.
 *
 * Studio Next meters reads. It answers thirty a minute and refuses the rest
 * with "Rate limit exceeded: 30 requests per minute", and a refusal is not an
 * answer: the match walk read one as the end of the id list and published a
 * truncated record, and the match page read one as a failed poll and put a
 * read error over live state. Bradbury has never refused a read for rate, so
 * it carries readsPerMinute: null and every cadence below returns exactly the
 * figure it has always used.
 *
 * The budget is divided here rather than at each call site, because the figure
 * that matters is the sum. Six separate constants each defensible on its own
 * is how a budget gets spent twice.
 *
 * The shares are of the whole budget, and they are deliberately less than all
 * of it. What is left over pays for everything this module does not meter: the
 * wallet's own eth_getBalance before it signs, the fee quote on every write,
 * the transaction status reads that ride alongside a pending action, and the
 * second tab the reader has open.
 *
 *   discovery      0.50   the match walk. The biggest burst and the one that
 *                         failed: Labs asks for every id at page load, and the
 *                         notification sweep asks for the wallet's own. Half
 *                         the budget is one read every 4 s, so the three
 *                         matches on the deployed contract plus the probe that
 *                         ends the walk take about 12 s.
 *
 *   confirmPoll    0.20   the watcher that waits for a write to show up in
 *                         state. Only runs while an action is pending, and the
 *                         reader is watching it, so it gets more than the idle
 *                         page. One read every 10 s against 5 s on Bradbury.
 *
 *   matchPoll      0.10   the match page's own state poll, which runs for as
 *                         long as the tab is open. One read every 20 s against
 *                         12 s on Bradbury.
 *
 *   notifications  0.10   the bell's sweep. It costs one read per match the
 *                         wallet has a stake in, plus the lookahead, so its
 *                         period is derived from that count rather than fixed.
 *
 * Adding up what an open match page and a Labs load actually spend on Studio
 * Next: 3 reads a minute for the poll, 3 for the sweep, and the Labs walk
 * inside its own 15 a minute. That is 21 of 30 with the page idle, and 27 of
 * 30 while a write is pending. Both leave the node room to say yes.
 */

const DISCOVERY = 0.5;
const CONFIRM_POLL = 0.2;
const MATCH_POLL = 0.1;
const NOTIFICATIONS = 0.1;

/** Reads a minute this network will answer, or null where it does not meter. */
export function readBudget(): number | null {
  return capabilities().readsPerMinute;
}

/**
 * The gap one share of the budget buys between two reads.
 *
 * Zero on an unmetered network, which is what makes every cadence below fall
 * back to the figure it was written with rather than to a computed one.
 */
function shareGapMs(share: number): number {
  const budget = readBudget();
  if (budget === null || budget <= 0) return 0;
  return Math.ceil(60_000 / (budget * share));
}

/**
 * A cadence, stretched to fit its share and never shortened to fill it.
 *
 * Pacing is allowed to slow a poll down and never to speed one up. A share
 * that works out faster than the figure the app was written with is a share
 * with room to spare, not an instruction to read more often.
 */
function paced(baseMs: number, share: number): number {
  return Math.max(baseMs, shareGapMs(share));
}

/* ---------- the cadences themselves -------------------------------------- */

/** Bradbury 12 s, Studio Next 20 s. See useMatch. */
export function matchPollMs(base: number): number {
  return paced(base, MATCH_POLL);
}

/** Bradbury 5 s and 8 s, Studio Next 10 s for both. See confirm.ts. */
export function confirmPollMs(base: number): number {
  return paced(base, CONFIRM_POLL);
}

/**
 * How long the bell waits between sweeps.
 *
 * A sweep is not one read. It re-reads every match the wallet has a stake in
 * and probes a couple past the end, so the period has to be derived from that
 * count or a wallet with several matches spends the whole budget on the bell.
 * Unmetered, the period is the 45 s it has always been.
 */
export function notificationSweepMs(base: number, readsPerSweep: number): number {
  return Math.max(base, Math.max(1, readsPerSweep) * shareGapMs(NOTIFICATIONS));
}

/**
 * Ids the match walk probes at once.
 *
 * Four on an unmetered network. One where reads are counted: a batch of four
 * against a budget of thirty a minute is three refusals and an answer, and the
 * refusals cost retries that put the walk further behind than running it in
 * single file would have.
 */
export function readBatchSize(base: number): number {
  return readBudget() === null ? base : 1;
}

/* ---------- the pacer ----------------------------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The next moment a read may go out, and the network that moment belongs to.
 *
 * Keyed by network so that switching chains starts a fresh budget rather than
 * inheriting a queue built against another node's limit. Nothing has to be
 * told about the switch: the next caller notices the id changed.
 */
let pacedNetwork: NetworkId | null = null;
let nextSlotAt = 0;

/** How many gaps ahead of now a slot may ever be handed out. */
const MAX_QUEUE = 8;

/**
 * Waits for this read's turn in the discovery lane.
 *
 * Only the match walk queues. The poll and the watcher are already spaced by
 * their own intervals, and putting them in this line would make each of them
 * wait behind a Labs load for no gain. The walk is the one that bursts, and
 * the one that failed.
 *
 * Callers line up by taking the next slot and waiting for it, so concurrent
 * callers space themselves out instead of arriving together. Returns at once
 * on an unmetered network, where there is no line and no slot to take.
 */
export async function takeDiscoverySlot(): Promise<void> {
  const id = activeNetworkId();
  if (id !== pacedNetwork) {
    pacedNetwork = id;
    nextSlotAt = 0;
  }

  const gap = shareGapMs(DISCOVERY);
  if (gap === 0) return;

  const now = Date.now();
  // Math.max, so a queue that drained while nothing was reading does not hand
  // out a backlog of slots in the past and let a burst through. Math.min, so a
  // clock that jumps backwards, an NTP correction or a laptop waking, cannot
  // park every read behind a slot that is now hours away. Nothing queues more
  // than a few deep in practice: a metered network reads one id at a time, so
  // the only concurrency is the handful of callers the app has.
  const slot = Math.min(Math.max(now, nextSlotAt), now + gap * MAX_QUEUE);
  nextSlotAt = slot + gap;
  if (slot > now) await sleep(slot - now);
}

/** The discovery gap, for the tests and for anything that needs to report it. */
export function discoveryGapMs(): number {
  return shareGapMs(DISCOVERY);
}

/** The bell's per-read gap, exposed for the same reason. */
export function notificationGapMs(): number {
  return shareGapMs(NOTIFICATIONS);
}
