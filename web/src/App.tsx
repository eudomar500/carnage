import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LandingPage from "./pages/LandingPage";
import MatchApp from "./pages/MatchApp";
import PostPage from "./pages/PostPage";
import LabPage from "./pages/LabPage";
import { findPost } from "./content/posts";
import type { NavShell } from "./components/TopNav";
import { useNotifications } from "./hooks/useNotifications";
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

  /**
   * True while the view belongs to a match the user picked out of the bell.
   *
   * A create started before that click keeps running, and when it lands it
   * used to call onCreated and drag the view onto the new match, in the middle
   * of whatever the user had deliberately gone to do. Pressing a notification
   * is an explicit choice about where to be, so it wins over any navigation
   * the app would otherwise perform on its own. The new match is already in
   * the bell and waits there until it is chosen too.
   *
   * A ref, not state: nothing renders from it, and it has to be readable by a
   * callback fired from a promise that outlived the panel that started it.
   */
  const bellPinned = useRef(false);

  const onHome = useCallback(
    (hash?: string) => {
      bellPinned.current = false;
      go({ view: "landing" }, hash);
    },
    [go],
  );
  const onLaunch = useCallback(() => {
    bellPinned.current = false;
    go({ view: "app", matchId: null });
  }, [go]);
  const onEntry = onLaunch;
  const onOpenMatch = useCallback(
    (id: number) => {
      bellPinned.current = false;
      go({ view: "app", matchId: id });
    },
    [go],
  );
  const onOpenPost = useCallback(
    (slug: string) => {
      bellPinned.current = false;
      go({ view: "post", slug });
    },
    [go],
  );
  const onOpenLab = useCallback(() => {
    bellPinned.current = false;
    go({ view: "lab" });
  }, [go]);

  /**
   * The bell's own navigation. Same move as onOpenMatch, plus the pin.
   *
   * Wired only into `nav`, which reaches NotificationBell and nothing else, so
   * opening a match by id from the entry screen still behaves exactly as it
   * did and a create started there still lands the user on the new match.
   */
  const onOpenFromBell = useCallback(
    (id: number) => {
      go({ view: "app", matchId: id });
      bellPinned.current = true;
    },
    [go],
  );

  const onCreated = useCallback(
    (id: bigint) => {
      if (bellPinned.current) return;
      go({ view: "app", matchId: Number(id) });
    },
    [go],
  );

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

  // One feed for the session, owned here so the bell survives navigation
  // between the landing, a post and the app.
  const notifications = useNotifications(wallet);
  const nav: NavShell = {
    wallet, connecting, onConnect, onDisconnect, onHome, onLaunch,
    notifications, onOpenMatch: onOpenFromBell, onOpenLab,
  };

  // An unknown slug is a typo or a stale link. The landing carries the list of
  // what does exist, so that is where it goes, rather than an empty shell.
  const post = !preview && route.view === "post" ? findPost(route.slug) : null;
  if (post) {
    return <PostPage nav={nav} post={post} />;
  }

  if (!preview && route.view === "lab") {
    return <LabPage nav={nav} />;
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
