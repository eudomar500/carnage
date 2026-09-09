import { readClient } from "./client";

/**
 * Whether a transaction can still produce the state change it was sent for.
 *
 * A GenLayer transaction carries two independent outcomes and they are easy to
 * confuse, including on the explorer:
 *
 *   status  the lifecycle. FINALIZED means the consensus process for this
 *           transaction is over and can never change again. It says nothing
 *           about whether anything was written.
 *   result  the acceptance. AGREE means the execution was accepted and its
 *           storage writes committed. TIMEOUT, DISAGREE and the no-majority
 *           results mean the round failed and the whole execution, storage
 *           writes included, was thrown away.
 *
 * The two can disagree. Match 3's first adjudicate is the worked example:
 * status FINALIZED, result TIMEOUT, execution FINISHED_WITH_RETURN. The GenVM
 * ran, produced both labels and a full storage_changes blob, and consensus
 * then discarded the round after six rounds of leader timeouts. The verdict
 * exists in the transaction and has never existed in contract state.
 *
 * So a UI that watches the transaction sees success and a UI that watches
 * get_match sees nothing, which is exactly the trap this app already avoids by
 * confirming against state. What was missing is the other half: knowing when to
 * stop waiting. Once the transaction is terminal and the postcondition is still
 * false, no amount of further polling will change that, and the step has to
 * reopen instead of sitting on a dead attempt.
 */
export type TxVerdict = {
  /** No further consensus round can change what this transaction did. */
  terminal: boolean;
  /** Terminal, and consensus refused the round, so nothing was written. */
  discarded: boolean;
  statusName: string;
  resultName: string;
};

/**
 * Only these two end the story.
 *
 * UNDETERMINED, VALIDATORS_TIMEOUT and LEADER_TIMEOUT are deliberately absent:
 * a transaction sitting in one of those can still be appealed or rolled into a
 * further round, so treating it as dead would reopen a step underneath a
 * transaction that is still alive. That is the mistake worth avoiding, so the
 * check errs towards waiting.
 */
const TERMINAL = new Set(["FINALIZED", "CANCELED"]);

/** Results that mean the execution's writes were committed. */
const APPLIED = new Set(["AGREE", "MAJORITY_AGREE"]);

/**
 * Cancelled means the transaction never ran, so nothing was written whatever
 * the result field happens to hold. Checked separately rather than folded into
 * the result test, which only speaks for transactions that reached consensus.
 */
const CANCELED = "CANCELED";

/** Never throws: a read failure is not evidence about the transaction. */
export async function readTxVerdict(hash: string): Promise<TxVerdict | null> {
  try {
    const tx = (await (readClient() as any).getTransaction({ hash })) as any;
    const statusName = String(tx?.statusName ?? "");
    if (!statusName) return null;
    const resultName = String(tx?.resultName ?? "");
    const terminal = TERMINAL.has(statusName);
    const discarded =
      terminal && (statusName === CANCELED || !APPLIED.has(resultName));
    return { terminal, discarded, statusName, resultName };
  } catch {
    return null;
  }
}
