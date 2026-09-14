import { createContext, useContext } from "react";
import type { Capabilities, NetworkDef, NetworkId } from "./networks";

/**
 * The context object and its readers, kept out of the provider file.
 *
 * Only because a module that exports a component should export nothing else,
 * or fast refresh stops working for it. The provider is in
 * network-context.tsx and is the only writer; everything here reads.
 */

export type NetworkContextValue = {
  network: NetworkDef;
  networkId: NetworkId;
  capabilities: Capabilities;
  /**
   * Persists the choice and reloads onto it. Does not return in practice: the
   * document is replaced, so nothing after the call runs.
   */
  switchNetwork: (id: NetworkId) => void;
};

export const NetworkContext = createContext<NetworkContextValue | null>(null);

/**
 * The active network, for anything that renders.
 *
 * Throws rather than falling back to a default: a component reading this
 * outside the provider would render Bradbury's name over another network's
 * data, which is exactly the mislabelling the network chip exists to prevent.
 */
export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside NetworkProvider");
  return ctx;
}

/** Capability flags alone, for the many call sites that need nothing else. */
export function useCapabilities(): Capabilities {
  return useNetwork().capabilities;
}
