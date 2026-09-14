import { capabilities, type ChainClient } from "./client";

/**
 * The fee deposit a write has to carry on consensus v0.6.
 *
 * Bradbury takes no deposit and this module does nothing there. Studio Next
 * refuses a write without one: a zero deposit reverts at the consensus
 * contract with FeeValueMustBeNonZero(1) before the contract is ever entered.
 *
 * Three fields matter and all three come back from one SDK call. The shape is
 * the network's, not ours, so nothing here is recomputed, rounded or
 * defaulted -- distribution, feeValue and messageAllocations are forwarded
 * exactly as the estimator returned them:
 *
 *   distribution        the per-role time-unit and budget caps.
 *   feeValue            the deposit, in wei. Mostly refunded on finalization.
 *   messageAllocations  the allocation tree for any message the call emits.
 *                       Present only when the call emits one; adjudicate does,
 *                       because it schedules settle with emit(on="finalized").
 *
 * Dropping messageAllocations is not a fee optimisation, it is a failure: the
 * write is accepted, runs, and rolls back with
 * "Mode1MessageFeesRequireGenVMPerEmissionSupport: fee-bearing GenVM messages
 * require a message allocation tree". That was reproduced directly against
 * adjudicate on this contract, so it is forwarded whenever the estimator
 * produces it, and omitted when it does not rather than sent as an empty list.
 */

export type FeeSpec = {
  address: `0x${string}`;
  functionName: string;
  args: unknown[];
  value?: bigint;
};

/** What writeContract accepts under `fees`. Absent on a network without fees. */
export type FeeFields = {
  distribution: unknown;
  feeValue: unknown;
  messageAllocations?: unknown;
};

/**
 * Quotes the deposit for one write, or returns undefined where fees do not apply.
 *
 * Undefined rather than an empty object on purpose: passing `fees: {}` to the
 * 1.2 SDK would be an unknown argument, and passing it to 2.0 would send a
 * write with no deposit, which is the exact failure this exists to avoid.
 */
export async function quoteFees(
  client: ChainClient,
  spec: FeeSpec,
): Promise<FeeFields | undefined> {
  if (!capabilities().feesOnWrite) return undefined;

  const estimate = client.estimateTransactionFeesForWrite;
  if (typeof estimate !== "function") {
    // A network is declared as charging fees but its SDK cannot quote them.
    // Sending anyway would revert on-chain and cost the reader a wallet
    // confirmation to find that out, so refuse here with something readable.
    throw new Error("this network requires transaction fees but the SDK cannot estimate them");
  }

  const quoted: any = await estimate.call(client, {
    address: spec.address,
    functionName: spec.functionName,
    args: spec.args,
    value: spec.value ?? 0n,
  });

  return feeFieldsOf(quoted);
}

/**
 * Narrows an estimator result to the three fields a write carries.
 *
 * Split out so it can be tested without a network, and so the rule that
 * messageAllocations is forwarded only when non-empty lives in one place.
 */
export function feeFieldsOf(quoted: any): FeeFields {
  const fees: FeeFields = {
    distribution: quoted?.distribution,
    feeValue: quoted?.feeValue,
  };
  if (Array.isArray(quoted?.messageAllocations) && quoted.messageAllocations.length > 0) {
    fees.messageAllocations = quoted.messageAllocations;
  }
  return fees;
}

/**
 * Spreads the quote into a writeContract argument object.
 *
 * `fees` is omitted entirely when undefined, so the 1.2 call site is byte for
 * byte the call it always made and Bradbury sees no new argument.
 */
export function withFees<T extends object>(args: T, fees: FeeFields | undefined): T {
  return fees ? ({ ...args, fees } as T) : args;
}
