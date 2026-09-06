import { shortAddress } from "../lib/format";

/**
 * Carnage is a single page. The whole app is here, so there is nothing to
 * "launch". Links point at sections of this page; a link is only listed once
 * its section exists.
 */
const LINKS = [
  { label: "HOW IT WORKS", href: "#how-it-works" },
  { label: "RUBRIC", href: "#rubric" },
  { label: "REPLAY", href: "#replay" },
];

export type TopNavProps = {
  wallet: `0x${string}` | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

/**
 * The wallet control lives here and nowhere else. Which seat you hold (and
 * therefore which actions the page offers) depends entirely on the connected
 * address, so it has to be reachable from anywhere on the page.
 */
export default function TopNav({ wallet, connecting, onConnect, onDisconnect }: TopNavProps) {
  return (
    <header className="nav">
      <a className="nav-logo" href="#top">CARNAGE</a>
      <nav className="nav-links">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>{l.label}</a>
        ))}
      </nav>

      {wallet ? (
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
