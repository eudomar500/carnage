import { afterEach, describe, expect, it, vi } from "vitest";
import { hrefFor, routeFromUrl, switchHref } from "./route";

/**
 * The router's treatment of ?net=.
 *
 * It travels like ?preview= does, because a link copied out of a Studio Next
 * session should open on Studio Next. It is dropped when it names the default,
 * because a bare URL already means Bradbury and a parameter that says nothing
 * should not ride on every link in the app.
 */

function at(url: string): void {
  const parsed = new URL(url);
  vi.stubGlobal("location", {
    href: parsed.href,
    search: parsed.search,
    pathname: parsed.pathname,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hrefFor and ?net=", () => {
  it("carries a non-default network across a navigation", () => {
    at("https://carnageapp.xyz/?match=3&net=studio-next");
    expect(hrefFor({ view: "landing" })).toBe("/?net=studio-next");
    expect(hrefFor({ view: "lab" })).toBe("/?net=studio-next&lab=1");
    expect(hrefFor({ view: "app", matchId: null })).toBe("/?net=studio-next&app=1");
    expect(hrefFor({ view: "app", matchId: 7 })).toBe("/?net=studio-next&match=7");
  });

  it("drops the parameter when it names the default", () => {
    at("https://carnageapp.xyz/?net=bradbury&app=1");
    expect(hrefFor({ view: "app", matchId: null })).toBe("/?app=1");
    expect(hrefFor({ view: "landing" })).toBe("/");
  });

  it("drops a parameter that names no network", () => {
    at("https://carnageapp.xyz/?net=mainnet&app=1");
    expect(hrefFor({ view: "app", matchId: null })).toBe("/?app=1");
  });

  it("adds nothing when the URL never carried one", () => {
    at("https://carnageapp.xyz/?app=1");
    expect(hrefFor({ view: "app", matchId: null })).toBe("/?app=1");
  });

  it("leaves other unrelated parameters alone", () => {
    at("https://carnageapp.xyz/?preview=settled&net=studio-next&match=2");
    expect(hrefFor({ view: "lab" })).toBe("/?preview=settled&net=studio-next&lab=1");
  });

  it("keeps the hash behaviour it always had", () => {
    at("https://carnageapp.xyz/?net=studio-next");
    expect(hrefFor({ view: "landing" }, "rubric")).toBe("/?net=studio-next#rubric");
  });

  it("respects a base path the site is served from", () => {
    at("https://eudomar500.github.io/carnage/?net=studio-next&app=1");
    expect(hrefFor({ view: "lab" })).toBe("/carnage/?net=studio-next&lab=1");
  });

  it("does not let ?net= change which view the URL names", () => {
    at("https://carnageapp.xyz/?net=studio-next&lab=1");
    expect(routeFromUrl()).toEqual({ view: "lab" });
    at("https://carnageapp.xyz/?net=studio-next");
    expect(routeFromUrl()).toEqual({ view: "landing" });
  });
});

describe("switchHref", () => {
  it("drops the match id, because ids are per contract", () => {
    at("https://carnageapp.xyz/?match=3");
    expect(switchHref("studio-next")).toBe("/?app=1&net=studio-next");
  });

  it("pins the target network so a stale parameter cannot undo the switch", () => {
    // Without this the reload would read ?net=bradbury and come straight back.
    at("https://carnageapp.xyz/?net=bradbury&match=3");
    expect(switchHref("studio-next")).toBe("/?app=1&net=studio-next");
  });

  it("removes the parameter when switching to the default", () => {
    at("https://carnageapp.xyz/?net=studio-next&match=3");
    expect(switchHref("bradbury")).toBe("/?app=1");
  });

  it("stays on the same view when there is no match to drop", () => {
    at("https://carnageapp.xyz/?lab=1");
    expect(switchHref("studio-next")).toBe("/?lab=1&net=studio-next");
    at("https://carnageapp.xyz/");
    expect(switchHref("studio-next")).toBe("/?net=studio-next");
    at("https://carnageapp.xyz/?post=how-carnage-works");
    expect(switchHref("studio-next")).toBe("/?post=how-carnage-works&net=studio-next");
  });

  it("drops a malformed match id too", () => {
    at("https://carnageapp.xyz/?match=notanumber");
    expect(switchHref("studio-next")).toBe("/?app=1&net=studio-next");
  });
});
