import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { networkFromSearch, NET_PARAM } from "./networks";

/**
 * How a page load decides which network it is for.
 *
 * The order matters more than it looks. ?net= has to beat the stored choice,
 * or a link that names a network would do nothing on a machine that had ever
 * used the switch. The stored choice has to beat the default, or the switch
 * would not survive a reload, which is the only way the switch works at all.
 * And an unrecognised value has to fall through rather than fail, so a typo in
 * a shared link lands somewhere usable.
 *
 * Resolution happens in chain/client.ts at import time, so these tests reset
 * the module registry and import it fresh for each case rather than calling a
 * function. That is the behaviour worth pinning: the timing is the point.
 */

const KEY = "carnage:network";

/** A localStorage stand-in. The node environment has none. */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(KEY, initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
    /** Test-only reader, so a case can assert what was written back. */
    _read: () => map.get(KEY) ?? null,
  };
}

function setLocation(search: string): void {
  vi.stubGlobal("location", {
    search,
    href: `https://carnageapp.xyz/${search}`,
    pathname: "/",
  });
}

/** Imports the chain client fresh and reports the network it resolved to. */
async function resolveWith(search: string, stored?: string) {
  vi.resetModules();
  const storage = fakeStorage(stored);
  vi.stubGlobal("localStorage", storage);
  setLocation(search);
  const mod = await import("./client");
  return { id: mod.activeNetwork().id, address: mod.CARNAGE_ADDRESS, stored: storage._read() };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("networkFromSearch", () => {
  it("reads a network the registry knows", () => {
    expect(networkFromSearch("?net=studio-next")).toBe("studio-next");
    expect(networkFromSearch("?net=bradbury")).toBe("bradbury");
  });

  it("ignores anything else rather than failing on it", () => {
    expect(networkFromSearch("?net=mainnet")).toBeNull();
    expect(networkFromSearch("?net=")).toBeNull();
    expect(networkFromSearch("?app=1")).toBeNull();
    expect(networkFromSearch("")).toBeNull();
    // Inherited object keys are not networks.
    expect(networkFromSearch("?net=constructor")).toBeNull();
    expect(networkFromSearch("?net=toString")).toBeNull();
  });

  it("finds the parameter wherever it sits in the query", () => {
    expect(networkFromSearch("?app=1&net=studio-next&preview=x")).toBe("studio-next");
  });

  it("names the parameter once, for the router and the resolver to share", () => {
    expect(NET_PARAM).toBe("net");
  });
});

describe("precedence at page load", () => {
  it("takes ?net= over the stored choice", async () => {
    const r = await resolveWith("?net=studio-next", "bradbury");
    expect(r.id).toBe("studio-next");
  });

  it("takes ?net= over the stored choice in the other direction too", async () => {
    const r = await resolveWith("?net=bradbury", "studio-next");
    expect(r.id).toBe("bradbury");
  });

  it("writes ?net= back, so the choice outlives the parameter", async () => {
    // This is what makes a shared link behave like a visit: the parameter
    // falls off the first navigation and the session stays where it landed.
    const r = await resolveWith("?net=studio-next");
    expect(r.stored).toBe("studio-next");
  });

  it("falls back to the stored choice when there is no parameter", async () => {
    const r = await resolveWith("?app=1", "studio-next");
    expect(r.id).toBe("studio-next");
  });

  it("falls back to bradbury with neither", async () => {
    const r = await resolveWith("");
    expect(r.id).toBe("bradbury");
  });

  it("ignores an unknown network and uses the stored choice", async () => {
    const r = await resolveWith("?net=mainnet", "studio-next");
    expect(r.id).toBe("studio-next");
    // Not written back: it selected nothing.
    expect(r.stored).toBe("studio-next");
  });

  it("ignores an unknown network with nothing stored", async () => {
    const r = await resolveWith("?net=mainnet");
    expect(r.id).toBe("bradbury");
  });

  it("ignores a stored value that is not a network", async () => {
    const r = await resolveWith("", "mainnet");
    expect(r.id).toBe("bradbury");
  });

  it("points the contract address at the resolved network, not the default", async () => {
    // The whole reason resolution happens at import: every module-level
    // constant computed from CARNAGE_ADDRESS has to see the right value.
    const r = await resolveWith("?net=studio-next");
    expect(r.address).toBe("0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0");
  });
});

describe("history constants follow the resolved network", () => {
  it("disowns the committed index when the load is not for Bradbury", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", fakeStorage());
    setLocation("?net=studio-next");
    const history = await import("./history");
    // history.ts computes these at import time against CARNAGE_ADDRESS. If
    // resolution ran later than this module, they would describe Bradbury.
    expect(history.HISTORY_MATCHES_CONTRACT).toBe(false);
    expect(history.HISTORY.transactions).toEqual([]);
    expect(history.historyByMethod("adjudicate")).toEqual([]);
  });

  it("hands the lab an empty index on a network that has none", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", fakeStorage());
    setLocation("?net=studio-next");
    // indexedAttempts walks HISTORY.transactions, so this is the lab's own
    // view of the same constants: nothing from Bradbury's index reaches it.
    const lab = await import("../hooks/useLabData");
    expect(lab.indexedAttempts().size).toBe(0);
    expect(lab.latestSettlement()).toBeNull();
  });

  it("keeps the committed index on Bradbury", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", fakeStorage());
    setLocation("");
    const history = await import("./history");
    expect(history.HISTORY_MATCHES_CONTRACT).toBe(true);
    expect(history.HISTORY.transactions.length).toBeGreaterThan(0);
  });
});
