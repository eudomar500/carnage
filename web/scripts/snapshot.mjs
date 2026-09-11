/**
 * Regenerates src/chain/history.json, the committed transaction index.
 *
 * Run with: npm run snapshot
 *
 * Why this exists is documented in src/chain/txlog.ts. The short version: the
 * Bradbury RPC refuses any eth_getLogs range wider than 10000 blocks and the
 * chain produces a block every 0.76 s, so walking the contract's whole history
 * at page load costs a window per 10000 blocks and grows without bound. This
 * is a static site with no server to keep an index warm, so the index is built
 * here, committed, and shipped with the bundle.
 *
 * Re-run it whenever the record should catch up. The output is deterministic
 * for a given SNAPSHOT_BLOCK: same contract, same blocks, same entries.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient, abi } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { fromRlp, hexToBytes, parseAbiItem } from "viem";

const CONTRACT = "0xc60850c93d9AaB0e8C6c678B14b0B8db2d24337A";

/**
 * The block the contract was deployed in.
 *
 * Established from the chain: the transaction in this block carries the full
 * source of carnage.py as its calldata, and twelve consecutive empty windows
 * below it contain nothing addressed to the contract. No match can predate it.
 */
const DEPLOY_BLOCK = 21112681;

/** The RPC's hard ceiling. It rejects anything wider outright. */
const WINDOW = 10000n;

/** Log queries in flight at once, and transaction reads within each window. */
const LOG_BATCH = 3;
const READ_CONCURRENCY = 4;

const RETRIES = 4;
const RETRY_BASE_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Methods whose first argument is the match id.
 *
 * create_match is absent on purpose: its first argument is the holder address
 * and the match id is its return value, so there is no id to record from
 * calldata. The sink methods take no match at all.
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

const client = createClient({ chain: testnetBradbury });
const event = parseAbiItem(
  "event NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)",
);
const consensus = testnetBradbury.consensusMainContract?.address;
if (!consensus) throw new Error("this chain does not expose the transaction index");

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

function decodeCall(txCalldata) {
  if (typeof txCalldata !== "string" || !txCalldata.startsWith("0x")) return null;
  try {
    const parts = fromRlp(txCalldata, "hex");
    const blob = Array.isArray(parts) ? parts[0] : parts;
    const decoded = abi.calldata.decode(hexToBytes(blob));
    if (!(decoded instanceof Map)) return null;
    const method = decoded.get("method");
    if (typeof method !== "string") return null;
    const args = decoded.get("args");
    return { method, args: Array.isArray(args) ? args : [] };
  } catch {
    return null;
  }
}

async function pool(items, workers, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function readWindow(from, to) {
  const logs = await withBackoff(() =>
    client.getLogs({
      address: consensus,
      event,
      args: { recipient: CONTRACT },
      fromBlock: from,
      toBlock: to,
    }),
  );
  return pool(logs, READ_CONCURRENCY, async (log) => {
    const txId = log?.args?.txId;
    if (!txId) return null;
    const tx = await withBackoff(() => client.getTransaction({ hash: txId }));
    const call = decodeCall(tx?.txCalldata);
    const method = call?.method ?? null;
    const matchId =
      method && MATCH_SCOPED.has(method) ? String(call.args[0] ?? "") : null;
    return {
      hash: txId,
      block: Number(log.blockNumber ?? 0),
      method,
      matchId: matchId === "" ? null : matchId,
      sender: String(tx?.sender ?? ""),
      status: String(tx?.statusName ?? ""),
      result: String(tx?.resultName ?? ""),
      // Consensus rounds. Absent from contract state entirely, so the index is
      // the only place the lab can read them for anything before the snapshot.
      rounds: Number(tx?.numOfRounds ?? 0),
    };
  });
}

const snapshotBlock = Number(await withBackoff(() => client.getBlockNumber()));
const windows = [];
for (let from = DEPLOY_BLOCK; from <= snapshotBlock; from += Number(WINDOW)) {
  const to = Math.min(from + Number(WINDOW) - 1, snapshotBlock);
  windows.push([BigInt(from), BigInt(to)]);
}
process.stderr.write(
  `deploy ${DEPLOY_BLOCK} -> snapshot ${snapshotBlock}: ${windows.length} windows\n`,
);

const entries = [];
for (let base = 0; base < windows.length; base += LOG_BATCH) {
  const batch = windows.slice(base, base + LOG_BATCH);
  const results = await Promise.all(batch.map(([f, t]) => readWindow(f, t)));
  for (const window of results) {
    for (const e of window) if (e) entries.push(e);
  }
  process.stderr.write(
    `  windows ${Math.min(base + LOG_BATCH, windows.length)}/${windows.length}, ${entries.length} transactions\n`,
  );
}

// Sorted by block, then hash, so a re-run over the same range is byte-identical.
entries.sort((a, b) => a.block - b.block || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

const nonTerminal = entries.filter((e) => e.status !== "FINALIZED" && e.status !== "CANCELED");
if (nonTerminal.length) {
  process.stderr.write(
    `warning: ${nonTerminal.length} entries are not terminal and will be re-read at runtime\n`,
  );
}

const out = {
  contract: CONTRACT,
  chainId: testnetBradbury.id,
  deployBlock: DEPLOY_BLOCK,
  snapshotBlock,
  transactions: entries,
};

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "src", "chain", "history.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n", "ascii");
process.stderr.write(`wrote ${target}: ${entries.length} transactions\n`);
