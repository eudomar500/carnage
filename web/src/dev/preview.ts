import type { MatchState } from "../chain/contract";

/**
 * Synthetic match states for previewing the judge animation.
 *
 * DEV ONLY. `import.meta.env.DEV` is statically false in a production build,
 * so this module's data is tree-shaken out and `?preview=` does nothing in a
 * built app. Nothing here ever touches the chain or is shown as real state;
 * the console renders a loud banner whenever a preview is active.
 */

const HOLDER = "0x35A07b4d6Ba15C46545A59cF869949078B57f1BD";
const BUYER = "0x8cE34d59DeD1123C7922993334A7438d474774C0";

const base: MatchState = {
  match_id: 0n,
  holder: HOLDER,
  buyer: BUYER,
  price_floor: 500n,
  price_ceil: 1000n,
  stake_amount: 10_000_000_000_000_000n,
  reveal_deadline: "2026-12-31T00:00:00Z",
  inconclusive_deadline: "2027-01-31T00:00:00Z",
  holder_committed: true,
  buyer_committed: true,
  holder_funded: true,
  buyer_funded: true,
  holder_claim: "I can't go below 780.",
  buyer_claim: "My maximum budget is 900.",
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
  holder_label: "TRUE",
  buyer_label: "TRUE",
  holder_reasoning: "preview",
  buyer_reasoning: "preview",
  no_reveal_resolved: false,
  inconclusive_resolved: false,
  holder_claimable: 10_000_000_000_000_000n,
  buyer_claimable: 10_000_000_000_000_000n,
  sink_claimable: 0n,
  sink_address: "0xF27E3A6d7Bf4BfC0A837020FD74E73055aF17D53",
  pending_sink: "0x0000000000000000000000000000000000000000",
  holder_escrow: 10_000_000_000_000_000n,
  buyer_escrow: 10_000_000_000_000_000n,
  escrow_total: 20_000_000_000_000_000n,
  credited_total: 20_000_000_000_000_000n,
  paid_total: 0n,
  // 15 minutes before the reveal deadline above, as the contract derives it.
  lock_deadline: 1798674300n,
  refunded_before_lock: false,
  no_reveal_outcome: "",
  // holder 650 <= deal 750 <= buyer 900.
  coherence_known: true,
  coherent: true,
};

export type PreviewScenario = {
  label: string;
  expect: string;
  state: MatchState;
};

export const PREVIEWS: Record<string, PreviewScenario> = {
  "holder-lies": {
    label: "HOLDER FALSE | BUYER TRUE",
    expect: "judge turns LEFT, holder card cracks",
    state: { ...base, holder_label: "FALSE", buyer_label: "TRUE" },
  },
  "buyer-lies": {
    label: "BUYER FALSE | HOLDER TRUE",
    expect: "judge turns RIGHT, buyer card cracks",
    state: { ...base, holder_label: "TRUE", buyer_label: "FALSE" },
  },
  "buyer-misleading": {
    label: "BUYER MISLEADING | HOLDER TRUE",
    expect: "judge turns RIGHT, buyer card cracks",
    state: { ...base, holder_label: "TRUE", buyer_label: "MISLEADING" },
  },
  "holder-misleading": {
    label: "HOLDER MISLEADING | BUYER TRUE",
    expect: "judge turns LEFT, holder card cracks",
    state: { ...base, holder_label: "MISLEADING", buyer_label: "TRUE" },
  },
  "both-lie": {
    label: "BOTH FALSE",
    expect: "judge strikes straight down the middle, both cards crack",
    state: { ...base, holder_label: "FALSE", buyer_label: "FALSE" },
  },
  "nobody-lies": {
    label: "BOTH TRUE",
    expect: "no strike at all: judge stands down, no cracks, no shake",
    state: { ...base, holder_label: "TRUE", buyer_label: "TRUE" },
  },
  "ambiguous": {
    label: "HOLDER AMBIGUOUS | BUYER UNSUPPORTED",
    expect: "no strike: neither label is adverse at settlement",
    state: { ...base, holder_label: "AMBIGUOUS", buyer_label: "UNSUPPORTED" },
  },
  judge: {
    label: "MID-ADJUDICATION",
    expect: "intense glow, judge leans in, no strike",
    state: { ...base, adjudicated: false, settled: false, holder_label: "", buyer_label: "" },
  },
  reveal: {
    label: "REVEALING",
    expect: "alert: brighter, faster eye pulse",
    state: {
      ...base, adjudicated: false, settled: false, holder_label: "", buyer_label: "",
      holder_revealed: false, buyer_revealed: false,
    },
  },
};

/** A resolved preview: which scenario key was asked for, and its state. */
export type PreviewSelection = { key: string; scenario: PreviewScenario };

export function previewFromUrl(): PreviewSelection | null {
  if (!import.meta.env.DEV) return null;
  const key = new URLSearchParams(location.search).get("preview");
  if (!key) return null;
  const scenario = PREVIEWS[key];
  return scenario ? { key, scenario } : null;
}
