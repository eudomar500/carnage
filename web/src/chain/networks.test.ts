import { describe, expect, it } from "vitest";
import {
  addressUrl,
  chainIdHex,
  DEFAULT_NETWORK_ID,
  isNetworkId,
  networkById,
  NETWORK_IDS,
  NETWORKS,
  txUrl,
} from "./networks";

/**
 * The registry is the one place the two deployments differ, so these are less
 * unit tests than assertions that the facts in it are the facts we measured.
 * A wrong address or a capability flag flipped the wrong way does not throw
 * anywhere; it quietly reads the wrong contract or offers a button that
 * cannot work.
 */

describe("network registry", () => {
  it("defaults to Bradbury, which holds the record", () => {
    expect(DEFAULT_NETWORK_ID).toBe("bradbury");
  });

  it("carries the deployed address and chain id of each network", () => {
    expect(NETWORKS.bradbury.contract).toBe("0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A");
    expect(NETWORKS.bradbury.chainId).toBe(4221);
    expect(NETWORKS["studio-next"].contract).toBe("0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0");
    expect(NETWORKS["studio-next"].chainId).toBe(61997);
  });

  it("uses the published Studio Next RPC", () => {
    expect(NETWORKS["studio-next"].rpcUrl).toBe("https://studio-next.genlayer.com/api");
  });

  it("dials the host its row names, on every network", () => {
    // rpcUrl is only the wallet_addEthereumChain offer; chain.rpcUrls is what
    // genlayer-js actually requests. studioDevnet ships studio-dev, so the
    // registry overrides it, and a wallet added under one host reading from
    // another is exactly what this stops.
    for (const id of NETWORK_IDS) {
      const net = networkById(id);
      expect(net.chain.rpcUrls.default.http[0]).toBe(net.rpcUrl);
    }
  });

  it("binds each network to the SDK major that can talk to it", () => {
    // 2.0 cannot read Bradbury (calldata key) and 1.2 cannot write to Studio
    // Next (no fee field). Neither is a fallback for the other.
    expect(NETWORKS.bradbury.sdk).toBe("v1");
    expect(NETWORKS["studio-next"].sdk).toBe("v2");
  });

  it("agrees with the chain definition it ships", () => {
    for (const id of NETWORK_IDS) {
      const net = networkById(id);
      expect(net.chain.id).toBe(net.chainId);
    }
  });

  it("records Bradbury as the only network with a log, an index and withdrawals", () => {
    expect(NETWORKS.bradbury.capabilities).toEqual({
      hasTxLog: true,
      hasIndex: true,
      withdrawals: true,
      revertDataInReads: true,
      simulateCarriesValue: false,
      feesOnWrite: false,
    });
    expect(NETWORKS["studio-next"].capabilities).toEqual({
      hasTxLog: false,
      hasIndex: false,
      withdrawals: false,
      revertDataInReads: false,
      simulateCarriesValue: true,
      feesOnWrite: true,
    });
  });

  it("records which node returns revert data on a failed read", () => {
    // Bradbury returns the GenVM ReturnData, so a contract revert can be read
    // out of the error. Studio Next returns "execution failed" and nothing
    // more, which is what makes the discovery stop condition ambiguous there.
    expect(NETWORKS.bradbury.capabilities.revertDataInReads).toBe(true);
    expect(NETWORKS["studio-next"].capabilities.revertDataInReads).toBe(false);
  });

  it("records which SDK major can simulate a payable call with its value", () => {
    // 1.2's simulateWriteContract never reads a value argument, so every
    // simulated fund_* on Bradbury trips the contract's final
    // `value != stake_amount` guard and the guard has to be tolerated there.
    // 2.0 serialises it into the gen_call params and the Studio node honours
    // it, measured against match 2 of the deployed contract.
    expect(NETWORKS.bradbury.capabilities.simulateCarriesValue).toBe(false);
    expect(NETWORKS["studio-next"].capabilities.simulateCarriesValue).toBe(true);
  });

  it("supplies an explorer base for Studio Next, whose chain definition has none", () => {
    // studioDevnet ships with no blockExplorers entry, so without the registry
    // every proof link on that network would be null.
    expect(NETWORKS["studio-next"].chain.blockExplorers?.default?.url).toBeUndefined();
    expect(NETWORKS["studio-next"].explorerTx).toBe("https://explorer-studio-dev.genlayer.com");
  });

  it("builds tx and address URLs in the shape each explorer serves", () => {
    const hash = "0x7cf79dc18a5714d6f0b0046b2011f74f95f7c84b87e57e3edd9d56d83ad0ab79";
    expect(txUrl(NETWORKS["studio-next"], hash)).toBe(
      `https://explorer-studio-dev.genlayer.com/tx/${hash}`,
    );
    expect(addressUrl(NETWORKS["studio-next"], NETWORKS["studio-next"].contract)).toBe(
      `https://explorer-studio-dev.genlayer.com/address/${NETWORKS["studio-next"].contract}`,
    );
    expect(txUrl(NETWORKS.bradbury, hash)).toBe(
      `https://explorer-bradbury.genlayer.com/tx/${hash}`,
    );
  });

  it("returns null rather than a broken URL when a network publishes no explorer", () => {
    const none = { ...NETWORKS.bradbury, explorerTx: null, explorerAddress: null };
    expect(txUrl(none, "0xabc")).toBeNull();
    expect(addressUrl(none, "0xabc")).toBeNull();
  });

  it("hex-encodes the chain id for wallet_switchEthereumChain", () => {
    expect(chainIdHex(NETWORKS.bradbury)).toBe("0x107d");
    expect(chainIdHex(NETWORKS["studio-next"])).toBe("0xf22d");
  });

  it("rejects a stale or hand-edited stored choice", () => {
    expect(isNetworkId("bradbury")).toBe(true);
    expect(isNetworkId("studio-next")).toBe(true);
    expect(isNetworkId("mainnet")).toBe(false);
    expect(isNetworkId(null)).toBe(false);
    expect(isNetworkId("constructor")).toBe(false);
  });

  /**
   * Both networks need a funded address, for different reasons.
   *
   * Studio Next does not debit GEN, which used to be the argument for offering
   * no faucet at all. It is the wrong argument: an injected wallet checks
   * eth_getBalance before it signs and refuses a write whose value is the fee
   * deposit while that balance reads zero, so an address with no GEN cannot
   * play there either. Its funding lives in the Studio app, not on a faucet
   * page, so the note has to point at the panel inside it.
   */
  it("offers a faucet link on every network", () => {
    expect(NETWORKS.bradbury.faucet.href).toBe("https://testnet-faucet.genlayer.foundation");
    expect(NETWORKS["studio-next"].faucet.href).toBe("https://studio-next.genlayer.com");
    expect(NETWORKS["studio-next"].faucet.note).toMatch(/needs a balance to sign/);
    expect(NETWORKS["studio-next"].faucet.note).toMatch(/Studio wallet panel/);
    for (const net of Object.values(NETWORKS)) {
      expect(net.faucet.href).toMatch(/^https:\/\//);
      expect(net.faucet.note.length).toBeGreaterThan(0);
    }
  });
});
