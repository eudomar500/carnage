/**
 * What the replay's settlement frame says about the figures under it.
 *
 * Kept out of Replay.tsx because that module exports a component and nothing
 * else, and kept out of the frame builder because both branches have to be
 * readable on their own.
 *
 * The unclaimed column only falls to zero where claim() can move money. On a
 * deployment with withdrawals disabled the call reverts before it reads a
 * balance, so the original caption promised a drain that cannot happen, next
 * to a figure that will never change. The award arithmetic is the same on
 * both: it is recomputed from the recorded outcome either way.
 */
export function settlementCaption(withdrawals: boolean): string {
  return withdrawals
    ? "Awards are recomputed from the recorded outcome using the contract's own rule, so they stay correct after each side withdraws. The unclaimed figures are live and fall to zero as claim() is called."
    : "Awards are recomputed from the recorded outcome using the contract's own rule, so they stay correct whatever the ledger reads. Withdrawals are disabled on this deployment, so the unclaimed figures are what settlement credited and claim() cannot move them.";
}
