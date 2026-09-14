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
import { DEFAULT_NETWORK_ID, NET_PARAM, networkFromSearch, type NetworkId } from "../chain/networks";

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
 * Keeps ?net= only while it is saying something.
 *
 * It is preserved like any other unrelated parameter so a link copied out of
 * a Studio Next session still opens on Studio Next. It is dropped when it
 * names the default, because bradbury is what a bare URL already means and
 * carrying it on every href would put a redundant parameter on every link in
 * the app. An unrecognised value is dropped for the same reason the resolver
 * ignores it: it selects nothing, so it should not travel.
 */
function normaliseNetParam(params: URLSearchParams): void {
  if (!params.has(NET_PARAM)) return;
  const named = networkFromSearch(params.toString());
  if (named === null || named === DEFAULT_NETWORK_ID) params.delete(NET_PARAM);
}

/**
 * The URL for a route, as a real href.
 *
 * Every navigation control carries one so links stay copyable and open in a
 * new tab correctly; the click handler only takes over the in-page case.
 * Unrelated parameters (?preview= in a dev build, ?net= on a non-default
 * network) are preserved.
 */
export function hrefFor(route: Route, hash?: string): string {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.delete("match");
  url.searchParams.delete("app");
  url.searchParams.delete("post");
  url.searchParams.delete("lab");
  normaliseNetParam(url.searchParams);

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

/**
 * Where to land after switching network.
 *
 * The same view on the other chain, with two deliberate changes.
 *
 * The match id goes. Ids are per contract: match 3 on Bradbury and match 3 on
 * Studio Next are unrelated matches, and carrying the number across would open
 * whatever happens to hold that id on the other deployment, or a "no such
 * match" for a match the reader was just looking at. The open-by-id form is
 * the honest landing place.
 *
 * The network is pinned into the URL rather than left to storage. The load
 * that follows resolves ?net= ahead of the stored choice, so a URL that still
 * carried the old ?net= would quietly undo the switch. Setting it keeps the
 * address bar and the active network the same statement, and it is removed
 * outright for the default, where a bare URL already says the same thing.
 */
export function switchHref(id: NetworkId): string {
  const current = routeFromUrl();
  const target: Route = current.view === "app" ? { view: "app", matchId: null } : current;

  const url = new URL(hrefFor(target), location.href);
  if (id === DEFAULT_NETWORK_ID) url.searchParams.delete(NET_PARAM);
  else url.searchParams.set(NET_PARAM, id);

  return `${url.pathname}${url.search}`;
}
