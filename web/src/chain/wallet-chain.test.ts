import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureWalletChain, isUnknownChain, setActiveNetwork } from "./client";
import { NETWORKS } from "./networks";

/**
 * Getting a wallet onto the active chain.
 *
 * The bug this pins: wallet_switchEthereumChain to a chain the wallet does not
 * have is supposed to reject with 4902, and Rabby rejects with -32603 and a
 * message instead. The old code only fell back to wallet_addEthereumChain on
 * 4902, so on Rabby the switch threw, the add never ran, and connect failed
 * silently. Bradbury hid it because that chain was already in every wallet
 * that had ever used the app.
 *
 * Every case drives a recording stub, so the assertion is the sequence of
 * provider calls and not just the return value. The order is the behaviour.
 */

const STUDIO = "0xf22d";

/** The exact rejection Rabby returns, copied from a production failure. */
const RABBY = Object.assign(new Error(), {
  code: -32603,
  message:
    'Unrecognized chain ID "0xf22d". Try adding the chain using wallet_switchEthereumChain first.',
  data: { originalError: { code: -32603 } },
});

/** MetaMask, which nests the real code under data.originalError. */
const METAMASK_NESTED = Object.assign(new Error("Internal JSON-RPC error."), {
  code: -32603,
  data: { originalError: { code: 4902 } },
});

const PLAIN_4902 = Object.assign(new Error("Unrecognized chain ID."), { code: 4902 });

/** A user closing the prompt. Not a missing chain, and must not be treated as one. */
const USER_REJECTED = Object.assign(new Error("User rejected the request."), { code: 4001 });

type Call = { method: string; params?: any };

/**
 * A provider that records what it was asked, in order.
 *
 * `chainId` is the chain the wallet reports; `onSwitch` decides what the
 * switch does and may change it, which is how "added, then selected" is
 * modelled without pretending the stub is a wallet.
 */
function stubProvider(opts: {
  chainId: string;
  switchFails?: unknown;
  addSelects?: boolean;
  secondSwitchFails?: unknown;
}) {
  const calls: Call[] = [];
  let chainId = opts.chainId;
  let switches = 0;

  const provider = {
    request: vi.fn(async ({ method, params }: Call) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        switches += 1;
        if (switches === 1 && opts.switchFails) throw opts.switchFails;
        if (switches === 2 && opts.secondSwitchFails) throw opts.secondSwitchFails;
        chainId = (params?.[0]?.chainId as string) ?? chainId;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        if (opts.addSelects !== false) chainId = (params?.[0]?.chainId as string) ?? chainId;
        return null;
      }
      return null;
    }),
  };

  vi.stubGlobal("window", { ethereum: provider });
  return { calls, methods: () => calls.map((c) => c.method), current: () => chainId };
}

beforeEach(() => {
  setActiveNetwork("studio-next");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveNetwork("bradbury");
});

describe("isUnknownChain", () => {
  it("accepts the plain 4902 the spec describes", () => {
    expect(isUnknownChain(PLAIN_4902)).toBe(true);
  });

  it("accepts the 4902 MetaMask nests under data.originalError", () => {
    expect(isUnknownChain(METAMASK_NESTED)).toBe(true);
  });

  it("accepts Rabby's -32603 with an unrecognized-chain message", () => {
    expect(isUnknownChain(RABBY)).toBe(true);
  });

  it("is not fooled by -32603 on its own", () => {
    // -32603 is "internal error" and means nothing by itself. Treating every
    // one as a missing chain would pop an add prompt for unrelated faults.
    expect(isUnknownChain({ code: -32603, message: "Internal JSON-RPC error." })).toBe(false);
  });

  it("rethrows a user rejection rather than prompting to add", () => {
    expect(isUnknownChain(USER_REJECTED)).toBe(false);
  });

  it("does not choke on shapes that are not errors", () => {
    expect(isUnknownChain(null)).toBe(false);
    expect(isUnknownChain(undefined)).toBe(false);
    expect(isUnknownChain("boom")).toBe(false);
    expect(isUnknownChain({})).toBe(false);
  });
});

describe("ensureWalletChain", () => {
  it("does nothing when the wallet is already on the chain", async () => {
    const p = stubProvider({ chainId: STUDIO });
    await ensureWalletChain();
    expect(p.methods()).toEqual(["eth_chainId"]);
  });

  it("switches, and stops there, when the wallet has the chain", async () => {
    const p = stubProvider({ chainId: "0x107d" });
    await ensureWalletChain();
    expect(p.methods()).toEqual(["eth_chainId", "wallet_switchEthereumChain"]);
  });

  it("adds the chain after Rabby's -32603, then confirms", async () => {
    const p = stubProvider({ chainId: "0x107d", switchFails: RABBY });
    await ensureWalletChain();
    expect(p.methods()).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
    ]);
    expect(p.current()).toBe(STUDIO);
  });

  it("adds the chain after a plain 4902", async () => {
    const p = stubProvider({ chainId: "0x107d", switchFails: PLAIN_4902 });
    await ensureWalletChain();
    expect(p.methods()).toContain("wallet_addEthereumChain");
  });

  it("adds the chain after MetaMask's nested 4902", async () => {
    const p = stubProvider({ chainId: "0x107d", switchFails: METAMASK_NESTED });
    await ensureWalletChain();
    expect(p.methods()).toContain("wallet_addEthereumChain");
  });

  it("retries the switch once when adding did not select the chain", async () => {
    // EIP-3085 says a wallet should switch after adding. Not every wallet does.
    const p = stubProvider({ chainId: "0x107d", switchFails: RABBY, addSelects: false });
    await ensureWalletChain();
    expect(p.methods()).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
      "wallet_switchEthereumChain",
    ]);
    expect(p.current()).toBe(STUDIO);
  });

  it("propagates a second switch failure rather than looping", async () => {
    const p = stubProvider({
      chainId: "0x107d",
      switchFails: RABBY,
      addSelects: false,
      secondSwitchFails: USER_REJECTED,
    });
    await expect(ensureWalletChain()).rejects.toThrow(/User rejected/);
    expect(p.methods().filter((m) => m === "wallet_switchEthereumChain").length).toBe(2);
  });

  it("propagates an unrelated failure untouched, and never offers to add", async () => {
    const p = stubProvider({ chainId: "0x107d", switchFails: USER_REJECTED });
    await expect(ensureWalletChain()).rejects.toThrow(/User rejected/);
    expect(p.methods()).toEqual(["eth_chainId", "wallet_switchEthereumChain"]);
    expect(p.methods()).not.toContain("wallet_addEthereumChain");
  });

  it("sends the registry's values on the add request", async () => {
    const p = stubProvider({ chainId: "0x107d", switchFails: RABBY });
    await ensureWalletChain();
    const add = p.calls.find((c) => c.method === "wallet_addEthereumChain");
    expect(add?.params?.[0]).toEqual({
      chainId: STUDIO,
      chainName: NETWORKS["studio-next"].name,
      rpcUrls: [NETWORKS["studio-next"].rpcUrl],
      nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
      blockExplorerUrls: [NETWORKS["studio-next"].explorerTx],
    });
  });

  it("sends Bradbury's values when Bradbury is active", async () => {
    setActiveNetwork("bradbury");
    const p = stubProvider({ chainId: STUDIO, switchFails: PLAIN_4902 });
    await ensureWalletChain();
    const add = p.calls.find((c) => c.method === "wallet_addEthereumChain");
    expect(add?.params?.[0]).toMatchObject({
      chainId: "0x107d",
      chainName: NETWORKS.bradbury.name,
      rpcUrls: [NETWORKS.bradbury.rpcUrl],
    });
  });

  it("does nothing at all without an injected wallet", async () => {
    vi.stubGlobal("window", {});
    await expect(ensureWalletChain()).resolves.toBeUndefined();
  });
});
