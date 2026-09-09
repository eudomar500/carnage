import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable } from "genlayer-js/types";
import type { Stage } from "./errors";
import { concat, hexToBytes, keccak256, numberToBytes } from "viem";
import { CARNAGE_ADDRESS, simulationClient, toCalldataAddress, writeClient } from "./client";
import { getMatch } from "./contract";
import type { Role } from "./roles";
import { decodeGenvmError, tagStage } from "./errors";

export { decodeGenvmError };

/**
 * How long `send` waits for ACCEPTED, as interval x retries.
 *
 * Exported because the recovery layer has to know it: an attempt recorded
 * before a page reload may still be inside this budget, and offering a retry
 * while the original transaction is still being accepted is how a match gets
 * the same call twice.
 */
export const ACCEPT_WAIT_MS = 4000 * 90;

export type SendResult = {
  hash: `0x${string}`;
  status: TransactionStatus;
};

/**
 * A window onto a send while it is still happening.
 *
 * `send` does not return until the transaction has been accepted, which on
 * this chain can be minutes. The hash exists long before that, and the attempt
 * journal needs it at the moment it exists rather than at the moment the wait
 * ends: an attempt that is never going to return is exactly the one whose hash
 * the user has to be able to look up.
 */
export type SendHooks = {
  /** Fired once the wallet has broadcast, before the receipt wait begins. */
  onSubmitted?: (hash: `0x${string}`) => void;
};

type CallSpec = {
  functionName: string;
  args: CalldataEncodable[];
  value?: bigint;
};

/**
 * Every write goes through the same two stages.
 *
 * `simulateWriteContract` executes the call against live state with the
 * connected wallet as gl.message.sender_address, so an unmet precondition or
 * a wrong-role sender is caught for free, before the wallet is ever opened.
 * Only a clean simulation is sent for real.
 */
export async function preflight(account: `0x${string}`, spec: CallSpec): Promise<void> {
  try {
    await simulationClient(account).simulateWriteContract({
      address: CARNAGE_ADDRESS,
      functionName: spec.functionName,
      args: spec.args,
    });
  } catch (err) {
    throw rethrow(err, "preflight");
  }
}

/**
 * Rewraps a provider error into one readable line without losing the two
 * things the recovery layer routes on: the wallet's own error code, and how
 * far the call got before it threw.
 */
function rethrow(err: unknown, stage: Stage): Error {
  const wrapped = new Error(decodeGenvmError(err));
  (wrapped as any).code = (err as any)?.code;
  (wrapped as any).cause = err;
  return tagStage(wrapped, stage);
}

/**
 * Submits and waits for acceptance.
 *
 * The two failure points are tagged apart deliberately. A `writeContract`
 * throw means nothing reached the network and the step is safe to re-enable.
 * A throw while waiting for the receipt means the transaction IS on the
 * network and its outcome is simply unknown, so the caller must confirm
 * against contract state before offering a retry. Collapsing the two is how a
 * button gets re-enabled under a transaction that is still in flight.
 */
export async function send(
  account: `0x${string}`,
  spec: CallSpec,
  hooks?: SendHooks,
): Promise<SendResult> {
  const client = writeClient(account);
  let hash: Awaited<ReturnType<typeof client.writeContract>>;
  try {
    hash = await client.writeContract({
      address: CARNAGE_ADDRESS,
      functionName: spec.functionName,
      args: spec.args,
      value: spec.value ?? 0n,
    });
  } catch (err) {
    throw rethrow(err, "submit");
  }

  // Recorded here, between broadcast and the wait, because everything after
  // this point can take minutes or never finish at all.
  hooks?.onSubmitted?.(hash);

  try {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      interval: 4000,
      retries: ACCEPT_WAIT_MS / 4000,
    });
    return { hash, status: receipt.status as TransactionStatus };
  } catch (err) {
    throw rethrow(err, "confirm");
  }
}

/** Preflight, then send. */
export async function run(
  account: `0x${string}`,
  spec: CallSpec,
  hooks?: SendHooks,
): Promise<SendResult> {
  await preflight(account, spec);
  return send(account, spec, hooks);
}

// ---- create ---------------------------------------------------------------

export type CreateMatchInput = {
  holder: string;
  buyer: string;
  priceFloor: bigint;
  priceCeil: bigint;
  stakeWei: bigint;
  revealDeadline: string;
  inconclusiveDeadline: string;
};

function createArgs(i: CreateMatchInput): CalldataEncodable[] {
  return [
    toCalldataAddress(i.holder),
    toCalldataAddress(i.buyer),
    i.priceFloor,
    i.priceCeil,
    i.stakeWei,
    i.revealDeadline,
    i.inconclusiveDeadline,
  ];
}

/**
 * create_match is permissionless: anyone may open a match between two
 * agents. The simulation tells us which id the contract would mint, and we
 * confirm it against live state afterwards rather than trusting the guess,
 * since a concurrent creation could take that id first.
 */
export async function createMatch(
  account: `0x${string}`,
  input: CreateMatchInput,
  hooks?: SendHooks,
): Promise<{ matchId: bigint } & SendResult> {
  const args = createArgs(input);

  let predicted: bigint;
  try {
    const sim = await simulationClient(account).simulateWriteContract({
      address: CARNAGE_ADDRESS,
      functionName: "create_match",
      args,
    });
    predicted = BigInt(sim as any);
  } catch (err) {
    throw rethrow(err, "preflight");
  }

  const result = await send(account, { functionName: "create_match", args }, hooks);

  // Confirm which id actually landed: scan forward from the prediction.
  for (let id = predicted; id < predicted + 8n; id++) {
    try {
      const m = await getMatch(id);
      if (
        m.holder.toLowerCase() === input.holder.toLowerCase() &&
        m.buyer.toLowerCase() === input.buyer.toLowerCase() &&
        m.stake_amount === input.stakeWei &&
        !m.holder_committed &&
        !m.buyer_committed
      ) {
        return { matchId: id, ...result };
      }
    } catch {
      break;
    }
  }
  return { matchId: predicted, ...result };
}

// ---- commit ---------------------------------------------------------------

const MIN_SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;
const ADDRESS_BYTES = 20;

/**
 * Builds the commitment hash in the browser.
 *
 * This used to call the contract's compute_commitment view, which meant the
 * live (state, salt) pair travelled to whichever node served the read, before
 * the commitment was anywhere on-chain. That hands the node the one secret
 * the commit is supposed to hide. The contract documents that view as
 * verification-only for exactly this reason, so the hash is built here and
 * nothing about the secret leaves the browser until the reveal.
 *
 * The preimage mirrors compute_commitment in contracts/carnage.py byte for
 * byte: state as 32 bytes big-endian, then the raw salt bytes, then match_id
 * as 32 bytes big-endian, then the agent's 20 address bytes, keccak256 over
 * the whole buffer. The salt bounds mirror _decode_salt so a salt the
 * contract would reject fails here rather than at reveal time.
 */
export function computeCommitment(
  matchId: bigint,
  state: bigint,
  salt: `0x${string}`,
  agent: string,
): `0x${string}` {
  if (!salt.startsWith("0x")) throw new Error("salt must be 0x-prefixed hex");
  const saltBytes = hexToBytes(salt);
  if (saltBytes.length < MIN_SALT_BYTES) {
    throw new Error(`salt must be at least ${MIN_SALT_BYTES} bytes`);
  }
  if (saltBytes.length > MAX_SALT_BYTES) {
    throw new Error(`salt must be at most ${MAX_SALT_BYTES} bytes`);
  }

  const agentHex = (agent.startsWith("0x") ? agent : `0x${agent}`) as `0x${string}`;
  const agentBytes = hexToBytes(agentHex);
  if (agentBytes.length !== ADDRESS_BYTES) {
    throw new Error("agent must be a 20 byte address");
  }

  return keccak256(
    concat([
      numberToBytes(state, { size: 32 }),
      saltBytes,
      numberToBytes(matchId, { size: 32 }),
      agentBytes,
    ]),
  );
}

export async function commit(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  commitment: string,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "commit_holder" : "commit_buyer",
    args: [matchId, commitment],
  }, hooks);
}

// ---- fund -----------------------------------------------------------------

/**
 * fund_* is payable, and simulateWriteContract cannot carry a value, so a
 * simulation always trips the final `value != stake_amount` guard.
 *
 * That guard is the LAST check in the contract's fund_*: sender, both-committed
 * and not-already-funded are all verified before it. So reaching exactly that
 * error means every other precondition passed, and we treat it as a pass.
 */
const FUND_VALUE_GUARD = "must fund exactly stake_amount";

export async function fund(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  stakeWei: bigint,
  hooks?: SendHooks,
): Promise<SendResult> {
  const functionName = role === "holder" ? "fund_holder" : "fund_buyer";
  try {
    await preflight(account, { functionName, args: [matchId] });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes(FUND_VALUE_GUARD)) throw err;
  }
  return send(account, { functionName, args: [matchId], value: stakeWei }, hooks);
}

// ---- anchor claim ---------------------------------------------------------

export async function anchorClaim(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  claim: string,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "anchor_claim_holder" : "anchor_claim_buyer",
    args: [matchId, claim],
  }, hooks);
}

// ---- deal price -----------------------------------------------------------

export async function proposePrice(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  price: bigint,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "propose_price_holder" : "propose_price_buyer",
    args: [matchId, price],
  }, hooks);
}

// ---- reveal ---------------------------------------------------------------

/**
 * Reveals (state, salt). The preflight inside `run` is what makes a wrong
 * state cheap: the contract recomputes the commitment and rejects a mismatch
 * during simulation, so nothing is signed or spent until it lines up.
 */
export async function reveal(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  state: bigint,
  salt: `0x${string}`,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "reveal_holder" : "reveal_buyer",
    args: [matchId, state, salt],
  }, hooks);
}

/** Gasless check that (state, salt) will satisfy the stored commitment. */
export async function checkReveal(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  state: bigint,
  salt: `0x${string}`,
): Promise<void> {
  await preflight(account, {
    functionName: role === "holder" ? "reveal_holder" : "reveal_buyer",
    args: [matchId, state, salt],
  });
}

// ---- adjudicate -----------------------------------------------------------

/**
 * Permissionless. Deliberately NOT preflighted: adjudicate runs the LLM jury
 * through gl.vm.run_nondet, so simulating it would burn a full nondeterministic
 * round before the real transaction repeats it. The console only offers this
 * once both sides have revealed and the match is unadjudicated.
 */
export async function adjudicate(
  account: `0x${string}`,
  matchId: bigint,
  hooks?: SendHooks,
): Promise<SendResult> {
  return send(account, { functionName: "adjudicate", args: [matchId] }, hooks);
}

// ---- recovery -------------------------------------------------------------

/**
 * Permissionless exit for a match that funded but never agreed a price.
 *
 * Preflighted like every other deterministic write, so the contract's own
 * deadline and terminal-flag guards are what decide, not the clock in this
 * browser. Returns each side exactly what it funded: no slash, nothing to the
 * sink.
 */
export async function refundBeforeLock(
  account: `0x${string}`,
  matchId: bigint,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, { functionName: "refund_before_lock", args: [matchId] }, hooks);
}

/**
 * Permissionless fallback for a verdict that never got paid out.
 *
 * settle() only runs as the finalized self-call adjudicate() schedules. If
 * that message never arrives the labels sit on the match with nothing able to
 * apply them, and this pushes the same settlement through once the grace
 * period has passed.
 *
 * get_match does not expose adjudicated_at, so the UI cannot time the grace
 * period itself. The preflight does it instead: too early and the contract
 * answers "settle grace period has not passed yet", which is surfaced as the
 * failure reason.
 */
export async function forceSettle(
  account: `0x${string}`,
  matchId: bigint,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, { functionName: "force_settle", args: [matchId] }, hooks);
}

/**
 * Step one of the two-step sink handover. Only the current sink may call it,
 * and it does not move the role: the proposed address has to accept.
 *
 * Proposing the zero address is the contract's way of cancelling a pending
 * handover.
 */
export async function proposeSinkAddress(
  account: `0x${string}`,
  newSink: string,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, {
    functionName: "propose_sink_address",
    args: [toCalldataAddress(newSink)],
  }, hooks);
}

/** Step two, sent by the pending sink itself. Takes no arguments. */
export async function acceptSinkAddress(
  account: `0x${string}`,
  hooks?: SendHooks,
): Promise<SendResult> {
  return run(account, { functionName: "accept_sink_address", args: [] }, hooks);
}
