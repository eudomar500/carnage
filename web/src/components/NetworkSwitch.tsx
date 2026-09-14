import { useNetwork } from "../chain/network-store";
import { NETWORK_IDS, networkById } from "../chain/networks";

/**
 * The network control, and the label that keeps a screenshot honest.
 *
 * Deliberately a segmented control rather than a dropdown. There are two
 * networks and they are not equivalent: one is the record and one is a preview
 * that resets. Both names being visible at all times means the active one is
 * readable without opening anything, which is the whole point of putting it
 * next to the wallet.
 *
 * `title` carries the blurb rather than a permanent second line, because the
 * nav is already dense and the difference between the two networks matters at
 * the moment you switch, not continuously.
 *
 * On every view, not just the app. The lab is the case that settled it: it
 * reads the contract, names the active network in its lede and gates its
 * convergence section on that network's capabilities, and until this was
 * reachable from there the only way to change what the lab was measuring was
 * to leave for the app, switch, and come back.
 *
 * `compact` drops the standing NETWORK label for navs that are already dense
 * with section links. The control is the same control; only the word goes.
 */
export default function NetworkSwitch({ compact = false }: { compact?: boolean }) {
  const { networkId, switchNetwork } = useNetwork();

  return (
    <div
      className={`net-switch${compact ? " net-switch--compact" : ""}`}
      role="group"
      aria-label="Network"
    >
      {compact ? null : <span className="net-switch-key">NETWORK</span>}
      {NETWORK_IDS.map((id) => {
        const net = networkById(id);
        const on = id === networkId;
        return (
          <button
            key={id}
            type="button"
            className={`net-opt${on ? " net-opt--on" : ""}`}
            aria-pressed={on}
            title={`${net.name} - ${net.blurb}`}
            onClick={() => switchNetwork(id)}
          >
            {net.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Where GEN comes from on this network, or why it does not need to.
 *
 * Sits with the network control because the answer changes with it, and
 * because a reader who has just switched is exactly the reader about to
 * wonder how to fund a stake. Both networks say something: a chain with no
 * faucet link still owes an explanation, and silence there would read as a
 * missing feature rather than as a deliberate difference.
 */
export function NetworkFaucet() {
  const { network } = useNetwork();
  const { href, note } = network.faucet;

  if (href) {
    return (
      <a className="net-faucet" href={href} target="_blank" rel="noreferrer noopener" title={note}>
        FAUCET
      </a>
    );
  }
  return (
    <span className="net-faucet net-faucet--none" title={note}>
      NO FAUCET NEEDED
    </span>
  );
}
