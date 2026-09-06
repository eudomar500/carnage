import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable } from "genlayer-js/types";
import { CARNAGE_ADDRESS, readClient, simulationClient, toCalldataAddress, writeClient } from "./client";
import { getMatch } from "./contract";
import type { Role } from "./roles";
import { decodeGenvmError } from "./errors";

export { decodeGenvmError };

export type SendResult = {
  hash: `0x${string}`;
  status: TransactionStatus;
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
    throw new Error(decodeGenvmError(err));
  }
}

export async function send(account: `0x${string}`, spec: CallSpec): Promise<SendResult> {
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
    // Preserve the wallet's own rejection code so the UI can say "cancelled".
    const wrapped = new Error(decodeGenvmError(err));
    (wrapped as any).code = (err as any)?.code;
    throw wrapped;
  }

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    interval: 4000,
    retries: 90,
  });
  return { hash, status: receipt.status as TransactionStatus };
}

/** Preflight, then send. */
export async function run(account: `0x${string}`, spec: CallSpec): Promise<SendResult> {
  await preflight(account, spec);
  return send(account, spec);
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
    throw new Error(decodeGenvmError(err));
  }

  const result = await send(account, { functionName: "create_match", args });

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

/**
 * Hashes through the contract's own compute_commitment view rather than
 * reimplementing keccak locally, so the value committed is byte-identical to
 * what reveal will recompute. It is a free read.
 */
export async function computeCommitment(
  matchId: bigint,
  state: bigint,
  salt: `0x${string}`,
  agent: string,
): Promise<string> {
  const out = await readClient().readContract({
    address: CARNAGE_ADDRESS,
    functionName: "compute_commitment",
    args: [state, salt, matchId, toCalldataAddress(agent)],
  });
  return String(out);
}

export async function commit(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  commitment: string,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "commit_holder" : "commit_buyer",
    args: [matchId, commitment],
  });
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
): Promise<SendResult> {
  const functionName = role === "holder" ? "fund_holder" : "fund_buyer";
  try {
    await preflight(account, { functionName, args: [matchId] });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes(FUND_VALUE_GUARD)) throw err;
  }
  return send(account, { functionName, args: [matchId], value: stakeWei });
}

// ---- anchor claim ---------------------------------------------------------

export async function anchorClaim(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  claim: string,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "anchor_claim_holder" : "anchor_claim_buyer",
    args: [matchId, claim],
  });
}

// ---- deal price -----------------------------------------------------------

export async function proposePrice(
  account: `0x${string}`,
  matchId: bigint,
  role: Role,
  price: bigint,
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "propose_price_holder" : "propose_price_buyer",
    args: [matchId, price],
  });
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
): Promise<SendResult> {
  return run(account, {
    functionName: role === "holder" ? "reveal_holder" : "reveal_buyer",
    args: [matchId, state, salt],
  });
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
): Promise<SendResult> {
  return send(account, { functionName: "adjudicate", args: [matchId] });
}
