import type { MouseEvent } from "react";
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

const SECTIONS = [
  { label: "HOW IT WORKS", hash: "how-it-works" },
  { label: "RUBRIC", hash: "rubric" },
  { label: "REPLAY", hash: "replay" },
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
};

export type TopNavProps = NavShell & {
  variant: "landing" | "app";
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
  hasReplay = false,
}: TopNavProps) {
  const onLanding = variant === "landing";
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

      {onLanding ? null : (
        <a className="nav-back" href={homeHref} onClick={goHome()}>
          &lt;&lt; BACK TO SITE
        </a>
      )}

      <nav className="nav-links">
        {SECTIONS.map((s) => {
          // On the landing every section is on this page. In the app, REPLAY
          // is on this page when a match is loaded and is omitted otherwise;
          // the other two go back to the landing at their anchor.
          const inPage = onLanding || s.hash === "replay";
          if (!onLanding && s.hash === "replay" && !hasReplay) return null;
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

      {onLanding ? (
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
      ) : wallet ? (
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
