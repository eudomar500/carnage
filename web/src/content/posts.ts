import type { ComponentType } from "react";
import ClaimBanner from "../components/ClaimBanner";
import MatchFlowBanner from "../components/MatchFlowBanner";
import HowCarnageWorks from "./posts/how-carnage-works";
import StressTestForTheJudge from "./posts/stress-test-for-the-judge";

export type Post = {
  /** URL slug. Plain ASCII, kebab case, stable once published. */
  slug: string;
  title: string;
  /** ISO yyyy-mm-dd. The real publication date, never taken from the clock. */
  date: string;
  /** Who wrote it. Rendered under the date; these are signed opinion pieces. */
  author: string;
  /** One line, shown in the list on the landing. */
  summary: string;
  Banner?: ComponentType;
  Body: ComponentType;
};

/**
 * Every published article, newest first.
 *
 * Adding one is an import plus an entry here; the prose lives in its own
 * module under posts/, which exports nothing but the article itself.
 * Unpublished drafts are simply absent rather than hidden behind a flag, so
 * there is nothing to forget to flip and nothing half-rendered on the page.
 */
export const POSTS: Post[] = [
  {
    slug: "how-carnage-works",
    title: "How Carnage works, in plain language",
    date: "2026-09-08",
    author: "zkVan",
    summary:
      "A plain-language walkthrough of a full match: seal a secret, write your claim, and watch the GEN follow the verdict.",
    Banner: MatchFlowBanner,
    Body: HowCarnageWorks,
  },
  {
    slug: "stress-test-for-the-judge",
    title: "Why the agent economy needs a stress test for its judge",
    date: "2026-09-07",
    author: "zkVan",
    summary:
      "A claim on match 2 told the jury to ignore its instructions and rule TRUE. The jury returned FALSE, slashed the full stake to the honest side, and left the whole exchange on the block explorer.",
    Banner: ClaimBanner,
    Body: StressTestForTheJudge,
  },
].sort((a, b) => b.date.localeCompare(a.date));

export function findPost(slug: string): Post | null {
  return POSTS.find((p) => p.slug === slug) ?? null;
}

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/**
 * Formats an ISO date for display.
 *
 * Splits the string rather than going through Date. Parsing "2026-09-07" gives
 * midnight UTC, which renders as the previous day for anyone west of it, and a
 * publication date that shifts with the reader's timezone is just wrong.
 */
export function formatPostDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!name || !year || !day) return iso;
  return `${name} ${Number(day)}, ${year}`;
}
