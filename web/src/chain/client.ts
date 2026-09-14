import { createClient as createClientV1 } from "genlayer-js";
import { CalldataAddress as CalldataAddressV1 } from "genlayer-js/types";
import { createClient as createClientV2 } from "genlayer-js-next";
import { CalldataAddress as CalldataAddressV2 } from "genlayer-js-next/types";
import {
  chainIdHex,
  DEFAULT_NETWORK_ID,
  isNetworkId,
  networkById,
  networkFromSearch,
  type Capabilities,
  type NetworkDef,
  type NetworkId,
} from "./networks";

/**
 * The active network, and the clients that talk to it.
 *
 * Two SDK majors are installed side by side and both are used. This is not
 * belt and braces: genlayer-js 2.0 cannot talk to Bradbury at all. Its
 * readContract fails there with "Missing or invalid parameters" because 2.0
 * moved the calldata method-call key from "method" to "", and its
 * getTransaction fails with "ConsensusDataBigRounds is not registered in
 * AddressManager" because it expects a v0.6 consensus layout Bradbury does not
 * have. 1.2 can read Studio Next but cannot write to it, because it has no way
 * to attach a fee deposit and every write reverts at the consensus contract.
 * So the SDK is chosen per network, from the registry, and neither is a
 * fallback for the other.
 *
 * CARNAGE_ADDRESS, CHAIN and the token fields below are deliberately `let`
 * rather than `const`. ES module bindings are live, so the twenty-odd modules
 * that already import them keep their import untouched and simply observe the
 * active network. The alternative was turning every one of those into a
 * function call at every call site, which would have touched far more code to
 * say the same thing. They are written in exactly one place, setActiveNetwork,
 * which runs before the first render and again only when the reader switches.
 */

let active: NetworkDef = networkById(DEFAULT_NETWORK_ID);

/** Contract address of the active network. */
export let CARNAGE_ADDRESS: `0x${string}` = active.contract;
/** Chain definition of the active network, in its own SDK's shape. */
export let CHAIN: any = active.chain;
export let CHAIN_ID_HEX: string = chainIdHex(active);

/** Native token of the active network. Read from the chain definition, never hardcoded. */
export let TOKEN_SYMBOL: string = active.chain.nativeCurrency.symbol;
export let TOKEN_DECIMALS: number = active.chain.nativeCurrency.decimals;

/** Where the persisted choice lives. One key, one value. */
const NETWORK_KEY = "carnage:network";

/**
 * The client surface Carnage actually uses.
 *
 * Structural rather than the SDK's own GenLayerClient, which is generic over a
 * chain type that differs between the two majors. Every method here exists on
 * both; estimateTransactionFeesForWrite exists only on 2.0, which is why it is
 * optional and why chain/fees.ts checks for it instead of assuming.
 */
export type ChainClient = {
  readContract: (args: any) => Promise<any>;
  writeContract: (args: any) => Promise<any>;
  simulateWriteContract: (args: any) => Promise<any>;
  waitForTransactionReceipt: (args: any) => Promise<any>;
  getTransaction: (args: any) => Promise<any>;
  /** Raw JSON-RPC passthrough; the diagnostics page uses it directly. */
  request: (args: any) => Promise<any>;
  getContractSchema: (address: string) => Promise<any>;
  getLogs?: (args: any) => Promise<any>;
  getBlockNumber?: () => Promise<bigint>;
  debugTraceTransaction?: (args: any) => Promise<any>;
  estimateTransactionFeesForWrite?: (args: any) => Promise<any>;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** The active network's full descriptor, for anything that needs more than the address. */
export function activeNetwork(): NetworkDef {
  return active;
}

export function activeNetworkId(): NetworkId {
  return active.id;
}

/** What this network can do. Every capability gate in the UI reads this. */
export function capabilities(): Capabilities {
  return active.capabilities;
}

/**
 * Points the whole app at another network.
 *
 * Every binding is rewritten together, so no module can observe a half-applied
 * switch: an address from one chain with another chain's RPC would read a
 * contract that is not there. Callers re-mount the views afterwards rather
 * than trying to migrate in-flight state across chains, because a match id
 * means a different match on each network.
 */
export function setActiveNetwork(id: NetworkId): void {
  active = networkById(id);
  CARNAGE_ADDRESS = active.contract;
  CHAIN = active.chain;
  CHAIN_ID_HEX = chainIdHex(active);
  TOKEN_SYMBOL = active.chain.nativeCurrency.symbol;
  TOKEN_DECIMALS = active.chain.nativeCurrency.decimals;
}

/** The stored choice, or the default. Never throws: storage can be unavailable. */
export function readStoredNetwork(): NetworkId {
  try {
    const raw = localStorage.getItem(NETWORK_KEY);
    return isNetworkId(raw) ? raw : DEFAULT_NETWORK_ID;
  } catch {
    return DEFAULT_NETWORK_ID;
  }
}

export function storeNetwork(id: NetworkId): void {
  try {
    localStorage.setItem(NETWORK_KEY, id);
  } catch {
    // A private window is not a reason to refuse the switch for this visit.
  }
}

/**
 * Which network this page load is for. Resolved once, here, and never again.
 *
 * Precedence is ?net= first, then the stored choice, then Bradbury. The URL
 * wins because it is the more deliberate of the two: someone following a link
 * that names a network is asking for that network on a machine whose stored
 * choice they may know nothing about. It is also written back to storage, so
 * the rest of the session stays on it after the parameter falls off the URL,
 * which is what makes a shared link behave like a visit rather than like a
 * single page.
 *
 * An unrecognised value is ignored rather than rejected, so ?net=mainnet lands
 * on the stored choice instead of on an error.
 */
function resolveInitialNetwork(): NetworkId {
  let search = "";
  try {
    // Absent under vitest's node environment, where the module is imported to
    // be driven by setActiveNetwork directly.
    search = typeof location === "undefined" ? "" : location.search;
  } catch {
    search = "";
  }

  const fromUrl = networkFromSearch(search);
  if (fromUrl) {
    storeNetwork(fromUrl);
    return fromUrl;
  }
  return readStoredNetwork();
}

/**
 * Resolved at import, not at first render.
 *
 * This module is the one every chain module imports, so its body finishes
 * before any of them runs. That ordering is the whole point: history.ts
 * computes HISTORY_MATCHES_CONTRACT, SNAPSHOT_BLOCK and DEPLOY_BLOCK at import
 * time by comparing the committed index against CARNAGE_ADDRESS, and if it
 * were to run first it would decide those against Bradbury no matter which
 * network the load is actually for. Doing it in a React provider was too late
 * for exactly that reason.
 */
setActiveNetwork(resolveInitialNetwork());

/** Builds a client on whichever SDK the active network speaks. */
function build(options: { account?: `0x${string}`; provider?: unknown }): ChainClient {
  const args: any = { chain: active.chain, ...options };
  return (active.sdk === "v2" ? createClientV2(args) : createClientV1(args)) as ChainClient;
}

/**
 * Read-only client. No account, so every request falls through the custom
 * transport straight to the active network's RPC.
 */
export function readClient(): ChainClient {
  return build({});
}

/**
 * Signing client. `account` is passed as an *address string*, not an Account
 * object: that is what makes genlayer-js route eth_sendTransaction to the
 * injected wallet instead of trying to sign locally.
 */
export function writeClient(address: `0x${string}`): ChainClient {
  return build({ account: address, provider: window.ethereum });
}

/**
 * Read-only client that still carries an identity.
 *
 * genlayer-js resolves gl.message.sender_address from the client's `account`,
 * NOT from a per-call `account` argument, so a simulation only reflects the
 * right seat if the address is set here. No provider: simulating never signs.
 */
export function simulationClient(address: `0x${string}`): ChainClient {
  return build({ account: address });
}

/**
 * GenVM addresses must be encoded as CalldataAddress; a hex string is rejected.
 *
 * Each SDK has its own class and each rejects the other's instances, so this
 * follows the active network like everything else here.
 */
export function toCalldataAddress(hex: string): any {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
  return active.sdk === "v2" ? new CalldataAddressV2(bytes) : new CalldataAddressV1(bytes);
}

export type WalletConnection = { address: `0x${string}` };

/**
 * Drops the connection.
 *
 * EIP-1193 has no disconnect, so this clears the page's own state and, where
 * the wallet supports it, revokes the account permission so the next connect
 * prompts again instead of silently reusing the same account.
 */
export async function disconnectWallet(): Promise<void> {
  try {
    await window.ethereum?.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Not supported by every wallet; clearing local state is the fallback.
  }
}

/**
 * Subscribes to wallet account changes.
 *
 * The connected address decides which seat the page thinks you hold, so a
 * stale address would offer the wrong actions. Returns an unsubscribe fn.
 */
export function watchWallet(onChange: (address: `0x${string}` | null) => void): () => void {
  const provider = window.ethereum;
  if (!provider?.on) return () => {};

  const handler = (accounts: string[]) =>
    onChange(accounts?.length ? (accounts[0] as `0x${string}`) : null);

  provider.on("accountsChanged", handler);
  return () => provider.removeListener?.("accountsChanged", handler);
}

/**
 * Puts an already-connected wallet on the active network's chain.
 *
 * Split out of connectWallet because switching network has to do this without
 * asking for accounts again. Safe to call when the wallet is already there:
 * it checks first and does nothing.
 */
export async function ensureWalletChain(): Promise<void> {
  const provider = window.ethereum;
  if (!provider) return;

  const current: string = await provider.request({ method: "eth_chainId" });
  if (current === CHAIN_ID_HEX) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    // 4902 = chain unknown to the wallet; add it, then it is selected.
    if (err?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: active.name,
          rpcUrls: [active.rpcUrl],
          nativeCurrency: active.chain.nativeCurrency,
          // Studio Next has no explorer in its chain definition, so this comes
          // from the registry; an empty list is valid and some wallets reject
          // a list containing undefined.
          blockExplorerUrls: active.explorerTx ? [active.explorerTx] : [],
        },
      ],
    });
  }
}

/**
 * Connects the injected wallet and puts it on the active network.
 *
 * We deliberately do not use `client.connect()`: that path requires MetaMask
 * Flask plus the GenLayer snap. Plain EIP-1193 + wallet_switchEthereumChain
 * works with any ordinary injected wallet, and the SDK's transport forwards
 * eth_sendTransaction to it either way.
 */
export async function connectWallet(): Promise<WalletConnection> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No injected wallet found. Install MetaMask to continue.");

  const accounts: string[] = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("Wallet returned no accounts.");

  await ensureWalletChain();

  return { address: accounts[0] as `0x${string}` };
}
