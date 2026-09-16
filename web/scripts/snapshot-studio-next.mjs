/**
 * Regenerates src/chain/history-studio-next.json, Studio Next's committed
 * transaction index.
 *
 * Run with: npm run snapshot:studio-next
 *
 * This is the same idea as scripts/snapshot.mjs and a different source. The
 * Bradbury script walks eth_getLogs on the consensus contract, because that is
 * the only place Bradbury announces a call to an intelligent contract. Studio
 * Next answers eth_getLogs with [] for every range, including the whole chain
 * with no address filter, so there is no log to walk there at all.
 *
 * What it does answer is sim_getTransactionsForAddress, which returns every
 * transaction ever sent to a contract in one response, newest first, each with
 * its calldata, its status, its consensus decision and its rotation count.
 * Measured on 2026-09-16 against the deployed contract: 41 transactions, 7.7 MB
 * of JSON, served zstd-compressed at 164 KB, in about two seconds. The node
 * puts it in its `read` rate-limit bucket, which allows 300 requests a minute,
 * not the `standard` bucket that meters contract reads at 30. So this costs one
 * request on a lane the app's own pacing does not touch.
 *
 * The app does not depend on this file to show proof links: chain/txindex.ts
 * calls the same method live on every visit. The file is the floor underneath
 * that. Studio Next is a preview chain that resets by design, and when it does,
 * the live listing goes empty while these hashes stay readable and still open
 * on the explorer. So the index is committed and the live listing is merged
 * over it, exactly as Bradbury merges its own index with a live tail.
 *
 * Re-run it whenever the record should catch up. The output is deterministic
 * for a given set of transactions: same contract, same entries, same order.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { abi } from "genlayer-js-next";

const CONTRACT = "0xB84f059D11FA6ea4c24f2d5c124686f4b72078e0";

/**
 * The published Studio Next RPC, spelled as src/chain/networks.ts spells it.
 *
 * Not imported from there: that module is TypeScript and pulls in the whole
 * chain layer. Two copies of one URL is the smaller problem, and the registry
 * test pins the app's copy.
 */
const RPC = "https://studio-next.genlayer.com/api";

/** The node method that lists a contract's transactions. See the header. */
const LIST_METHOD = "sim_getTransactionsForAddress";

/**
 * Methods whose first argument is the match id.
 *
 * Copied from scripts/snapshot.mjs deliberately rather than shared: this is the
 * contract's vocabulary, and if the two deployments ever diverge, each script
 * should describe the contract it actually reads. create_match is absent for
 * the same reason it is absent there, its first argument is the holder address
 * and the match id is its return value.
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

const RETRIES = 4;
const RETRY_BASE_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBackoff(fn) {
  let wait = RETRY_BASE_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRIES - 1) throw err;
      await sleep(wait);
      wait *= 2;
    }
  }
}

async function listTransactions() {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: LIST_METHOD,
      params: [CONTRACT],
    }),
  });
  if (!res.ok) throw new Error(`${LIST_METHOD} returned HTTP ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(`${LIST_METHOD}: ${body.error.message ?? "unknown error"}`);
  if (!Array.isArray(body?.result)) throw new Error(`${LIST_METHOD} returned no list`);
  return body.result;
}

/**
 * Method name and arguments from a transaction's calldata.
 *
 * The listing carries the GenLayer calldata blob directly, base64, with no RLP
 * wrapper around it: that wrapper is Bradbury's transaction envelope, and this
 * node does not use one. genlayer-js 2.0 keys the method under the empty
 * string rather than under "method", which is the same difference that stops
 * 1.2 reading this chain at all.
 *
 * The deployment decodes to args alone with no method key, which is the shape
 * that makes its entry carry method null, exactly as the Bradbury index
 * records its own deployment.
 */
function decodeCall(b64) {
  if (typeof b64 !== "string" || !b64) return null;
  try {
    const decoded = abi.calldata.decode(Uint8Array.from(Buffer.from(b64, "base64")));
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

/**
 * The consensus decision, in the node's own word.
 *
 * ACCEPTED is what this node says where Bradbury says AGREE, and it means the
 * same thing: consensus took the execution, so whatever it wrote to contract
 * state stands. It is not translated to AGREE here. Renaming one chain's
 * vocabulary into another's would make the committed file assert something the
 * node never said, and chain/labs.ts reads both words instead.
 *
 * An execution that reverted is reported as ERRORED even when consensus
 * accepted it, because an adjudicate call that threw wrote no labels and must
 * not be counted as the attempt that produced the verdict. Bradbury's index
 * has no equivalent, and needs none: this node is the one that reports the two
 * facts separately.
 */
function consensusResult(tx) {
  const decision = String(tx?.consensus_history?.latestDecision?.status ?? "");
  if (tx?.txExecutionResultName === "FINISHED_WITH_ERROR") return "ERRORED";
  return decision;
}

/** created_at to whole seconds in UTC, which is the precision anything renders. */
function isoSeconds(raw) {
  const ms = Date.parse(String(raw ?? ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

const raw = await withBackoff(listTransactions);
process.stderr.write(`${LIST_METHOD} returned ${raw.length} transactions\n`);

const entries = [];
for (const tx of raw) {
  const call = decodeCall(tx?.data?.calldata);
  const method = call?.method ?? null;
  const matchId =
    method && MATCH_SCOPED.has(method) ? String(call.args[0] ?? "") : null;
  entries.push({
    hash: String(tx?.hash ?? ""),
    // Null, not a number. This network has no blocks to put here, and a zero
    // in a field named block is a number a reader would try to look up.
    block: null,
    at: isoSeconds(tx?.created_at),
    method,
    matchId: matchId === "" ? null : matchId,
    sender: String(tx?.from_address ?? ""),
    status: String(tx?.status ?? ""),
    result: consensusResult(tx),
    // Rotations consensus burned before it settled. Absent from contract state
    // entirely, so the index is the only place the lab can read them.
    rounds: Number(tx?.rotation_count ?? 0),
  });
}

// Oldest first, then hash, so a re-run over the same transactions is
// byte-identical. Time is the order this network has; it has no block numbers.
entries.sort(
  (a, b) =>
    String(a.at ?? "").localeCompare(String(b.at ?? "")) ||
    (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
);

const undecoded = entries.filter((e) => e.method === null);
if (undecoded.length > 1) {
  // Exactly one is expected: the deployment, whose calldata is constructor
  // arguments rather than a call. More than that means the decoder missed
  // something, and a missed call is a proof link that will never render.
  process.stderr.write(
    `warning: ${undecoded.length} entries carry no method, expected 1 for the deployment\n`,
  );
}

const nonTerminal = entries.filter((e) => e.status !== "FINALIZED" && e.status !== "CANCELED");
if (nonTerminal.length) {
  process.stderr.write(
    `warning: ${nonTerminal.length} entries are not terminal and will be re-read at runtime\n`,
  );
}

const out = {
  contract: CONTRACT,
  chainId: 61997,
  /**
   * Where this file came from, in one sentence, because a committed file that
   * does not say what produced it is an assertion rather than a record.
   */
  source: `${LIST_METHOD} at ${RPC}`,
  snapshotAt: new Date().toISOString().slice(0, 10),
  // Both null rather than 0. This network numbers no blocks, so there is no
  // deploy block to record and no snapshot block to answer through; `snapshotAt`
  // is what says how far the file reaches.
  deployBlock: null,
  snapshotBlock: null,
  transactions: entries,
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "src", "chain", "history-studio-next.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n", "ascii");
process.stderr.write(`wrote ${target}: ${entries.length} transactions\n`);
