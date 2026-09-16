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
 *   txIndexSource
 *                where this network's transaction hashes come from live, which
 *                is what decides whether a verdict on it can carry a proof
 *                link. It replaces hasTxLog, which was a boolean asking the
 *                wrong question: "does eth_getLogs work" rather than "can we
 *                attach a hash". Studio Next answered false to the first and,
 *                as it turns out, yes to the second.
 *
 *                "log" on Bradbury, where every call to an intelligent
 *                contract is announced by the consensus contract as
 *                NewTransaction(txId, recipient, activator) with recipient
 *                indexed, so filtering that event enumerates the contract's
 *                whole history. chain/txlog.ts walks it.
 *
 *                "rpc-index" on Studio Next, whose node answers
 *                sim_getTransactionsForAddress with every transaction ever
 *                sent to a contract, in one response, each carrying its
 *                calldata, status, consensus decision and rotation count.
 *                chain/txindex.ts reads it. This was recorded as
 *                hasTxLog: false, which was true of eth_getLogs and wrong
 *                about the network: it does answer [] for every range,
 *                including the full chain with no address filter, because
 *                there is no EVM underneath it, but the transactions were
 *                never unreachable. They were one method away.
 *
 *                "committed" for a network whose index is the whole answer,
 *                with nothing live to read. No row carries it today. It is
 *                declared because it is the third state this app can actually
 *                be in, and because it is what either network degrades to when
 *                its live source cannot be reached.
 *
 *                Measured on 2026-09-16: the listing call sits in the node's
 *                `read` rate-limit bucket, 300 requests a minute, not the
 *                `standard` bucket that meters contract reads at 30. So it
 *                does not compete with anything readsPerMinute below paces.
 *
 *   hasIndex     a committed transaction index exists for this contract.
 *                True on both networks now. src/chain/history.json was built
 *                against Bradbury and src/chain/history-studio-next.json
 *                against Studio Next; each is keyed to its own contract
 *                address and history.ts picks between them by address, so an
 *                index can never be read against the deployment it does not
 *                describe.
 *
 *   withdrawals  the network executes outbound value transfers. False on
 *                Studio Next: emit_transfer finalizes there with the right
 *                recipient and amount recorded and moves nothing, and
 *                use_balance=True is rejected outright. The deployed contract
 *                carries withdrawals_enabled=false for that reason and refuses
 *                claim() before it touches a balance. This flag is the app's
 *                copy of the same fact, used to decide what to offer; the
 *                contract's own field is what the claim panel actually reads,
 *                so the chain stays the authority. Nothing debits a sender
 *                there either, which is why funding an address on that network
 *                is still not optional: see feesOnWrite.
 *
 *   readRevertBytes
 *                where a failed read carries the contract's own revert bytes.
 *                Both nodes send them; they do not send them in the same
 *                place, and this says which.
 *
 *                "return-data" on Bradbury, whose error message is the whole
 *                VMResult as a Go debug dump,
 *                "execution failed: &genvm.VMResult{Kind:0x1, ReturnData:
 *                []uint8{...}}", with the UserError text as bytes inside it.
 *
 *                "receipt" on Studio Next, whose `details` is the bare string
 *                "execution failed" and whose bytes are one level down in the
 *                JSON-RPC error's own data, base64 in receipt.result. Probing
 *                an unminted id on 2026-09-15 returned
 *                "AVtFWFBFQ1RFRF0gdW5rbm93biBtYXRjaF9pZA==", which decodes to
 *                "\x01[EXPECTED] unknown match_id".
 *
 *                This was recorded as revertDataInReads: a boolean that said
 *                Studio Next sent no revert data at all, which was wrong, and
 *                left isUnknownMatch inferring the stop condition from a bare
 *                execution failure instead of reading the contract's words.
 *                isUnknownMatch now reads both places and consults this only
 *                for the fallback. See chain/contract.ts.
 *
 *   readsPerMinute
 *                how many contract reads the node will answer in a minute, or
 *                null where it does not meter them. 30 on Studio Next, which
 *                refuses the rest with
 *                "Rate limit exceeded: 30 requests per minute". Null on
 *                Bradbury, which has never refused one for rate. Every read
 *                cadence in the app is derived from this; see chain/pacing.ts
 *                for how the budget is divided.
 *
 *   simulateCarriesValue
 *                simulateWriteContract can carry the call's value, so a
 *                payable call can be simulated as it will actually be sent.
 *                False on Bradbury, whose SDK major (1.2) does not read a
 *                `value` argument at all: it destructures account, address,
 *                functionName, args, kwargs and leaderOnly and nothing else,
 *                so the gen_call params it builds have no value field and
 *                every simulated fund_* trips the contract's final
 *                `value != stake_amount` guard. True on Studio Next, where
 *                2.0 serialises a non-zero value into the gen_call params and
 *                the node honours it: measured on 2026-09-14 against match 2
 *                of the deployed contract, fund_buyer simulated with
 *                0.01 GEN returns cleanly and the same call without a value
 *                fails with "execution failed" and no revert bytes, which is
 *                the generic "Missing or invalid parameters" a reader saw
 *                before the wallet ever opened.
 *
 *   feesOnWrite  every write must carry a fee deposit quoted by the SDK.
 *                Consensus v0.6 rejects a zero deposit with
 *                FeeValueMustBeNonZero, and a call that emits a message also
 *                needs the message allocation tree or it rolls back with
 *                Mode1MessageFeesRequireGenVMPerEmissionSupport.
 *
 *                Measured on Studio Next on 2026-09-14: the deposit is never
 *                debited, so a played match costs the sender nothing. An
 *                address still cannot play on zero. An injected wallet (Rabby,
 *                MetaMask) reads eth_getBalance before it signs, sees zero,
 *                and refuses a write whose value is that deposit, so the call
 *                never reaches the node that would have ignored the value.
 *                Funding the address from the Studio wallet panel raises the
 *                balance eth_getBalance reports and the wallet signs. That is
 *                why this network carries a faucet link too.
 *
 * Adding a third network means adding a row here. It should not mean touching
 * a component.
 */

/** Which genlayer-js major speaks to this chain. They are not interchangeable. */
export type SdkId = "v1" | "v2";

export type NetworkId = "bradbury" | "studio-next";

/** Where a failed read puts the contract's revert bytes. Never "nowhere". */
export type RevertBytesLocation = "return-data" | "receipt";

/**
 * Where live transaction hashes come from on a network. See the capability
 * note above; the committed index is a separate axis, carried by hasIndex.
 */
export type TxIndexSource = "log" | "rpc-index" | "committed";

export type Capabilities = {
  txIndexSource: TxIndexSource;
  hasIndex: boolean;
  withdrawals: boolean;
  readRevertBytes: RevertBytesLocation;
  /** Contract reads the node answers per minute, or null where it does not meter. */
  readsPerMinute: number | null;
  simulateCarriesValue: boolean;
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
  /**
   * Where GEN comes from on this network. Never null: both chains need a
   * funded address before an injected wallet will sign anything at all.
   */
  faucet: { href: string; note: string };
  capabilities: Capabilities;
  /** One line under the network control, so the choice is never unexplained. */
  blurb: string;
};

const BRADBURY_EXPLORER = "https://explorer-bradbury.genlayer.com";
const STUDIO_NEXT_EXPLORER = "https://explorer-studio-dev.genlayer.com";

/**
 * The published Studio Next RPC.
 *
 * The network is published under studio-next.genlayer.com, which is the name
 * the hackathon announcement gives for it. studio-dev.genlayer.com answers the
 * same chain -- both hosts return 0xf22d for eth_chainId and serve the same
 * deployed contract -- but the published name is the one the app points at.
 *
 * It is named here because two things have to agree on it and only one of them
 * is ours. `rpcUrl` below is what the wallet_addEthereumChain payload offers,
 * and `chain.rpcUrls` is what genlayer-js actually dials; the SDK's own
 * studioDevnet definition still ships studio-dev, so the chain object is
 * overridden from this constant rather than left to disagree with the row
 * around it. Bradbury needs no such override: testnetBradbury already carries
 * the same host its row does.
 */
const STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api";

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
      txIndexSource: "log",
      hasIndex: true,
      withdrawals: true,
      readRevertBytes: "return-data",
      readsPerMinute: null,
      simulateCarriesValue: false,
      feesOnWrite: false,
    },
    blurb: "The durable record. The transaction log, the committed index and Labs live here.",
  },

  "studio-next": {
    id: "studio-next",
    label: "STUDIO NEXT",
    name: "GenLayer Studio Next",
    chainId: 61997,
    chain: {
      ...studioDevnet,
      rpcUrls: { ...studioDevnet.rpcUrls, default: { http: [STUDIO_NEXT_RPC] } },
    },
    sdk: "v2",
    rpcUrl: STUDIO_NEXT_RPC,
    contract: "0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0",
    explorerTx: STUDIO_NEXT_EXPLORER,
    explorerAddress: STUDIO_NEXT_EXPLORER,
    faucet: {
      // The faucet is inside the Studio app rather than on a page of its own:
      // wallet panel, top right, "Fund Account", which is sim_fundAccount over
      // the RPC and funds whatever address is connected. The link can only
      // open the app, so the note has to say where to look once it does.
      href: "https://studio-next.genlayer.com",
      note:
        "Studio Next does not debit GEN, but your wallet needs a balance to sign; " +
        "fund your address from the Studio wallet panel.",
    },
    capabilities: {
      txIndexSource: "rpc-index",
      hasIndex: true,
      withdrawals: false,
      readRevertBytes: "receipt",
      readsPerMinute: 30,
      simulateCarriesValue: true,
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
