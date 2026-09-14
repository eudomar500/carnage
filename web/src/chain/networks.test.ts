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

  it("uses the canonical Studio Next RPC", () => {
    expect(NETWORKS["studio-next"].rpcUrl).toBe("https://studio-dev.genlayer.com/api");
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
      feesOnWrite: false,
    });
    expect(NETWORKS["studio-next"].capabilities).toEqual({
      hasTxLog: false,
      hasIndex: false,
      withdrawals: false,
      feesOnWrite: true,
    });
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

  it("offers a faucet link only where funding is actually needed", () => {
    expect(NETWORKS.bradbury.faucet.href).toBe("https://testnet-faucet.genlayer.foundation");
    expect(NETWORKS["studio-next"].faucet.href).toBeNull();
    expect(NETWORKS["studio-next"].faucet.note).toMatch(/not debited/);
  });
});
