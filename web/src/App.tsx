import { useCallback, useEffect, useMemo, useState } from "react";
import LandingPage from "./pages/LandingPage";
import MatchApp from "./pages/MatchApp";
import PostPage from "./pages/PostPage";
import { findPost } from "./content/posts";
import type { NavShell } from "./components/TopNav";
import { connectWallet, disconnectWallet, watchWallet } from "./chain/client";
import { hrefFor, routeFromUrl, type Route } from "./lib/route";
import { previewFromUrl } from "./dev/preview";
import "./styles.css";

/**
 * The router, and the one owner of wallet state.
 *
 * Carnage is a presentation page and an app sharing a bundle. Keeping the
 * split here rather than inside one giant view means each screen renders only
 * its own concerns, and it means a connection made in the app survives a trip
 * back to the site: the wallet lives above both pages, and switching between
 * them is a state change, not a reload.
 */

/**
 * Scrolls after the new page has painted.
 *
 * Without this a route change kept the old scroll offset, so returning from a
 * deep match to the landing left you partway down a different page and looked
 * like the navigation had done nothing. That was the actual broken return
 * path, not the click handler.
 */
function scrollAfterPaint(hash?: string): void {
  requestAnimationFrame(() => {
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  });
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromUrl);
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);

  // DEV ONLY: ?preview=<scenario> substitutes a synthetic match so the judge
  // animation can be inspected without playing a match on-chain. It is a match
  // view by definition, so it overrides the route.
  const preview = useMemo(() => (import.meta.env.DEV ? previewFromUrl() : null), []);

  const go = useCallback((next: Route, hash?: string) => {
    history.pushState(null, "", hrefFor(next, hash));
    setRoute(next);
    scrollAfterPaint(hash);
  }, []);

  const onHome = useCallback((hash?: string) => go({ view: "landing" }, hash), [go]);
  const onLaunch = useCallback(() => go({ view: "app", matchId: null }), [go]);
  const onEntry = onLaunch;
  const onOpenMatch = useCallback((id: number) => go({ view: "app", matchId: id }), [go]);
  const onOpenPost = useCallback((slug: string) => go({ view: "post", slug }), [go]);
  const onCreated = useCallback((id: bigint) => go({ view: "app", matchId: Number(id) }), [go]);

  // Back and forward re-derive the whole route, so history stays authoritative
  // over anything the page thinks it is showing.
  useEffect(() => {
    const sync = () => setRoute(routeFromUrl());
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);

  const onConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const { address } = await connectWallet();
      setWallet(address);
    } catch {
      /* surfaced by the wallet itself */
    } finally {
      setConnecting(false);
    }
  }, []);

  const onDisconnect = useCallback(async () => {
    await disconnectWallet();
    setWallet(null);
  }, []);

  // If the user switches accounts in their wallet, the seat must follow.
  useEffect(() => {
    if (!wallet) return;
    return watchWallet(setWallet);
  }, [wallet]);

  const nav: NavShell = { wallet, connecting, onConnect, onDisconnect, onHome, onLaunch };

  // An unknown slug is a typo or a stale link. The landing carries the list of
  // what does exist, so that is where it goes, rather than an empty shell.
  const post = !preview && route.view === "post" ? findPost(route.slug) : null;
  if (post) {
    return <PostPage nav={nav} post={post} />;
  }

  if (!preview && (route.view === "landing" || route.view === "post")) {
    return <LandingPage nav={nav} onOpenPost={onOpenPost} />;
  }

  return (
    <MatchApp
      nav={nav}
      matchId={route.view === "app" ? route.matchId : null}
      preview={preview}
      onOpenMatch={onOpenMatch}
      onEntry={onEntry}
      onCreated={onCreated}
    />
  );
}
