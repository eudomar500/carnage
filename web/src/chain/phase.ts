import { isDishonest, type MatchState } from "./contract";

export type Phase =
  | "COMMIT"
  | "FUND"
  | "NEGOTIATE"
  | "ANCHOR"
  | "REVEAL"
  | "JUDGE"
  | "SETTLE";

/** The six beats shown in the horizontal step diagram. */
export const STEPS = ["COMMIT", "NEGOTIATE", "ANCHOR", "REVEAL", "JUDGE", "SETTLE"] as const;

/** How the judge reacts once settlement lands. */
export type SettleMood =
  | "none"        // not settled yet
  | "calm"        // every claim held up: no strike
  | "strike-holder"
  | "strike-buyer"
  | "strike-both"; // both lied

export type MatchPhase = {
  phase: Phase;
  /** Index into STEPS for the diagram highlight. */
  stepIndex: number;
  mood: SettleMood;
  /** Terminal resolution that bypassed adjudication entirely. */
  terminal: "none" | "no-reveal" | "inconclusive" | "refunded";
  statusLabel: string;
};

export function derivePhase(m: MatchState): MatchPhase {
  // refunded_before_lock is the third way a match ends without a verdict:
  // it funded, never agreed a price, and the stakes went back. Without this
  // branch such a match reads as though it were still negotiating.
  const terminal = m.no_reveal_resolved
    ? "no-reveal"
    : m.inconclusive_resolved
      ? "inconclusive"
      : m.refunded_before_lock
        ? "refunded"
        : "none";

  if (terminal !== "none") {
    return {
      phase: "SETTLE",
      stepIndex: 5,
      // Neither path is a verdict, so the judge does not strike.
      mood: "calm",
      terminal,
      statusLabel:
        terminal === "no-reveal"
          ? "NO-REVEAL RESOLVED"
          : terminal === "refunded"
            ? "REFUNDED"
            : "INCONCLUSIVE",
    };
  }

  if (m.settled) {
    const holderLied = isDishonest(m.holder_label);
    const buyerLied = isDishonest(m.buyer_label);
    const mood: SettleMood =
      holderLied && buyerLied
        ? "strike-both"
        : holderLied
          ? "strike-holder"
          : buyerLied
            ? "strike-buyer"
            : "calm";
    return { phase: "SETTLE", stepIndex: 5, mood, terminal, statusLabel: "SETTLED" };
  }

  if (m.adjudicated) {
    return { phase: "JUDGE", stepIndex: 4, mood: "none", terminal, statusLabel: "AWAITING SETTLEMENT" };
  }
  if (m.holder_revealed && m.buyer_revealed) {
    return { phase: "JUDGE", stepIndex: 4, mood: "none", terminal, statusLabel: "IN ADJUDICATION" };
  }
  if (m.price_locked) {
    return { phase: "REVEAL", stepIndex: 3, mood: "none", terminal, statusLabel: "REVEALING" };
  }
  if (m.holder_claimed && m.buyer_claimed) {
    return { phase: "ANCHOR", stepIndex: 2, mood: "none", terminal, statusLabel: "PRICE LOCK PENDING" };
  }
  if (m.holder_funded && m.buyer_funded) {
    return { phase: "NEGOTIATE", stepIndex: 1, mood: "none", terminal, statusLabel: "NEGOTIATING" };
  }
  if (m.holder_committed && m.buyer_committed) {
    return { phase: "FUND", stepIndex: 0, mood: "none", terminal, statusLabel: "FUNDING" };
  }
  return { phase: "COMMIT", stepIndex: 0, mood: "none", terminal, statusLabel: "COMMITTING" };
}

/**
 * Judge animation state. Calm through commit/negotiate, alert on reveal,
 * intense on judge, and a strike (or deliberate calm) once settled.
 */
export type JudgeMood =
  | "calm"
  | "alert"
  | "intense"
  | "strike-holder"
  | "strike-buyer"
  | "strike-both"
  | "verdict-calm";

/** True for any mood where the judge actually lunges. */
export function isStrike(mood: JudgeMood): boolean {
  return mood.startsWith("strike");
}

export function judgeMood(p: MatchPhase): JudgeMood {
  switch (p.phase) {
    case "COMMIT":
    case "FUND":
    case "NEGOTIATE":
    case "ANCHOR":
      return "calm";
    case "REVEAL":
      return "alert";
    case "JUDGE":
      return "intense";
    case "SETTLE":
      // The lunge is directional: it carries WHICH side drew the adverse
      // label through to the animation, rather than collapsing to one strike.
      switch (p.mood) {
        case "strike-holder": return "strike-holder";
        case "strike-buyer":  return "strike-buyer";
        case "strike-both":   return "strike-both";
        default:              return "verdict-calm";
      }
  }
}
