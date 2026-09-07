import type { ComponentType } from "react";
import ClaimBanner from "../components/ClaimBanner";
import StressTestForTheJudge from "./posts/stress-test-for-the-judge";

export type Post = {
  /** URL slug. Plain ASCII, kebab case, stable once published. */
  slug: string;
  title: string;
  /** ISO yyyy-mm-dd. The real publication date, never taken from the clock. */
  date: string;
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
    slug: "stress-test-for-the-judge",
    title: "Why the agent economy needs a stress test for its judge",
    date: "2026-09-07",
    summary:
      "Most systems that use an AI jury only show the happy path. Carnage tests what the judge does when a claim is built to deceive it, and proves the result on-chain.",
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
