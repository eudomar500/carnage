import type { MouseEvent } from "react";
import { storeNetwork } from "../chain/client";
import {
  DEFAULT_NETWORK_ID,
  NET_PARAM,
  NETWORK_IDS,
  addressUrl,
  networkById,
  type NetworkId,
} from "../chain/networks";
import { hrefFor } from "../lib/route";
import { shortAddress } from "../lib/format";

/**
 * Which chains Carnage is deployed on, and what each one can do.
 *
 * A reader arriving from a link has no reason to know there are two, and the
 * nav switch alone does not say what changes when you use it. This is the one
 * place that states the difference before you are standing in a match.
 *
 * Everything except the capability lines is read from the network registry:
 * the name, the contract, the explorer root and the blurb. Adding a third
 * network adds a card here with no copy change, which is the same rule the
 * registry sets for every other screen. The capability lines stay local
 * because they are prose about what a reader can expect to do, not data any
 * other screen needs.
 */

/**
 * What each network supports, in the reader's terms rather than the flag
 * names. The registry's capability flags say what the code switches on; these
 * say what it means for someone about to play a match.
 */
const CAPABILITIES: Record<NetworkId, string[]> = {
  bradbury: [
    "Nine matches on record, every one adjudicated and settled.",
    "The transaction log, the committed index and the replay proof links all work.",
    "Labs measures consensus convergence per match.",
    "Withdrawals execute, so claim() pays a settled balance out.",
  ],
  "studio-next": [
    "Two matches on record, the second played end to end from the browser.",
    "No transaction log, so no replay proof links and no convergence measurement.",
    "No outbound transfers, so claim() is disabled and settled balances stay recorded in the contract ledger.",
    "Fund your address from the Studio wallet panel before the first write. The network resets by design.",
  ],
};

/**
 * Into the app, on one named network.
 *
 * Not switchHref: that keeps the view you are on, and every view here is the
 * landing, so it would hand back the presentation page on the other chain.
 * This is hrefFor pointed at the app with no match id -- ids are per contract,
 * so carrying one across networks opens an unrelated match -- and the network
 * pinned into the query, dropped for the default because a bare URL already
 * means Bradbury.
 */
function openHref(id: NetworkId): string {
  const url = new URL(hrefFor({ view: "app", matchId: null }), location.href);
  if (id === DEFAULT_NETWORK_ID) url.searchParams.delete(NET_PARAM);
  else url.searchParams.set(NET_PARAM, id);
  return `${url.pathname}${url.search}`;
}

export default function Networks() {
  /*
    A real navigation, and the stored choice written first.

    The load that follows resolves ?net= ahead of storage, so the link alone
    is enough for Studio Next. Bradbury is the case that needs the write: its
    href carries no parameter, and a visitor who switched on an earlier visit
    has "studio-next" in storage, which would answer for a button that says
    BRADBURY on it. Storing the id first makes the button's name and the
    network the app opens on the same statement.
  */
  const open = (id: NetworkId) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    storeNetwork(id);
    location.assign(openHref(id));
  };

  return (
    <section className="doc" id="networks">
      <div className="doc-head">
        <h2 className="doc-title">NETWORKS</h2>
        <p className="doc-lede">
          Carnage runs on two networks. Bradbury is the default and the durable
          record. Studio Next is the same mechanics on the v0.6 stack. The
          network is pinned in the URL, so a link says which chain it opens,
          and match ids do not cross: they are per contract.
        </p>
      </div>

      <div className="net-grid">
        {NETWORK_IDS.map((id) => {
          const net = networkById(id);
          const explorer = addressUrl(net, net.contract);
          // 8 and 8, which is the form the README's network table prints and
          // the form the transaction links elsewhere already use.
          const short = shortAddress(net.contract, 8, 8);
          return (
            <div key={id} className="branch net-card">
              <div className="branch-head">
                <span className="branch-title">{net.label}</span>
                {explorer ? (
                  <a
                    className="proof-link net-contract"
                    href={explorer}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={net.contract}
                  >
                    {short}
                  </a>
                ) : (
                  <code className="net-contract">{short}</code>
                )}
              </div>
              <p className="net-name">{net.name}</p>
              <p className="branch-outcome">{net.blurb}</p>
              <ul className="net-caps">
                {CAPABILITIES[id].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <a
                className="lander-cta lander-cta--small net-open"
                href={openHref(id)}
                onClick={open(id)}
              >
                OPEN ON {net.label}
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
