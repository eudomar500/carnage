import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveNetwork } from "./client";
import { NETWORKS } from "./networks";
import {
  confirmPollMs,
  discoveryGapMs,
  matchPollMs,
  notificationGapMs,
  notificationSweepMs,
  readBatchSize,
  readBudget,
  takeDiscoverySlot,
} from "./pacing";

/**
 * The read budget, and what the app is allowed to spend it on.
 *
 * Studio Next answers thirty contract reads a minute and refuses the rest.
 * Every cadence in the app now derives from that figure, so the thing worth
 * asserting is not each cadence on its own but the sum: an open match page
 * plus a Labs load has to fit, with room left for the reads this module does
 * not meter.
 *
 * The figures the app was written with are the Bradbury figures, and they are
 * pinned here too. Pacing is only ever allowed to slow a read down.
 */

/** The cadences as they stand in the hooks that own them. */
const MATCH_POLL = 12_000;
const FAST_CONFIRM = 5_000;
const JURY_CONFIRM = 8_000;
const SWEEP = 45_000;
const BATCH = 4;

const perMinute = (everyMs: number) => 60_000 / everyMs;

beforeEach(async () => {
  // The pacer holds its queue in module state and keys it on the active
  // network, so a read taken on the unmetered one empties it. Tests share a
  // module and each installs its own clock, and a queue built against another
  // test's clock is not a queue this one should inherit.
  setActiveNetwork("bradbury");
  await takeDiscoverySlot();
});

afterEach(() => {
  vi.useRealTimers();
  setActiveNetwork("bradbury");
});

describe("a network that does not meter reads", () => {
  it("leaves every cadence at the figure it was written with", () => {
    setActiveNetwork("bradbury");
    expect(readBudget()).toBeNull();
    expect(matchPollMs(MATCH_POLL)).toBe(12_000);
    expect(confirmPollMs(FAST_CONFIRM)).toBe(5_000);
    expect(confirmPollMs(JURY_CONFIRM)).toBe(8_000);
    expect(notificationSweepMs(SWEEP, 5)).toBe(45_000);
    expect(readBatchSize(BATCH)).toBe(4);
  });

  it("has no gap to wait for, whatever the read count", () => {
    setActiveNetwork("bradbury");
    expect(discoveryGapMs()).toBe(0);
    expect(notificationGapMs()).toBe(0);
  });

  it("lets a batch of reads go out together", async () => {
    setActiveNetwork("bradbury");
    vi.useFakeTimers();
    const at: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map(async () => {
        await takeDiscoverySlot();
        at.push(Date.now());
      }),
    );
    expect(at).toEqual([at[0], at[0], at[0], at[0]]);
  });
});

describe("a network that meters reads", () => {
  it("stretches each cadence to its share of thirty a minute", () => {
    setActiveNetwork("studio-next");
    expect(readBudget()).toBe(30);
    // A tenth of the budget: three reads a minute, one every twenty seconds.
    expect(matchPollMs(MATCH_POLL)).toBe(20_000);
    // A fifth: six a minute. Both confirmation cadences land on the same
    // figure, because the share is what binds and not the figure they came in
    // with.
    expect(confirmPollMs(FAST_CONFIRM)).toBe(10_000);
    expect(confirmPollMs(JURY_CONFIRM)).toBe(10_000);
    // Half: fifteen a minute, one every four seconds.
    expect(discoveryGapMs()).toBe(4_000);
    expect(readBatchSize(BATCH)).toBe(1);
  });

  it("prices the bell's sweep by what a sweep actually costs", () => {
    setActiveNetwork("studio-next");
    // A sweep is one read per known match plus the two-id lookahead, so three
    // known matches is five reads at one every twenty seconds.
    expect(notificationGapMs()).toBe(20_000);
    expect(notificationSweepMs(SWEEP, 5)).toBe(100_000);
    expect(notificationSweepMs(SWEEP, 1)).toBe(45_000);
    // Never faster than the unmetered period, whatever the arithmetic says.
    expect(notificationSweepMs(SWEEP, 0)).toBe(45_000);
  });

  it("never reads faster than the figure the app was written with", () => {
    setActiveNetwork("studio-next");
    expect(matchPollMs(MATCH_POLL)).toBeGreaterThanOrEqual(MATCH_POLL);
    expect(confirmPollMs(FAST_CONFIRM)).toBeGreaterThanOrEqual(FAST_CONFIRM);
    expect(confirmPollMs(JURY_CONFIRM)).toBeGreaterThanOrEqual(JURY_CONFIRM);
    expect(notificationSweepMs(SWEEP, 5)).toBeGreaterThanOrEqual(SWEEP);
  });
});

describe("the budget adds up", () => {
  it("fits an open match page and a Labs load inside thirty a minute", () => {
    setActiveNetwork("studio-next");
    const budget = readBudget()!;

    // What a match page left open costs, with a wallet connected: its own
    // state poll, and the bell sweeping the wallet's three matches.
    const poll = perMinute(matchPollMs(MATCH_POLL));
    const sweep = perMinute(notificationSweepMs(SWEEP, 5)) * 5;
    // What a Labs load costs while it is running: its whole lane.
    const labs = perMinute(discoveryGapMs());

    expect(poll).toBe(3);
    expect(sweep).toBe(3);
    expect(labs).toBe(15);
    expect(poll + sweep + labs).toBe(21);
    expect(poll + sweep + labs).toBeLessThan(budget);

    // And with a write pending, which is the busiest the app ever gets.
    const confirm = perMinute(confirmPollMs(FAST_CONFIRM));
    expect(confirm).toBe(6);
    expect(poll + sweep + labs + confirm).toBe(27);
    expect(poll + sweep + labs + confirm).toBeLessThan(budget);
  });

  it("leaves the unmetered reads something to spend", () => {
    // The wallet's eth_getBalance, the fee quote on every write and the
    // transaction status reads alongside a pending action do not come through
    // this module, so the shares must not add up to the whole budget.
    setActiveNetwork("studio-next");
    const budget = readBudget()!;
    const claimed =
      perMinute(matchPollMs(MATCH_POLL)) +
      perMinute(notificationSweepMs(SWEEP, 5)) * 5 +
      perMinute(discoveryGapMs()) +
      perMinute(confirmPollMs(FAST_CONFIRM));
    expect(budget - claimed).toBeGreaterThanOrEqual(3);
  });
});

describe("the pacer", () => {
  it("spaces concurrent reads by the discovery gap", async () => {
    setActiveNetwork("studio-next");
    vi.useFakeTimers();
    const start = Date.now();
    const at: number[] = [];

    const queued = Promise.all(
      [0, 1, 2, 3, 4].map(async () => {
        await takeDiscoverySlot();
        at.push(Date.now() - start);
      }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await queued;

    // Five reads, four seconds apart. The first goes out at once, because the
    // line is empty when it arrives.
    expect(at).toEqual([0, 4_000, 8_000, 12_000, 16_000]);
  });

  it("does not hand out a backlog of slots to a burst that follows a lull", async () => {
    setActiveNetwork("studio-next");
    vi.useFakeTimers();

    await takeDiscoverySlot();
    // Nothing reads for a minute. The queue must not have been accruing turns
    // in the meantime, or the next burst goes out all at once.
    await vi.advanceTimersByTimeAsync(60_000);

    const start = Date.now();
    const at: number[] = [];
    const queued = Promise.all(
      [0, 1, 2].map(async () => {
        await takeDiscoverySlot();
        at.push(Date.now() - start);
      }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await queued;

    expect(at).toEqual([0, 4_000, 8_000]);
  });

  it("never parks a read behind a clock that jumped backwards", async () => {
    setActiveNetwork("studio-next");
    vi.useFakeTimers();
    await takeDiscoverySlot();

    // An NTP correction, or a laptop waking. The slot the pacer handed out is
    // now an hour in the future, and no read may wait that long for it.
    vi.setSystemTime(Date.now() - 60 * 60_000);
    const start = Date.now();
    let waited = -1;
    const queued = takeDiscoverySlot().then(() => {
      waited = Date.now() - start;
    });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    await queued;
    // Eight gaps is the ceiling, and an hour is not.
    expect(waited).toBeLessThanOrEqual(8 * 4_000);
  });

  it("starts a fresh budget when the reader switches network", async () => {
    setActiveNetwork("studio-next");
    vi.useFakeTimers();
    // One read, which goes out at once and leaves a slot four seconds out.
    await takeDiscoverySlot();

    // Bradbury does not meter, so nothing queued against Studio Next's limit
    // may follow the reader across.
    setActiveNetwork("bradbury");
    const start = Date.now();
    await takeDiscoverySlot();
    expect(Date.now() - start).toBe(0);

    // And back again: the line is empty, so the first read goes out at once.
    setActiveNetwork("studio-next");
    const again = Date.now();
    await takeDiscoverySlot();
    expect(Date.now() - again).toBe(0);
  });
});

describe("the registry is where the budget lives", () => {
  it("reads the figure off the active network and nowhere else", () => {
    setActiveNetwork("bradbury");
    expect(readBudget()).toBe(NETWORKS.bradbury.capabilities.readsPerMinute);
    setActiveNetwork("studio-next");
    expect(readBudget()).toBe(NETWORKS["studio-next"].capabilities.readsPerMinute);
  });
});
