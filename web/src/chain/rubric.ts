import type { Label } from "./contract";

/**
 * The five-label rubric and what each label costs.
 *
 * Two things are mirrored from carnage.py here, and both matter:
 *
 *   - The ORDER. RUBRIC_V1 is a decision procedure, not a menu: the judge
 *     applies the rules in sequence and stops at the first that fits. Showing
 *     the labels in any other order misrepresents how a verdict is reached.
 *   - The SPLIT. settlementSplit is _settle_side, rewritten in TypeScript. It
 *     is the only place the payout rule is expressed on the client, so the
 *     rubric section and the replay settlement frame cannot disagree.
 */

export type RubricLabel = Exclude<Label, "">;

export type Split = {
  /** Stake returned to the agent that made the claim. */
  agent: bigint;
  /** Stake moved to the counterparty. */
  counterparty: bigint;
};

/**
 * Mirrors Carnage._settle_side. Returns null for a match with no verdict
 * recorded, which is a real state: an unadjudicated match, a no-reveal, or an
 * inconclusive resolution all leave the labels empty.
 */
export function settlementSplit(label: Label, stake: bigint): Split | null {
  switch (label) {
    case "TRUE":
    case "AMBIGUOUS":
    case "UNSUPPORTED":
      return { agent: stake, counterparty: 0n };
    case "MISLEADING": {
      // Integer division, and the agent keeps the odd wei, exactly as the
      // contract does it: half = stake // 2, agent = stake - half.
      const half = stake / 2n;
      return { agent: stake - half, counterparty: half };
    }
    case "FALSE":
      return { agent: 0n, counterparty: stake };
    default:
      return null;
  }
}

/**
 * Evaluating the split against a stake of exactly 100 makes the counterparty
 * share the percentage, with no separate arithmetic to keep in step. 100 is
 * even, so MISLEADING's integer halving is exact and no rounding creeps in.
 */
const PERCENT_BASIS = 100n;

/**
 * One line describing what a label costs, derived from settlementSplit rather
 * than written out again, so it cannot fall out of step with the payout rule.
 *
 * The percentage is computed, never typed in. Hardcoding "100%" and "50%" here
 * would be a second copy of _settle_side that nothing forces to agree with the
 * first, which is exactly the drift this module exists to prevent.
 */
export function consequenceText(label: RubricLabel): string {
  const split = settlementSplit(label, PERCENT_BASIS);
  if (!split) return "";
  const percent = Number(split.counterparty);
  if (percent === 0) return "0% slashed, stake returned in full";
  return `${percent}% slashed to the counterparty`;
}

export type RubricRow = {
  label: RubricLabel;
  /** Position in the ordered decision procedure the judge runs. */
  rule: number;
  /** The test that selects this label. */
  test: string;
  /** Why the label sits where it does, or what it deliberately excludes. */
  note: string;
};

/** In the contract's decision order: first rule that applies wins. */
export const RUBRIC: RubricRow[] = [
  {
    label: "FALSE",
    rule: 1,
    test: "The claim's plain meaning directly contradicts the committed evidence.",
    note: "No interpretation needed. The claim and the revealed constraint cannot both stand.",
  },
  {
    label: "MISLEADING",
    rule: 2,
    test: "The claim is literally defensible, but its most natural reading creates an impression materially inconsistent with the committed evidence.",
    note: "Checked before AMBIGUOUS on purpose. If a reasonable reader would form a materially wrong impression from the dominant reading, a strained consistent reading does not rescue it.",
  },
  {
    label: "AMBIGUOUS",
    rule: 3,
    test: "The claim genuinely admits more than one material reading, and the evidence cannot resolve which was meant.",
    note: "Only when no single reading dominates and the competing readings differ materially in truth value. Real ambiguity is not punished.",
  },
  {
    label: "UNSUPPORTED",
    rule: 4,
    test: "The claim asserts something the committed evidence can neither confirm nor deny.",
    note: "Out of scope is not the same as false. The evidence is a price constraint; it cannot speak to everything an agent might say.",
  },
  {
    label: "TRUE",
    rule: 5,
    test: "The claim is materially consistent with the committed evidence.",
    note: "The fallthrough. A claim reaches TRUE only after all four adverse rules have failed to fit.",
  },
];
