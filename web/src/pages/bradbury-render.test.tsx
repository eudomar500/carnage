import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { MatchState } from "../chain/contract";
import { NETWORKS } from "../chain/networks";
import { NetworkContext } from "../chain/network-store";
import type { NavShell } from "../components/TopNav";

/**
 * Bradbury renders exactly as it did, byte for byte.
 *
 * Studio Next gained proof links by replacing the capability that gated them,
 * which meant touching the registry, the history loader, the scan, the lab feed
 * and every sentence on two pages that named a source. Bradbury reads all of
 * those. A change that makes a second network work by quietly rewording the
 * first one is not a fix, and the wording on the record network is the wording
 * every published link has pointed at.
 *
 * The snapshots in __snapshots__ were taken from the commit before any of this
 * landed, rendered by that commit's own code, and committed unchanged. So this
 * is not a snapshot of the new behaviour agreeing with itself: it is the old
 * output, and the new code has to reproduce it.
 *
 * A deliberate copy change on Bradbury is allowed and must update these files
 * in the same commit. That is the point of the failure: it asks whether the
 * change was meant.
 */

const HOLDER = "0xF27E3A6d7Bf4BfC0A837020FD74E73055aF17D53";
const BUYER = "0xFeE34b22628Fa0D5B8fA64Ba7c49835EcB18e752";

const base: MatchState = {
  match_id: 1n,
  holder: HOLDER,
  buyer: BUYER,
  price_floor: 500n,
  price_ceil: 1000n,
  stake_amount: 10n ** 16n,
  reveal_deadline: "2026-12-31T00:00:00Z",
  inconclusive_deadline: "2027-01-31T00:00:00Z",
  holder_committed: true,
  buyer_committed: true,
  holder_funded: true,
  buyer_funded: true,
  holder_claim: "",
  buyer_claim: "",
  holder_claimed: true,
  buyer_claimed: true,
  holder_proposed_price: 750n,
  buyer_proposed_price: 750n,
  deal_price: 750n,
  price_locked: true,
  holder_revealed: true,
  buyer_revealed: true,
  holder_revealed_state: 650n,
  buyer_revealed_state: 900n,
  adjudicated: true,
  settled: true,
  holder_label: "",
  buyer_label: "",
  holder_reasoning: "",
  buyer_reasoning: "",
  no_reveal_resolved: false,
  inconclusive_resolved: false,
  holder_claimable: 0n,
  buyer_claimable: 0n,
  sink_claimable: 0n,
  sink_address: HOLDER,
  pending_sink: "0x0000000000000000000000000000000000000000",
  holder_escrow: 10n ** 16n,
  buyer_escrow: 10n ** 16n,
  escrow_total: 2n * 10n ** 16n,
  credited_total: 2n * 10n ** 16n,
  paid_total: 0n,
  lock_deadline: 0n,
  refunded_before_lock: false,
  no_reveal_outcome: "",
  coherence_known: true,
  coherent: true,
} as MatchState;

/**
 * Nine matches, ids 1 to 9, which are the ids the committed index holds.
 *
 * The ids matter: the page looks up match 8 and match 2 by id for its two case
 * studies, and the convergence chart joins on the same ids. A corpus with
 * different ones would render a shorter page that proves less.
 */
const CORPUS: MatchState[] = Array.from({ length: 9 }, (_, i) => ({
  ...base,
  match_id: BigInt(i + 1),
  holder_claim:
    i === 7 ? "We're already near the bottom of what works for me." : "My minimum price is 650.",
  holder_label: i === 7 ? "MISLEADING" : "TRUE",
  buyer_claim:
    i === 1 ? "I didn't drop to 650 because they pushed me" : "My maximum budget is 900.",
  buyer_label: "TRUE",
})) as MatchState[];

/**
 * Only the async walk is stubbed.
 *
 * Everything the page prints about convergence is derived by the real code from
 * the real committed index, through the real converters. Stubbing the numbers
 * would leave the snapshot pinning a fixture rather than the page.
 */
vi.mock("../hooks/useLabData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useLabData")>();
  const labs = await import("../chain/labs");
  const history = await import("../chain/history");
  type Attempt = import("../chain/labs").Attempt;

  const feedFrom = (found: Map<string, Attempt[]>) => {
    const byMatch = [...found.entries()]
      .map(([id, a]) => labs.convergenceOf(BigInt(id), [...a].sort(labs.oldestFirst)))
      .sort((x, y) => Number(x.matchId - y.matchId));
    const verdicts = new Map<string, Attempt>();
    for (const row of byMatch) {
      const applied = [...row.attempts].reverse().find((a) => a.applied);
      if (applied) verdicts.set(String(row.matchId), applied);
    }
    return { byMatch, verdicts };
  };

  return {
    ...actual,
    useLabMatches: () => ({
      matches: CORPUS,
      discovery: null,
      coverage: `scanned all ${CORPUS.length} matches`,
      loading: false,
      found: CORPUS.length,
      error: null,
    }),
    useAdjudications: () => ({
      ...feedFrom(actual.indexedAttempts()),
      scanning: false,
      progress: 0,
      total: 3,
      degraded: null,
      done: true,
      snapshotBlock: history.SNAPSHOT_BLOCK,
      snapshotAt: history.SNAPSHOT_AT,
      tailCapped: false,
    }),
    // Pinned rather than read, so the snapshot does not move with the clock.
    useSettlementDate: () => ({ block: 21_640_000, day: "2026-09-12" }),
  };
});

vi.stubGlobal("location", {
  href: "https://carnageapp.xyz/?lab=1",
  search: "?lab=1",
  pathname: "/",
});

const shell: NavShell = {
  wallet: null,
  connecting: false,
  onConnect: () => {},
  onDisconnect: () => {},
  onHome: () => {},
  onLaunch: () => {},
};

function onBradbury(node: (props: any) => unknown, props: Record<string, unknown>): string {
  const network = NETWORKS.bradbury;
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      {
        value: {
          network,
          networkId: "bradbury" as const,
          capabilities: network.capabilities,
          switchNetwork: () => {},
        },
      },
      createElement(node as any, props),
    ),
  );
}

/** A settled, adjudicated match, so both proof-carrying frames are built. */
const REPLAYED: MatchState = {
  ...base,
  match_id: 3n,
  holder_claim: "My minimum price is 650.",
  buyer_claim: "My maximum budget is 900.",
  holder_label: "TRUE",
  buyer_label: "TRUE",
  holder_reasoning: "states its own floor",
  buyer_reasoning: "states its own budget",
} as MatchState;

describe("the record network renders as it always has", () => {
  it("renders the lab byte for byte", async () => {
    const { default: LabPage } = await import("./LabPage");
    const markup = onBradbury(LabPage as any, { nav: shell });
    await expect(markup).toMatchFileSnapshot("./__snapshots__/bradbury-lab.html");
  });

  it("renders the replay byte for byte", async () => {
    const { default: Replay } = await import("../components/Replay");
    const markup = onBradbury(Replay as any, { match: REPLAYED });
    await expect(markup).toMatchFileSnapshot("./__snapshots__/bradbury-replay.html");
  });
});

/**
 * The three sentences this change actually put at risk.
 *
 * The snapshot above catches any of them changing, and says only that a byte
 * moved. These say which sentence and why it matters, so a failure names the
 * thing that broke instead of handing back a diff of 46 KB.
 */
describe("the sentences that name Bradbury's source", () => {
  it("keeps the METHOD bullet's account of the two sources", async () => {
    const { default: LabPage } = await import("./LabPage");
    expect(onBradbury(LabPage as any, { nav: shell })).toContain(
      "Attempts are reconstructed from the consensus contract&#x27;s transaction log, " +
        "read from a committed index through its snapshot block and a live scan of the " +
        "blocks after it.",
    );
  });

  it("keeps the convergence section reading the log, in its own words", async () => {
    const { default: LabPage } = await import("./LabPage");
    expect(onBradbury(LabPage as any, { nav: shell })).toContain(
      "so this section reads the consensus contract&#x27;s own transaction log instead.",
    );
  });

  it("keeps the footer's shorter form of the same claim", async () => {
    const { default: LabPage } = await import("./LabPage");
    expect(onBradbury(LabPage as any, { nav: shell })).toContain(
      "The transaction behind each verdict comes from a committed index plus a live " +
        "scan of the blocks after it, described under",
    );
  });

  it("still quotes its index reach as a block, which is what Bradbury has", async () => {
    const { default: LabPage } = await import("./LabPage");
    const page = onBradbury(LabPage as any, { nav: shell });
    expect(page).toContain("Every transaction through block 21,640,248 is in an index");
    expect(page).toContain("Blocks after it were scanned live on this visit, 3 windows of them.");
  });
});
