import { useCallback, useMemo, useState, type ReactNode } from "react";
import { activeNetwork, storeNetwork } from "./client";
import { networkById, type NetworkId } from "./networks";
import { switchHref } from "../lib/route";
import { NetworkContext, type NetworkContextValue } from "./network-store";

/**
 * Who owns the network choice.
 *
 * The chain layer holds the active network as a module binding, because the
 * twenty-odd modules that import CARNAGE_ADDRESS and CHAIN are not React and
 * cannot read a context. This provider is the render-side mirror of that
 * binding for the current page load, and it is read-only: the binding is
 * resolved once in chain/client.ts at import time, and switching does not
 * change it in place.
 */

export function NetworkProvider({ children }: { children: ReactNode }) {
  // Fixed for the life of the page. The switch below reloads rather than
  // setting this, so there is no second value it could ever hold.
  const [networkId] = useState<NetworkId>(() => activeNetwork().id);

  const switchNetwork = useCallback((id: NetworkId) => {
    if (id === activeNetwork().id) return;

    /*
      A full reload, not a remount.

      Re-rendering the tree would leave the process in a state no component
      can see and none can fix. Module-level work has already happened against
      the old network and does not run twice: history.ts computes
      HISTORY_MATCHES_CONTRACT, SNAPSHOT_BLOCK and DEPLOY_BLOCK at import time
      by comparing the committed index against CARNAGE_ADDRESS, and those are
      module constants, so after an in-place switch they would still describe
      Bradbury while every read went to the other chain. Nothing in React can
      recompute them.

      In-flight promises are the other half. A match poll, a discovery walk or
      a log scan started before the switch keeps running, resolves against the
      new bindings, and writes its answer into storage keyed by the new
      contract address. Unmounting the component that started it does not stop
      the request that is already out.

      A reload costs a few hundred milliseconds and removes both problems by
      construction: every module initialises once, against one network, and
      nothing survives from the previous one. The choice is written to storage
      first so it is there when the new document starts, and the URL carries
      it too so the resolver cannot read a stale ?net= and undo the switch.
    */
    storeNetwork(id);
    location.assign(switchHref(id));
  }, []);

  const value = useMemo<NetworkContextValue>(
    () => ({
      network: networkById(networkId),
      networkId,
      capabilities: networkById(networkId).capabilities,
      switchNetwork,
    }),
    [networkId, switchNetwork],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}
