import { abi } from "genlayer-js-next";
import { activeNetwork, CARNAGE_ADDRESS } from "./client";
import type { HistoryEntry } from "./history";

/**
 * Every transaction ever sent to the contract, read from the node itself.
 *
 * This is Studio Next's answer to the question chain/txlog.ts answers on
 * Bradbury with a log filter. The two networks reach the same facts by
 * different routes, and neither route exists on the other chain.
 *
 * Bradbury has no per-address transaction method, so txlog.ts walks the
 * consensus contract's NewTransaction event in 10000-block windows. Studio
 * Next has no such log: eth_getLogs answers [] for every range, including the
 * whole chain with no address filter, because there is no EVM underneath it.
 * That was recorded as "this network carries no proof links", and it was
 * wrong. The node answers
 *
 *   sim_getTransactionsForAddress(address)
 *
 * with the contract's entire history in a single response, newest first, each
 * transaction carrying its calldata, its status, its consensus decision and
 * its rotation count. Everything the replay, the claims table and the
 * convergence chart need is in there, and none of it needs a second read.
 *
 * Three things were measured against the live node on 2026-09-16 before this
 * was built on:
 *
 *   CORS.  The node answers with access-control-allow-origin: *, and the
 *          preflight passes with content-type allowed. Verified from a real
 *          cross-origin page in Chromium, not from curl, because only the
 *          browser enforces it. The explorer, by contrast, sends no
 *          access-control-allow-origin at all and renders its transaction list
 *          server-side, so there is nothing there a browser could fetch.
 *
 *   Cost.  The response is 7.7 MB of JSON, most of it a contract_snapshot per
 *          transaction that nothing here reads. The node serves it
 *          zstd-compressed at 164 KB, in about two seconds. That is one
 *          request per page load, and it is cached in memory for the rest of
 *          the load.
 *
 *   Budget. The node reports its rate-limit bucket in response headers. This
 *          call is bucket `read`, 300 requests a minute. Contract reads are
 *          bucket `standard`, 30 a minute, which is the figure chain/pacing.ts
 *          divides up. So this does not spend any of the budget the app paces
 *          against, and is deliberately not queued behind takeDiscoverySlot.
 *
 * The result is returned as HistoryEntry, the same shape the committed indexes
 * use, so everything downstream converts it with the converters that already
 * exist rather than growing a second vocabulary.
 */

/** The node method that lists a contract's transactions. */
const LIST_METHOD = "sim_getTransactionsForAddress";

/**
 * Methods whose first argument is the match id.
 *
 * The same set scripts/snapshot-studio-next.mjs uses, and the same reasoning:
 * create_match is absent because its first argument is the holder address and
 * the match id is its return value, so there is no id to read from calldata.
 */
const MATCH_SCOPED = new Set([
  "commit_holder", "commit_buyer",
  "fund_holder", "fund_buyer",
  "anchor_claim_holder", "anchor_claim_buyer",
  "propose_price_holder", "propose_price_buyer",
  "reveal_holder", "reveal_buyer",
  "adjudicate", "settle", "force_settle", "claim",
  "resolve_no_reveal", "resolve_inconclusive", "refund_before_lock",
]);

/**
 * Method name and arguments from a listed transaction's calldata.
 *
 * The listing carries the GenLayer calldata blob directly, base64, with no RLP
 * wrapper: that wrapper is Bradbury's transaction envelope and this node does
 * not use one, which is why txlog.ts cannot decode these and this cannot
 * decode those. genlayer-js 2.0 keys the method under the empty string rather
 * than under "method", the same difference that stops 1.2 reading this chain.
 *
 * The deployment decodes to args alone with no method key, so it comes back
 * with method null and links to no step, exactly as the committed indexes
 * record their own deployments.
 */
export function decodeListedCall(b64: unknown): { method: string | null; args: unknown[] } | null {
  if (typeof b64 !== "string" || !b64) return null;
  try {
    const decoded = (abi as any).calldata.decode(base64ToBytes(b64));
    if (!(decoded instanceof Map)) return null;
    const method = decoded.get("");
    const args = decoded.get("args");
    return {
      method: typeof method === "string" ? method : null,
      args: Array.isArray(args) ? args : [],
    };
  } catch {
    return null;
  }
}

/** atob, which node has had as a global since 16, so the tests need no shim. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * The consensus decision, in the node's own word.
 *
 * ACCEPTED is what this node says where Bradbury says AGREE, and it means the
 * same thing: consensus took the execution, so whatever it wrote to contract
 * state stands. It is deliberately not translated to AGREE. Renaming one
 * chain's vocabulary into another's would have this module assert something
 * the node never said, and chain/labs.ts reads both words instead.
 *
 * An execution that reverted reports ERRORED even where consensus accepted it,
 * because an adjudicate call that threw wrote no labels and must not be
 * counted as the attempt that produced the verdict. Bradbury's source reports
 * one word for both facts and needs no equivalent; this one reports them
 * separately, so this is where they are combined.
 */
export function consensusResult(tx: any): string {
  if (tx?.txExecutionResultName === "FINISHED_WITH_ERROR") return "ERRORED";
  return String(tx?.consensus_history?.latestDecision?.status ?? "");
}

/** created_at to whole seconds in UTC, which is the precision anything renders. */
function isoSeconds(raw: unknown): string | null {
  const ms = Date.parse(String(raw ?? ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

/** One listed transaction in the shape the committed indexes already use. */
export function listedToEntry(tx: any): HistoryEntry {
  const call = decodeListedCall(tx?.data?.calldata);
  const method = call?.method ?? null;
  const matchId = method && MATCH_SCOPED.has(method) ? String(call?.args[0] ?? "") : null;
  return {
    hash: String(tx?.hash ?? "") as `0x${string}`,
    // Null, not a number. This network has no blocks to put here, and a zero
    // in a field named block is a number a reader would try to look up.
    block: null,
    at: isoSeconds(tx?.created_at),
    method,
    matchId: matchId === "" ? null : matchId,
    sender: String(tx?.from_address ?? ""),
    status: String(tx?.status ?? ""),
    result: consensusResult(tx),
    rounds: Number(tx?.rotation_count ?? 0),
  };
}

/** Maps a whole listing, oldest first, so it reads like a committed index. */
export function listedToEntries(listed: unknown): HistoryEntry[] {
  if (!Array.isArray(listed)) return [];
  const out = listed.map(listedToEntry).filter((e) => e.hash.startsWith("0x"));
  out.sort(
    (a, b) =>
      String(a.at ?? "").localeCompare(String(b.at ?? "")) ||
      (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
  );
  return out;
}

/**
 * One listing request against the active network's RPC.
 *
 * Plain fetch rather than the SDK's client. The SDK has no binding for this
 * method, its `request` passthrough differs between the two majors, and this
 * is the exact call that was verified in a browser, so it is the exact call
 * that is made.
 */
async function requestListing(rpcUrl: string, address: string): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: LIST_METHOD, params: [address] }),
  });
  if (!res.ok) throw new Error(`the node answered HTTP ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(String(body.error.message ?? "the node refused the request"));
  if (!Array.isArray(body?.result)) throw new Error("the node returned no transaction list");
  return body.result;
}

/**
 * The listing for this page load, fetched at most once.
 *
 * Keyed by contract address so switching network cannot serve one
 * deployment's transactions for another. The promise itself is cached, not its
 * value, so the replay and the lab opening within a second of each other share
 * one request instead of racing two.
 *
 * A failure is not cached. The entry is dropped on rejection, so the next
 * caller is free to try again rather than inheriting a network hiccup for the
 * rest of the visit. There is no time-based expiry: one listing per page load
 * is the contract, and a reader who wants a newer one reloads.
 */
const inflight = new Map<string, Promise<HistoryEntry[]>>();

export function fetchContractTransactions(): Promise<HistoryEntry[]> {
  const net = activeNetwork();
  const key = `${net.rpcUrl}|${CARNAGE_ADDRESS.toLowerCase()}`;
  const cached = inflight.get(key);
  if (cached) return cached;

  const run = requestListing(net.rpcUrl, CARNAGE_ADDRESS)
    .then(listedToEntries)
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, run);
  return run;
}

/** Drops the cached listing. For tests and for a deliberate refresh. */
export function forgetContractTransactions(): void {
  inflight.clear();
}
