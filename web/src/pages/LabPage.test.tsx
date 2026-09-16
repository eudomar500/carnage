import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { MatchState } from "../chain/contract";
import { NETWORKS, type NetworkId } from "../chain/networks";
import { NetworkContext } from "../chain/network-store";
import type { NavShell } from "../components/TopNav";

/**
 * What the lab says on a network that is not the one it was written against.
 *
 * Every figure on the page is derived, but several sentences around them were
 * not: they described Bradbury's record and were printed over whatever the
 * active contract held. Two of them contrasted a pair of numbers that are the
 * same on a corpus where no sentence repeats, which reads as nonsense ("closer
 * to 4 trials than 4").
 *
 * Two more said Studio Next keeps no transaction log, so no verdict there
 * could carry a hash. That was measured against eth_getLogs and was never true
 * of the network: its node lists a contract's whole history through
 * sim_getTransactionsForAddress. The assertions that pinned the old sentences
 * are inverted below rather than deleted, because the page must now be held to
 * the opposite claim: that it does show the transaction, and that it describes
 * the right source while doing it.
 *
 * Rendered to static markup with react-dom/server, the idiom this repo already
 * uses in components/TopNav.test.tsx, so no DOM library is needed. The data
 * hooks are the only thing stubbed: everything the assertions read is the real
 * page deriving prose from a corpus.
 */

const HOLDER = "0xF27E3A6d7Bf4BfC0A837020FD74E73055aF17D53";
const BUYER = "0xFeE34b22628Fa0D5B8fA64Ba7c49835EcB18e752";
const OTHER_HOLDER = "0x61aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaEaAF";
const OTHER_BUYER = "0xA5bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbB85a";

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
};

/** Bradbury's shape: one pair of wallets, one deal price, a sentence played twice. */
const REPEATED: MatchState[] = [
  { ...base, match_id: 1n, holder_claim: "My minimum price is 650.", holder_label: "TRUE",
    buyer_claim: "My maximum budget is 900.", buyer_label: "TRUE" },
  { ...base, match_id: 2n, holder_claim: "I can't go below 820.", holder_label: "FALSE",
    buyer_claim: "My maximum budget is 900.", buyer_label: "TRUE" },
  { ...base, match_id: 3n, holder_claim: "We're already near the bottom of what works for me.",
    holder_label: "MISLEADING", buyer_claim: "My maximum budget is 900.", buyer_label: "TRUE" },
];

/** Studio Next's shape: four wallets, two deal prices, every sentence its own. */
const DISTINCT: MatchState[] = [
  { ...base, match_id: 1n, holder_claim: "I can't go below 780.", holder_label: "FALSE",
    buyer_claim: "My maximum budget is 900.", buyer_label: "TRUE" },
  { ...base, match_id: 2n, holder: OTHER_HOLDER, buyer: OTHER_BUYER, deal_price: 780n,
    holder_revealed_state: 700n, buyer_revealed_state: 850n,
    holder_claim: "My minimum price is 700", holder_label: "TRUE",
    buyer_claim: "My maximum budget is 750.", buyer_label: "FALSE" },
];

let corpus: MatchState[] = [];
/** Which network the render under test is for. Read by the useLabData stub. */
let onBradbury = true;

vi.mock("../hooks/useLabData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useLabData")>();
  return {
    ...actual,
    useLabMatches: () => ({
      matches: corpus,
      discovery: null,
      coverage: `scanned all ${corpus.length} matches`,
      loading: false,
      found: corpus.length,
      error: null,
    }),
    // Each network reports the reach of its own index, and they do not report
    // it in the same units: Bradbury has blocks and no dates, Studio Next dates
    // and no blocks. The stub follows the network under test, because the
    // sentences being asserted below are built from exactly this.
    useAdjudications: () => ({
      byMatch: [],
      verdicts: new Map(),
      scanning: false,
      progress: 0,
      total: 0,
      degraded: null,
      done: true,
      snapshotBlock: onBradbury ? 21_640_248 : null,
      snapshotAt: onBradbury ? null : "2026-09-16",
      tailCapped: false,
    }),
    useSettlementDate: () => null,
  };
});

const shell: NavShell = {
  wallet: null,
  connecting: false,
  onConnect: () => {},
  onDisconnect: () => {},
  onHome: () => {},
  onLaunch: () => {},
};

/** The page as it renders on one network, tags stripped down to its words. */
async function text(id: NetworkId, matches: MatchState[]): Promise<string> {
  corpus = matches;
  onBradbury = id === "bradbury";
  const { default: LabPage } = await import("./LabPage");
  const network = NETWORKS[id];
  const markup = renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      {
        value: {
          network,
          networkId: id,
          capabilities: network.capabilities,
          switchNetwork: () => {},
        },
      },
      createElement(LabPage, { nav: shell }),
    ),
  );
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  vi.stubGlobal("location", {
    href: "https://carnageapp.xyz/?lab=1",
    search: "?lab=1",
    pathname: "/",
  });
});

describe("the lab on a network with a transaction log", () => {
  it("counts adjudicate transactions in the results", async () => {
    expect(await text("bradbury", REPEATED)).toContain("adjudicate transactions");
  });

  it("draws the contrast between trials and sentences, because there is one", async () => {
    const page = await text("bradbury", REPEATED);
    expect(page).toContain("The second number is the one that matters");
    expect(page).toContain("so this is closer to 3 trials than 5");
    expect(page).toContain("The other 1 claims have no checkable answer");
    expect(page).toContain("The agreement figure rests on 3 sentences, not 5");
  });

  it("keeps the opener it has always had on a one-of-everything record", async () => {
    expect(await text("bradbury", REPEATED)).toContain(
      "3 matches, played from two wallets, on one price band, one stake and one deal price.",
    );
  });

  it("promises a hash on every row and quotes the record's own examples", async () => {
    const page = await text("bradbury", REPEATED);
    expect(page).toContain("each with the transaction that wrote its verdict");
    expect(page).toContain("Follow any hash to the explorer");
    expect(page).toContain("I didn't drop to 650 because they pushed me");
  });
});

describe("the lab on a network whose node lists the contract's transactions", () => {
  it("counts adjudicate transactions here too, rather than saying it cannot", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain("adjudicate transactions,");
    // The sentence that used to send the reader to another network for this
    // measurement. Convergence is measured here now.
    expect(page).not.toContain("Convergence is measured on BRADBURY only");
    expect(page).not.toContain("exposes no transaction log");
  });

  it("names its own live source rather than the consensus log it does not have", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain("the node's own transaction index");
    expect(page).not.toContain("the consensus contract's transaction log");
  });

  it("quotes the reach of its index as a date, never as another chain's block", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain("Every transaction through 2026-09-16 is in an index");
    expect(page).not.toContain("block 21,640,248");
  });

  it("states the equal case instead of contrasting a number with itself", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain("No sentence here was played twice");
    expect(page).toContain("the figure rests on 4 trials and not fewer");
    expect(page).not.toContain("closer to 4 trials than 4");
    expect(page).not.toContain("The second number is the one that matters");
  });

  it("says nothing about claims it left out when it left none out", async () => {
    expect(await text("studio-next", DISTINCT)).not.toContain(
      "The other 0 claims have no checkable answer",
    );
  });

  it("writes the LIMITS bullets off the corpus, not off Bradbury", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain(
      "2 matches, played from four wallets, on one price band, one stake and two deal prices.",
    );
    expect(page).toContain("2 of them revealed 2 different pairs of constraints inside the band");
    expect(page).not.toContain("share one pair of revealed constraints");
    expect(page).toContain("4 scored claims, each a different sentence");
    expect(page).not.toContain("The agreement figure rests on 4 sentences, not 4");
  });

  it("promises the transaction it can now show, and still quotes no other network's claims", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain("each with the transaction that wrote its verdict");
    expect(page).toContain("Follow any hash to the explorer");
    // The case studies are pinned by id and still do not travel: an id names a
    // different match on a different deployment, whatever the source can reach.
    expect(page).not.toContain("I didn't drop to 650 because they pushed me");
    // The sentence the two examples were attached to is true everywhere.
    expect(page).toContain("A claim is scored only when a number appears inside a phrase");
  });

  it("says a missing verdict was looked for in both of this network's sources", async () => {
    const page = await text("studio-next", DISTINCT);
    expect(page).toContain(
      "no adjudicate transaction found for this match, in the committed index through " +
        "2026-09-16 or in the node's own transaction index read on this visit",
    );
  });
});
