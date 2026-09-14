import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import TopNav, { type NavShell } from "./TopNav";
import { NetworkProvider } from "../chain/network-context";

/**
 * Which views carry the network control.
 *
 * Rendered to a string with react-dom/server, which is already a dependency,
 * so this needs no DOM library. Static markup is enough for the question being
 * asked: the control is either in the tree or it is not, and clicking it is
 * covered by the browser pass in pw/check.mjs.
 *
 * The rule under test is that there is no view without it. It used to be
 * derived from variant === "app", which left the lab naming the active network
 * in its lede while offering no way to change it.
 */

const NOOP = () => {};

const shell: NavShell = {
  wallet: null,
  connecting: false,
  onConnect: NOOP,
  onDisconnect: NOOP,
  onHome: NOOP,
  onLaunch: NOOP,
};

function markup(props: Partial<Parameters<typeof TopNav>[0]> = {}): string {
  vi.stubGlobal("location", {
    href: "https://carnageapp.xyz/",
    search: "",
    pathname: "/",
  });
  return renderToStaticMarkup(
    createElement(NetworkProvider, null, createElement(TopNav, { variant: "app", ...shell, ...props })),
  );
}

const VARIANTS = [
  ["landing", { variant: "landing" as const }],
  ["post", { variant: "post" as const }],
  ["app", { variant: "app" as const }],
  ["app with a match", { variant: "app" as const, hasReplay: true }],
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the network control is reachable from every view", () => {
  for (const [label, props] of VARIANTS) {
    it(`renders the switch on ${label}`, () => {
      const html = markup(props);
      expect(html).toContain('role="group"');
      expect(html).toContain('aria-label="Network"');
      // Both networks are always listed, so the inactive one is one click away.
      expect(html).toContain("BRADBURY");
      expect(html).toContain("STUDIO NEXT");
      // Two real buttons, not a label.
      expect(html.match(/class="net-opt[^"]*"/g)?.length).toBe(2);
    });
  }

  it("marks exactly one option as active, on every view", () => {
    for (const [, props] of VARIANTS) {
      const html = markup(props);
      expect(html.match(/net-opt net-opt--on/g)?.length).toBe(1);
      expect(html).toContain('aria-pressed="true"');
    }
  });

  it("no longer renders the read-only tag anywhere", () => {
    // NetworkTag described a surface that no longer exists. If it comes back,
    // it means a view lost its control again.
    for (const [, props] of VARIANTS) {
      expect(markup(props)).not.toContain("net-tag");
    }
  });
});

describe("the compact form", () => {
  it("drops the standing label on the landing and post navs", () => {
    for (const variant of ["landing", "post"] as const) {
      const html = markup({ variant });
      expect(html).toContain("net-switch--compact");
      expect(html).not.toContain("net-switch-key");
    }
  });

  it("keeps the label in the app, where the nav has room", () => {
    const html = markup({ variant: "app" });
    expect(html).not.toContain("net-switch--compact");
    expect(html).toContain("net-switch-key");
    expect(html).toContain("NETWORK");
  });
});

describe("the faucet stays where it was", () => {
  it("is offered in the app, which is the only place you fund a stake", () => {
    expect(markup({ variant: "app" })).toContain("net-faucet");
  });

  it("is absent from the landing and post navs", () => {
    expect(markup({ variant: "landing" })).not.toContain("net-faucet");
    expect(markup({ variant: "post" })).not.toContain("net-faucet");
  });
});

/**
 * A failed connect has to say so.
 *
 * The rejection used to be swallowed on the assumption that the wallet shows
 * its own error, which is true for a rejected prompt and false for a wallet
 * that cannot reach the chain. See onConnect in App.tsx.
 */
describe("the connect failure line", () => {
  const FAILED = 'Unrecognized chain ID "0xf22d".';

  it("is absent until something fails", () => {
    const html = markup({ variant: "app" });
    expect(html).toContain("CONNECT WALLET");
    expect(html).not.toContain("nav-cta-err");
  });

  it("shows the decoded message beside the button, in the existing error style", () => {
    const html = markup({ variant: "app", connectError: FAILED });
    expect(html).toContain("nav-cta-err");
    // act-err is the class every other failure on the site already uses.
    expect(html).toContain("act-err");
    expect(html).toContain("Unrecognized chain ID");
    expect(html).toContain('role="alert"');
  });

  it("stays inside the button's own wrapper, so the nav row cannot grow", () => {
    const html = markup({ variant: "app", connectError: FAILED });
    const wrap = html.slice(html.indexOf("nav-cta-wrap"));
    expect(wrap.indexOf("nav-cta-err")).toBeGreaterThan(-1);
  });

  it("is offered on every view that can connect", () => {
    for (const variant of ["landing", "post", "app"] as const) {
      const html = markup({ variant, connectError: FAILED });
      // The landing and post navs carry no connect button, so they carry no
      // failure line either; the app does. Either way nothing throws.
      if (html.includes("CONNECT WALLET")) expect(html).toContain("nav-cta-err");
    }
  });

  it("is gone once a wallet is connected", () => {
    const html = markup({
      variant: "app",
      wallet: "0x612f985025feeB57B617d548Baf46371E310EaAF",
      connectError: FAILED,
    });
    expect(html).not.toContain("nav-cta-err");
    expect(html).toContain("DISCONNECT");
  });
});
