import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import { capabilities, CARNAGE_ADDRESS, readClient, writeClient } from "./client";
import { quoteFees, withFees } from "./fees";
import { decodeGenvmError, tagStage } from "./errors";

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

  /**
   * Whether this deployment will actually pay a claim.
   *
   * Only the v0.6 fork returns it; Bradbury's contract predates the field, so
   * it is optional and absent there. Absent means enabled, which is what
   * Bradbury has always done. Read through withdrawalsEnabled() rather than
   * directly, so the fallback lives in one place.
   */
  withdrawals_enabled?: boolean;

  /** Protocol sink, and the address mid-handover in the two-step transfer. */
  sink_address: string;
  /** Zero address when no handover is pending. */
  pending_sink: string;

  /**
   * The escrow ledger. The contract credits and pays strictly against these,
   * so a match can never pay out more than it actually holds.
   */
  holder_escrow: bigint;
  buyer_escrow: bigint;
  escrow_total: bigint;
  credited_total: bigint;
  paid_total: bigint;

  /**
   * Unix seconds, NOT an ISO string like reveal_deadline and
   * inconclusive_deadline. Past it with no locked price, anyone can refund.
   */
  lock_deadline: bigint;
  refunded_before_lock: boolean;

  /**
   * How a no-reveal resolved, in the contract's own words:
   * HOLDER_REVEALED_BUYER_SLASHED, BUYER_REVEALED_HOLDER_SLASHED or
   * BOTH_UNREVEALED_REFUNDED. Empty until resolve_no_reveal runs.
   */
  no_reveal_outcome: string;

  /**
   * Whether holder_revealed_state <= deal_price <= buyer_revealed_state.
   * Recorded once both sides reveal and never enforced: committing an
   * incoherent constraint is allowed, it is just visible.
   */
  coherence_known: boolean;
  coherent: boolean;
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
    holder_escrow: big(raw.holder_escrow),
    buyer_escrow: big(raw.buyer_escrow),
    escrow_total: big(raw.escrow_total),
    credited_total: big(raw.credited_total),
    paid_total: big(raw.paid_total),
    lock_deadline: big(raw.lock_deadline),
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
  // Bradbury's node puts the GenVM return data in the error, so the contract's
  // own words come back and the test is exact.
  if (decodeGenvmError(err).includes("unknown match_id")) return true;

  // Studio Next's does not. The same read of an unminted id fails with
  // details "execution failed" and nothing else: no ReturnData, no UserError
  // text, and a viem shortMessage of "Missing or invalid parameters." So the
  // walk that discovers matches saw its stop condition as a failed read and
  // reported the list as possibly incomplete, on a network with one match.
  //
  // On a network like that, a reverted get_match can only be this. get_match
  // reaches exactly one raise, _get_match's "unknown match_id", and has no
  // other failure of its own, so "the contract ran and refused" and "that id
  // does not exist" are the same statement for this call.
  //
  // The test is still narrow on purpose. It requires the node's own
  // "execution failed", which is the node saying the GenVM ran and reverted.
  // A transport fault does not say that: a timeout, a refused connection or a
  // rate limit arrives as a different error with a different shape, and stays
  // a failed read.
  if (!capabilities().revertDataInReads && isExecutionFailure(err)) return true;

  return false;
}

/** The node reporting that the contract ran and reverted, with no detail. */
function isExecutionFailure(err: unknown): boolean {
  const e = err as any;
  const detail = String(e?.details ?? e?.cause?.message ?? "");
  return /^execution failed/i.test(detail.trim());
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

/**
 * True once the match has reached any of its four terminal states.
 *
 * This is the only definition. It used to be spelled out separately in the
 * claim gates, the lifecycle and two components, and when refunded_before_lock
 * was added to the contract, four of those five copies were never updated, so
 * a refunded match read as unresolved and its credits could not be claimed.
 * Everything that asks the question now asks it here.
 */
export function isResolved(m: MatchState): boolean {
  return (
    m.settled || m.no_reveal_resolved || m.inconclusive_resolved || m.refunded_before_lock
  );
}

/**
 * Whether this deployment pays claims at all.
 *
 * The contract is the authority, not the network registry: the flag is fixed
 * into the deployment at construction, and a deployment could in principle be
 * put on a network whose capability flag says otherwise. A contract that does
 * not carry the field is a pre-fork contract, which always paid.
 */
export function withdrawalsEnabled(m: MatchState): boolean {
  return m.withdrawals_enabled !== false;
}

export type ClaimGate =
  | { state: "not-settled"; reason: string }
  | { state: "nothing-to-claim"; reason: string }
  | { state: "not-a-party"; reason: string }
  /**
   * Credited, and unclaimable on this deployment. Carries the amount because
   * the balance is still real and still owed; what is missing is any way to
   * move it. Kept separate from "ready" so no caller can offer a button by
   * accident: every claim surface has to name this case to show anything.
   */
  | { state: "withdrawals-disabled"; amount: bigint; reason: string }
  | { state: "ready"; amount: bigint };

/**
 * The sentence shown wherever a credited balance cannot be withdrawn.
 *
 * One constant, because it appears on both claim surfaces and the two drifting
 * apart would read as two different facts about the same deployment.
 */
export const WITHDRAWALS_DISABLED_NOTE =
  "Withdrawals are disabled on this deployment: the network does not execute outbound transfers. Your balance is recorded on-chain.";

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
  if (!isResolved(m)) {
    return {
      state: "not-settled",
      reason: "the match has not resolved yet, so nothing is credited",
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

  // Checked after the balance, so a party with nothing owed still reads
  // "nothing to claim" rather than being told about a restriction that would
  // not have affected them.
  if (!withdrawalsEnabled(m)) {
    return { state: "withdrawals-disabled", amount, reason: WITHDRAWALS_DISABLED_NOTE };
  }

  return { state: "ready", amount };
}

/**
 * The same gate for the protocol sink.
 *
 * The sink is credited when BOTH sides drew an adverse label: those slashed
 * portions go to the sink rather than crossing between two liars. claim()
 * accumulates across roles, so a wallet that is both a party and the sink
 * withdraws both in one call, and this gate only describes the sink part.
 */
export function sinkClaimGate(m: MatchState, wallet: string | null): ClaimGate {
  if (!isResolved(m)) {
    return { state: "not-settled", reason: "nothing is credited until the match resolves" };
  }
  if (!wallet) return { state: "not-a-party", reason: "connect a wallet to check the sink balance" };
  if (m.sink_address.toLowerCase() !== wallet.toLowerCase()) {
    return { state: "not-a-party", reason: "this wallet is not the protocol sink" };
  }
  if (m.sink_claimable === 0n) {
    return { state: "nothing-to-claim", reason: "the sink has no balance in this match" };
  }
  if (!withdrawalsEnabled(m)) {
    return {
      state: "withdrawals-disabled",
      amount: m.sink_claimable,
      reason: WITHDRAWALS_DISABLED_NOTE,
    };
  }
  return { state: "ready", amount: m.sink_claimable };
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
  onSubmitted?: (hash: `0x${string}`) => void,
): Promise<{ hash: `0x${string}`; status: TransactionStatus }> {
  const client = writeClient(wallet);
  let hash: Awaited<ReturnType<typeof client.writeContract>>;
  try {
    const fees = await quoteFees(client, {
      address: CARNAGE_ADDRESS,
      functionName: "claim",
      args: [Number(matchId)],
      value: 0n,
    });
    hash = await client.writeContract(
      withFees(
        {
          address: CARNAGE_ADDRESS,
          functionName: "claim",
          args: [Number(matchId)],
          value: 0n,
        },
        fees,
      ),
    );
  } catch (err) {
    throw tagStage(err, "submit");
  }

  // Same reason as actions.send: the hash has to be recorded between the
  // broadcast and the wait, not after it.
  onSubmitted?.(hash);

  // Tagged the same way as actions.send: once the claim is broadcast, a failure
  // to see the receipt is not a failed claim, and the button must not come back
  // until contract state says the balance was actually zeroed.
  let receipt: Awaited<ReturnType<typeof client.waitForTransactionReceipt>>;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      interval: 4000,
      retries: 60,
    });
  } catch (err) {
    throw tagStage(err, "confirm");
  }
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
