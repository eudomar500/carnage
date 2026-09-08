import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { CalldataAddress } from "genlayer-js/types";
import type { GenLayerClient } from "genlayer-js/types";

export const CARNAGE_ADDRESS = "0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A" as const;
export const CHAIN = testnetBradbury;
export const CHAIN_ID_HEX = `0x${testnetBradbury.id.toString(16)}`;

/** Native token of Bradbury. Read from the chain definition, never hardcoded. */
export const TOKEN_SYMBOL = testnetBradbury.nativeCurrency.symbol;
export const TOKEN_DECIMALS = testnetBradbury.nativeCurrency.decimals;

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

/**
 * Read-only client. No account, so every request falls through the custom
 * transport straight to the Bradbury RPC.
 */
export function readClient(): GenLayerClient<typeof testnetBradbury> {
  return createClient({ chain: CHAIN });
}

/**
 * Signing client. `account` is passed as an *address string*, not an Account
 * object: that is what makes genlayer-js route eth_sendTransaction to the
 * injected wallet instead of trying to sign locally.
 */
export function writeClient(address: `0x${string}`): GenLayerClient<typeof testnetBradbury> {
  return createClient({ chain: CHAIN, account: address, provider: window.ethereum });
}

/**
 * Read-only client that still carries an identity.
 *
 * genlayer-js resolves gl.message.sender_address from the client's `account`,
 * NOT from a per-call `account` argument, so a simulation only reflects the
 * right seat if the address is set here. No provider: simulating never signs.
 */
export function simulationClient(address: `0x${string}`): GenLayerClient<typeof testnetBradbury> {
  return createClient({ chain: CHAIN, account: address });
}

/** GenVM addresses must be encoded as CalldataAddress; a hex string is rejected. */
export function toCalldataAddress(hex: string): CalldataAddress {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
  return new CalldataAddress(bytes);
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
 * Connects the injected wallet and puts it on Bradbury.
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

  const current: string = await provider.request({ method: "eth_chainId" });
  if (current !== CHAIN_ID_HEX) {
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
            chainName: CHAIN.name,
            rpcUrls: [...CHAIN.rpcUrls.default.http],
            nativeCurrency: CHAIN.nativeCurrency,
            blockExplorerUrls: [CHAIN.blockExplorers?.default.url],
          },
        ],
      });
    }
  }

  return { address: accounts[0] as `0x${string}` };
}
