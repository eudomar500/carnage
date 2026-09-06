import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import { CARNAGE_ADDRESS, readClient, writeClient } from "./client";
import { decodeGenvmError } from "./errors";

/** The five-label rubric the jury returns. */
export type Label = "TRUE" | "FALSE" | "MISLEADING" | "AMBIGUOUS" | "UNSUPPORTED" | "";

export const LABELS = ["TRUE", "MISLEADING", "FALSE", "AMBIGUOUS", "UNSUPPORTED"] as const;

/** A label is dishonest when settlement moves stake away from its author. */
export function isDishonest(label: Label): boolean {
  return label === "FALSE" || label === "MISLEADING";
}

export type MatchState = {
  match_id: bigint;
  holder: string;
  buyer: string;
  price_floor: bigint;
  price_ceil: bigint;
  stake_amount: bigint;
  reveal_deadline: string;
  inconclusive_deadline: string;
  holder_committed: boolean;
  buyer_committed: boolean;
  holder_funded: boolean;
  buyer_funded: boolean;
  holder_claim: string;
  buyer_claim: string;
  holder_claimed: boolean;
  buyer_claimed: boolean;
  holder_proposed_price: bigint;
  buyer_proposed_price: bigint;
  deal_price: bigint;
  price_locked: boolean;
  holder_revealed: boolean;
  buyer_revealed: boolean;
  holder_revealed_state: bigint;
  buyer_revealed_state: bigint;
  adjudicated: boolean;
  settled: boolean;
  holder_label: Label;
  buyer_label: Label;
  holder_reasoning: string;
  buyer_reasoning: string;
  no_reveal_resolved: boolean;
  inconclusive_resolved: boolean;
  holder_claimable: bigint;
  buyer_claimable: bigint;
  sink_claimable: bigint;
};

/** GenVM returns small ints as numbers and wide ones as decimal strings. */
function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string" && v.length) return BigInt(v);
  return 0n;
}

function normalise(raw: Record<string, any>): MatchState {
  return {
    ...(raw as MatchState),
    match_id: big(raw.match_id),
    price_floor: big(raw.price_floor),
    price_ceil: big(raw.price_ceil),
    stake_amount: big(raw.stake_amount),
    holder_proposed_price: big(raw.holder_proposed_price),
    buyer_proposed_price: big(raw.buyer_proposed_price),
    deal_price: big(raw.deal_price),
    holder_revealed_state: big(raw.holder_revealed_state),
    buyer_revealed_state: big(raw.buyer_revealed_state),
    holder_claimable: big(raw.holder_claimable),
    buyer_claimable: big(raw.buyer_claimable),
    sink_claimable: big(raw.sink_claimable),
  };
}

/**
 * Reads a match.
 *
 * The variant argument is kept because the RPC accepts it, but Bradbury does
 * not act on it: `latest-final`, `latest-nonfinal` and even a nonsense value
 * all return identical state. Nothing here may treat it as a finality signal.
 */
export async function getMatch(
  matchId: number | bigint,
  variant: TransactionHashVariant = TransactionHashVariant.LATEST_NONFINAL,
): Promise<MatchState> {
  const raw = await readClient().readContract({
    address: CARNAGE_ADDRESS,
    functionName: "get_match",
    args: [Number(matchId)],
    transactionHashVariant: variant,
  });
  return normalise(raw as Record<string, any>);
}

/** A match id that has never been created reads back as a UserError. */
export function isUnknownMatch(err: unknown): boolean {
  return decodeGenvmError(err).includes("unknown match_id");
}

export type MatchView = {
  /** Live state. Drives everything the hero displays. */
  accepted: MatchState;
};

/**
 * Reads the match.
 *
 * Deliberately a single read. Bradbury does not act on
 * `transaction_hash_variant`. It accepts `latest-final`, `latest-nonfinal`
 * and even a nonsense value without complaint and returns identical state, so
 * a second "finalized" read is wasted traffic and, worse, false assurance.
 * Finality is established structurally instead; see claimGate.
 */
export async function getMatchView(matchId: number | bigint): Promise<MatchView> {
  return { accepted: await getMatch(matchId) };
}

/** Highest match id the contract has minted, found by probing upward. */
export async function findLatestMatchId(max = 64): Promise<bigint | null> {
  let latest: bigint | null = null;
  for (let id = 1n; id <= BigInt(max); id++) {
    try {
      await getMatch(id);
      latest = id;
    } catch {
      break;
    }
  }
  return latest;
}

export type ClaimGate =
  | { state: "not-settled"; reason: string }
  | { state: "nothing-to-claim"; reason: string }
  | { state: "not-a-party"; reason: string }
  | { state: "ready"; amount: bigint };

/**
 * Gates the claim button on finality, established structurally and not by a
 * state read.
 *
 * `settle` is unreachable from any external account: it rejects every sender
 * except the contract itself, and the only thing that ever calls it is the
 * message `adjudicate` emits with `onAcceptance: false`. That message fires
 * only when the adjudicate transaction FINALIZES.
 *
 * So `settled == true` is itself proof that adjudication finalized and the
 * verdict (and therefore every claimable amount derived from it) can no
 * longer change. That holds for any viewer, with no transaction hash, and
 * without depending on a read variant this chain ignores.
 *
 * Observed directly on match 2: while its adjudicate transaction sat at
 * ACCEPTED, `settled` stayed false; it flipped to true only once that
 * transaction reached FINALIZED.
 */
export function claimGate(m: MatchState, wallet: string | null): ClaimGate {
  const resolved = m.settled || m.no_reveal_resolved || m.inconclusive_resolved;
  if (!resolved) {
    return {
      state: "not-settled",
      reason: "settlement has not run; the jury verdict is not final yet",
    };
  }

  if (!wallet) return { state: "not-a-party", reason: "connect a wallet to check your claim" };

  const me = wallet.toLowerCase();
  const isHolder = m.holder.toLowerCase() === me;
  const isBuyer = m.buyer.toLowerCase() === me;
  if (!isHolder && !isBuyer) {
    return { state: "not-a-party", reason: "this wallet is not a party to the match" };
  }

  const amount = isHolder ? m.holder_claimable : m.buyer_claimable;
  if (amount === 0n) return { state: "nothing-to-claim", reason: "no balance left to claim" };

  return { state: "ready", amount };
}

export type ClaimStage = "accepted" | "finalized";

/**
 * Signs and sends claim(match_id), then follows it to FINALIZED.
 *
 * This is where transaction-status finality genuinely applies: we hold the
 * hash, so `statusName` is ground truth. It matters because `claim` credits
 * nothing directly. It zeroes the balance and schedules the payout with
 * `emit_transfer(on="finalized")`. The GEN only moves when THIS transaction
 * finalizes, which on Bradbury runs well behind acceptance.
 *
 * Resolves at ACCEPTED so the UI can react promptly, and reports `finalized`
 * through `onStage` once the payout has actually been released.
 */
export async function sendClaim(
  matchId: number | bigint,
  wallet: `0x${string}`,
  onStage?: (stage: ClaimStage) => void,
): Promise<{ hash: `0x${string}`; status: TransactionStatus }> {
  const client = writeClient(wallet);
  const hash = await client.writeContract({
    address: CARNAGE_ADDRESS,
    functionName: "claim",
    args: [Number(matchId)],
    value: 0n,
  });

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    interval: 4000,
    retries: 60,
  });
  onStage?.("accepted");

  // Finalization is the slow part; follow it without blocking the caller.
  void client
    .waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      interval: 20_000,
      retries: 360,
    })
    .then(() => onStage?.("finalized"))
    .catch(() => {});

  return { hash, status: receipt.status as TransactionStatus };
}
