import type { MouseEvent } from "react";
import NotificationBell from "./NotificationBell";
import type { NotificationFeed } from "../hooks/useNotifications";
import { hrefFor } from "../lib/route";
import { shortAddress } from "../lib/format";

/**
 * The one nav, in two variants.
 *
 * Landing carries the section links and the single call to action that gets
 * you into the app. The app carries the wallet and, above all, a way back:
 * the wordmark and a labelled BACK TO SITE chip, because the wordmark alone
 * was not a discoverable return path.
 *
 * Section links are only listed once their section exists on the screen they
 * point at. HOW IT WORKS and RUBRIC live on the landing, so from the app they
 * are cross-page links that carry a real href; REPLAY is in-page and is listed
 * only when a match is actually loaded to replay.
 */

type Section = {
  label: string;
  hash: string;
  /** Lives on the landing only; the app nav does not advertise it. */
  landingOnly?: boolean;
};

const SECTIONS: Section[] = [
  { label: "HOW IT WORKS", hash: "how-it-works" },
  { label: "RUBRIC", hash: "rubric" },
  { label: "REPLAY", hash: "replay" },
  // Dropped from the app nav rather than linked back to the landing. The
  // benchmark is positioning you read once, not something you consult in the
  // middle of a match the way you consult what MISLEADING costs you, and the
  // app nav already carries the wallet, the way back and up to three links.
  { label: "BENCHMARK", hash: "benchmark", landingOnly: true },
  { label: "BLOG", hash: "blog", landingOnly: true },
];

/** The parts of the nav the router owns and both pages pass straight through. */
export type NavShell = {
  wallet: `0x${string}` | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Goes to the landing, optionally at one of its sections. */
  onHome: (hash?: string) => void;
  /** Goes from the landing into the app. */
  onLaunch: () => void;
  /**
   * App variant only. The bell needs both to render, and the presentation
   * pages pass neither, so both are optional rather than forcing every caller
   * to carry something it has no use for.
   */
  notifications?: NotificationFeed;
  onOpenMatch?: (id: number) => void;
};

export type TopNavProps = NavShell & {
  /**
   * Which page the nav is sitting on. "post" is the presentation side like
   * "landing", but its sections live on another page, so their links have to
   * navigate rather than scroll.
   */
  variant: "landing" | "app" | "post";
  /** App variant only: a match is loaded, so #replay is on this screen. */
  hasReplay?: boolean;
};

/** Left click with no modifier is ours; anything else is the browser's. */
function plainClick(e: MouseEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

export default function TopNav({
  variant,
  wallet,
  connecting,
  onConnect,
  onDisconnect,
  onHome,
  onLaunch,
  notifications,
  onOpenMatch,
  hasReplay = false,
}: TopNavProps) {
  const onLanding = variant === "landing";
  const isApp = variant === "app";
  const homeHref = hrefFor({ view: "landing" });

  const goHome = (hash?: string) => (e: MouseEvent) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    onHome(hash);
  };

  const goLaunch = (e: MouseEvent) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    onLaunch();
  };

  return (
    <header className="nav">
      <a className="nav-logo" href={homeHref} onClick={goHome()}>CARNAGE</a>

      {onLanding ? null : isApp ? (
        <a className="nav-back" href={homeHref} onClick={goHome()}>
          &lt;&lt; BACK TO SITE
        </a>
      ) : (
        <a
          className="nav-back"
          href={hrefFor({ view: "landing" }, "blog")}
          onClick={goHome("blog")}
        >
          &lt;&lt; BACK TO BLOG
        </a>
      )}

      <nav className="nav-links">
        {SECTIONS.map((s) => {
          // On the landing every section is on this page. In the app, REPLAY
          // is on this page when a match is loaded and is omitted otherwise;
          // the rest go back to the landing at their anchor. Landing-only
          // sections are dropped from the app nav but kept on a post, which is
          // the same presentation side of the product.
          const inPage = onLanding || (isApp && s.hash === "replay");
          if (isApp && s.landingOnly) return null;
          if (isApp && s.hash === "replay" && !hasReplay) return null;
          if (variant === "post" && s.hash === "replay") return null;
          return inPage ? (
            <a key={s.hash} href={`#${s.hash}`}>{s.label}</a>
          ) : (
            <a
              key={s.hash}
              href={hrefFor({ view: "landing" }, s.hash)}
              onClick={goHome(s.hash)}
            >
              {s.label}
            </a>
          );
        })}
      </nav>

      {isApp ? null : (
        <div className="nav-right">
          {/*
            No connect button here. The landing performs no chain action, so a
            connection made from it would have nothing to spend itself on, and
            a second call to action would compete with the one that matters.
            An existing connection is still worth showing: it survives the trip
            into the app, and saying so saves a pointless reconnect.
          */}
          {wallet ? (
            <span className="nav-status" title={wallet}>
              <span className="nav-wallet-dot" aria-hidden="true" />
              {shortAddress(wallet, 4, 4)}
            </span>
          ) : null}
          <a className="nav-launch" href={hrefFor({ view: "app", matchId: null })} onClick={goLaunch}>
            LAUNCH APP
          </a>
        </div>
      )}

      {isApp && wallet && notifications && onOpenMatch ? (
        <NotificationBell feed={notifications} onOpenMatch={onOpenMatch} />
      ) : null}

      {!isApp ? null : wallet ? (
        <span className="nav-wallet" title={wallet}>
          <span className="nav-wallet-dot" aria-hidden="true" />
          <span className="nav-wallet-addr">{shortAddress(wallet, 4, 4)}</span>
          <button
            className="nav-disconnect"
            onClick={onDisconnect}
            title="Disconnect wallet"
            aria-label="Disconnect wallet"
          >
            DISCONNECT
          </button>
        </span>
      ) : (
        <button className="nav-cta" onClick={onConnect} disabled={connecting}>
          {connecting ? "CONNECTING..." : "CONNECT WALLET"}
        </button>
      )}
    </header>
  );
}
