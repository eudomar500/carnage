/**
 * Where the app is, derived from the URL and nothing else.
 *
 * Carnage is two things sharing one bundle: a presentation page that reads
 * nothing from the chain, and the functional match view. Keeping that split in
 * one Route value means every navigation is a single state change with a URL
 * that reproduces it, rather than a set of booleans that can disagree.
 *
 * Query parameters, not paths. This ships as a static build with no server
 * rewrite, so /app would 404 on a direct load or a refresh. ?app=1 works
 * anywhere the index does.
 */
export type Route =
  | { view: "landing" }
  | { view: "post"; slug: string }
  | { view: "lab" }
  | { view: "app"; matchId: number | null };

export function routeFromUrl(): Route {
  const q = new URLSearchParams(location.search);

  // Which slugs exist is content, not routing. The router resolves the slug
  // and falls back to the landing when it names nothing.
  const slug = q.get("post");
  if (slug) return { view: "post", slug };

  // The lab is its own page rather than a landing section: it reads the whole
  // contract and has nothing to do with the pitch above it.
  if (q.has("lab")) return { view: "lab" };

  const raw = q.get("match");
  if (raw !== null) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return { view: "app", matchId: n };
    // A malformed id still says "the app": land on the open-by-id form rather
    // than bouncing a typo out to the presentation page.
    return { view: "app", matchId: null };
  }

  if (q.has("app")) return { view: "app", matchId: null };
  return { view: "landing" };
}

/**
 * The URL for a route, as a real href.
 *
 * Every navigation control carries one so links stay copyable and open in a
 * new tab correctly; the click handler only takes over the in-page case.
 * Unrelated parameters (?preview= in a dev build) are preserved.
 */
export function hrefFor(route: Route, hash?: string): string {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.delete("match");
  url.searchParams.delete("app");
  url.searchParams.delete("post");
  url.searchParams.delete("lab");

  if (route.view === "post") {
    url.searchParams.set("post", route.slug);
  } else if (route.view === "lab") {
    url.searchParams.set("lab", "1");
  } else if (route.view === "app") {
    if (route.matchId === null) url.searchParams.set("app", "1");
    else url.searchParams.set("match", String(route.matchId));
  }

  return `${url.pathname}${url.search}${hash ? `#${hash}` : ""}`;
}
