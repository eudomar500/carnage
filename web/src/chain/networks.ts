import { testnetBradbury } from "genlayer-js/chains";
import { studioDevnet } from "genlayer-js-next/chains";

/**
 * The two networks Carnage runs on, and what each one can actually do.
 *
 * Carnage was built against one chain and had that chain's address, explorer
 * and SDK compiled in. A second deployment does not fit behind a flag, because
 * the two are not the same kind of chain: they speak different SDK majors, and
 * one of them cannot do things the app was written to assume. So the
 * differences are declared here, once, as data, and every screen asks this
 * registry rather than testing for a chain id.
 *
 * The capability flags are the important part. They are not preferences; each
 * one records something measured against the live network:
 *
 *   hasTxLog     eth_getLogs returns transactions for the consensus contract.
 *                False on Studio Next, where it answers [] for every range,
 *                including the full chain with no address filter, because
 *                there is no EVM underneath it. Everything built on the
 *                transaction log -- proof links, the convergence chart, the
 *                round drill -- has no data source there at all, so those
 *                features are switched off rather than left to render an empty
 *                result that reads like a bug.
 *
 *   hasIndex     a committed transaction index exists for this contract.
 *                web/src/chain/history.json was generated against Bradbury and
 *                is keyed to its contract address. It is meaningless anywhere
 *                else, and history.ts already refuses an index built for a
 *                different address, so this only stops us asking.
 *
 *   withdrawals  the network executes outbound value transfers. False on
 *                Studio Next: emit_transfer finalizes there with the right
 *                recipient and amount recorded and moves nothing, and
 *                use_balance=True is rejected outright. The deployed contract
 *                carries withdrawals_enabled=false for that reason and refuses
 *                claim() before it touches a balance. This flag is the app's
 *                copy of the same fact, used to decide what to offer; the
 *                contract's own field is what the claim panel actually reads,
 *                so the chain stays the authority.
 *
 *   revertDataInReads
 *                a failed read carries the contract's own revert bytes.
 *                True on Bradbury, whose node returns
 *                "execution failed: &genvm.VMResult{Kind:0x1, ReturnData:
 *                []uint8{...}}" with the UserError text inside, which is what
 *                lets a caller tell "unknown match_id" from a node fault.
 *                False on Studio Next, where the same read fails with nothing
 *                but "execution failed" and the two are indistinguishable from
 *                the error alone. See isUnknownMatch in chain/contract.ts.
 *
 *   feesOnWrite  every write must carry a fee deposit quoted by the SDK.
 *                Consensus v0.6 rejects a zero deposit with
 *                FeeValueMustBeNonZero, and a call that emits a message also
 *                needs the message allocation tree or it rolls back with
 *                Mode1MessageFeesRequireGenVMPerEmissionSupport.
 *
 * Adding a third network means adding a row here. It should not mean touching
 * a component.
 */

/** Which genlayer-js major speaks to this chain. They are not interchangeable. */
export type SdkId = "v1" | "v2";

export type NetworkId = "bradbury" | "studio-next";

export type Capabilities = {
  hasTxLog: boolean;
  hasIndex: boolean;
  withdrawals: boolean;
  revertDataInReads: boolean;
  feesOnWrite: boolean;
};

export type NetworkDef = {
  id: NetworkId;
  /** Short label for the nav and the match badge. Fits in a chip. */
  label: string;
  /** Full name, for prose and the Labs footer. */
  name: string;
  chainId: number;
  /** The chain object the SDK wants. Typed loosely: the two majors differ. */
  chain: any;
  sdk: SdkId;
  rpcUrl: string;
  contract: `0x${string}`;
  /**
   * Explorer roots, without a trailing slash.
   *
   * Bradbury's come from its own chain definition. Studio Next's do not exist
   * in the 2.0 chain definition -- studioDevnet ships with no blockExplorers
   * entry at all -- so they are ours, and explorerTxUrl would otherwise return
   * null for every transaction on that network.
   */
  explorerTx: string | null;
  explorerAddress: string | null;
  faucet: { href: string | null; note: string };
  capabilities: Capabilities;
  /** One line under the network control, so the choice is never unexplained. */
  blurb: string;
};

const BRADBURY_EXPLORER = "https://explorer-bradbury.genlayer.com";
const STUDIO_NEXT_EXPLORER = "https://explorer-studio-dev.genlayer.com";

export const NETWORKS: Record<NetworkId, NetworkDef> = {
  bradbury: {
    id: "bradbury",
    label: "BRADBURY",
    name: "GenLayer Bradbury testnet",
    chainId: 4221,
    chain: testnetBradbury,
    sdk: "v1",
    rpcUrl: "https://rpc-bradbury.genlayer.com",
    contract: "0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A",
    explorerTx: BRADBURY_EXPLORER,
    explorerAddress: BRADBURY_EXPLORER,
    faucet: {
      href: "https://testnet-faucet.genlayer.foundation",
      note: "Bradbury GEN comes from the testnet faucet.",
    },
    capabilities: {
      hasTxLog: true,
      hasIndex: true,
      withdrawals: true,
      revertDataInReads: true,
      feesOnWrite: false,
    },
    blurb: "The durable record. Every match ever played by Carnage is here.",
  },

  "studio-next": {
    id: "studio-next",
    label: "STUDIO NEXT",
    name: "GenLayer Studio Next",
    chainId: 61997,
    chain: studioDevnet,
    sdk: "v2",
    rpcUrl: "https://studio-dev.genlayer.com/api",
    contract: "0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0",
    explorerTx: STUDIO_NEXT_EXPLORER,
    explorerAddress: STUDIO_NEXT_EXPLORER,
    faucet: {
      href: null,
      // No link on purpose: the studio-dev faucet RPC accepts a request and
      // credits nothing, and the simulator does not debit a sender for fees
      // anyway, so pointing anyone at a faucet would be sending them to fix a
      // problem they do not have.
      note: "GEN is not debited on this network, so no faucet is needed.",
    },
    capabilities: {
      hasTxLog: false,
      hasIndex: false,
      withdrawals: false,
      revertDataInReads: false,
      feesOnWrite: true,
    },
    blurb:
      "Consensus v0.6 preview. State resets by design, and withdrawals do not execute.",
  },
};

/**
 * Bradbury, always.
 *
 * The record lives there, it is the network every link ever published points
 * at, and it is the one a first-time visitor should land on without choosing
 * anything. A preview chain that resets by design is never the default.
 */
export const DEFAULT_NETWORK_ID: NetworkId = "bradbury";

export const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[];

/** Narrow an unknown string, so a stale or hand-edited choice cannot poison the app. */
export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NETWORKS, value);
}

/**
 * The query parameter that pins a network for one load.
 *
 * Named here rather than in the router because the chain layer resolves it
 * before any router code runs, and both sides have to agree on the spelling.
 */
export const NET_PARAM = "net";

/**
 * The network named by a query string, if it names a valid one.
 *
 * Null covers three cases that all mean the same thing to the caller: no
 * parameter, an empty parameter, and a value that is not a network we have.
 * An unknown value is ignored rather than treated as an error, because the
 * alternative is a link with a typo in it rendering a blank page instead of
 * the default network.
 *
 * Pure, so the precedence rules can be tested without a browser.
 */
export function networkFromSearch(search: string): NetworkId | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(NET_PARAM);
  } catch {
    return null;
  }
  return isNetworkId(raw) ? raw : null;
}

export function networkById(id: NetworkId): NetworkDef {
  return NETWORKS[id];
}

/** `0x`-prefixed chain id, the only form wallet_switchEthereumChain accepts. */
export function chainIdHex(net: NetworkDef): string {
  return `0x${net.chainId.toString(16)}`;
}

/** Explorer URL for a transaction, or null when this network publishes none. */
export function txUrl(net: NetworkDef, hash: string): string | null {
  if (!net.explorerTx || !hash) return null;
  return `${net.explorerTx.replace(/\/+$/, "")}/tx/${hash}`;
}

/** Explorer URL for an address, or null when this network publishes none. */
export function addressUrl(net: NetworkDef, address: string): string | null {
  if (!net.explorerAddress || !address) return null;
  return `${net.explorerAddress.replace(/\/+$/, "")}/address/${address}`;
}
