import { useCallback, useEffect, useRef, useState } from "react";
import { TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import {
  CARNAGE_ADDRESS,
  CHAIN,
  CHAIN_ID_HEX,
  TOKEN_SYMBOL,
  connectWallet,
  readClient,
  toCalldataAddress,
  writeClient,
} from "./chain/client";
import { getMatch } from "./chain/contract";
import pkg from "../package.json";

type Row = { label: string; ok: boolean | null | "warn"; detail: string };

const MATCH_ID = 1;

function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}` : x), 2);
}

export default function ConnectionCheck() {
  const [rows, setRows] = useState<Row[]>([]);
  const [matchJson, setMatchJson] = useState("");
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState(false);
  const [writeLog, setWriteLog] = useState<string[]>([]);

  const ran = useRef(false);
  const push = (r: Row) => setRows((prev) => [...prev, r]);
  const log = (s: string) => setWriteLog((prev) => [...prev, s]);

  useEffect(() => {
    // StrictMode mounts effects twice in dev; run the probe once.
    if (ran.current) return;
    ran.current = true;
    (async () => {
      push({
        label: "genlayer-js version",
        ok: true,
        detail: `${pkg.dependencies["genlayer-js"]} (resolved from node_modules)`,
      });
      push({
        label: "chain",
        ok: true,
        detail: `${CHAIN.name} | id ${CHAIN.id} (${CHAIN_ID_HEX}) | native ${TOKEN_SYMBOL}`,
      });
      push({ label: "rpc endpoint", ok: true, detail: CHAIN.rpcUrls.default.http[0] });

      const client = readClient();

      try {
        const blockHex = await client.request({ method: "eth_blockNumber" });
        push({ label: "RPC reachable (eth_blockNumber)", ok: true, detail: `block ${parseInt(blockHex as string, 16)}` });
      } catch (e: any) {
        push({ label: "RPC reachable (eth_blockNumber)", ok: false, detail: String(e?.message ?? e) });
      }

      try {
        const schema = await client.getContractSchema(CARNAGE_ADDRESS);
        const methods = Object.keys(schema.methods ?? {});
        push({
          label: "contract schema",
          ok: methods.includes("get_match"),
          detail: `${methods.length} methods | get_match(${(schema.methods as any).get_match.params
            .map((p: string[]) => `${p[0]}: ${p[1]}`)
            .join(", ")}) readonly=${(schema.methods as any).get_match.readonly}`,
        });
      } catch (e: any) {
        push({ label: "contract schema", ok: false, detail: String(e?.message ?? e) });
      }

      try {
        const m = await getMatch(MATCH_ID, TransactionHashVariant.LATEST_NONFINAL);
        push({
          label: `get_match(${MATCH_ID}) | accepted`,
          ok: true,
          detail: `holder=${m.holder_label || "-"} buyer=${m.buyer_label || "-"} settled=${m.settled} stake=${m.stake_amount} wei`,
        });
        setMatchJson(json(m));
      } catch (e: any) {
        push({ label: `get_match(${MATCH_ID}) | accepted`, ok: false, detail: String(e?.message ?? e) });
      }

      try {
        const f = await getMatch(MATCH_ID, TransactionHashVariant.LATEST_FINAL);
        const n = await getMatch(MATCH_ID, TransactionHashVariant.LATEST_NONFINAL);
        const discriminates = f.settled !== n.settled || f.adjudicated !== n.adjudicated;
        push({
          label: "transaction_hash_variant honoured?",
          ok: discriminates ? true : "warn",
          detail: discriminates
            ? "latest-final differs from latest-nonfinal"
            : "NO: latest-final returns identical state; not usable as a finality signal, so the claim gate does not rely on it",
        });
      } catch (e: any) {
        push({ label: `get_match(${MATCH_ID}) | finalized`, ok: false, detail: String(e?.message ?? e) });
      }

      try {
        const sim = await client.simulateWriteContract({
          address: CARNAGE_ADDRESS,
          functionName: "create_match",
          args: [
            toCalldataAddress("0x35A07b4d6Ba15C46545A59cF869949078B57f1BD"),
            toCalldataAddress("0x8cE34d59DeD1123C7922993334A7438d474774C0"),
            500,
            1000,
            10_000_000_000_000_000n,
            "2026-12-31T00:00:00Z",
            "2027-01-31T00:00:00Z",
          ],
        });
        push({
          label: "write encoding (simulate create_match)",
          ok: true,
          detail: `executes against live state, would mint match_id ${sim}`,
        });
      } catch (e: any) {
        push({
          label: "write encoding (simulate create_match)",
          ok: false,
          detail: String(e?.message ?? e).slice(0, 200),
        });
      }

      push({
        label: "injected wallet present",
        ok: window.ethereum ? true : "warn",
        detail: window.ethereum
          ? "window.ethereum detected, ready to sign"
          : "no window.ethereum in this browser; open in one with MetaMask to sign",
      });
    })();
  }, []);

  const onConnect = useCallback(async () => {
    try {
      const { address } = await connectWallet();
      setWallet(address);
      const balHex = await window.ethereum!.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      });
      log(`connected ${address}`);
      log(`balance ${(Number(BigInt(balHex) / 10n ** 12n) / 1e6).toFixed(6)} ${TOKEN_SYMBOL}`);
    } catch (e: any) {
      log(`connect failed: ${e?.message ?? e}`);
    }
  }, []);

  const onSendWrite = useCallback(async () => {
    if (!wallet) return;
    setBusy(true);
    try {
      const client = writeClient(wallet);
      log("signing create_match via injected wallet...");
      const hash = await client.writeContract({
        address: CARNAGE_ADDRESS,
        functionName: "create_match",
        args: [
          toCalldataAddress("0x35A07b4d6Ba15C46545A59cF869949078B57f1BD"),
          toCalldataAddress("0x8cE34d59DeD1123C7922993334A7438d474774C0"),
          500,
          1000,
          10_000_000_000_000_000n,
          "2026-12-31T00:00:00Z",
          "2027-01-31T00:00:00Z",
        ],
        value: 0n,
      });
      log(`sent: ${hash}`);
      log("waiting for ACCEPTED...");
      const receipt = await client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.ACCEPTED,
        interval: 4000,
        retries: 60,
      });
      log(`status: ${receipt.status}`);
      log(`explorer: ${CHAIN.blockExplorers?.default.url}tx/${hash}`);
    } catch (e: any) {
      log(`write failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  return (
    <div className="check">
      <h1>CARNAGE | connection check</h1>
      <p className="sub">
        Step 1: prove genlayer-js talks to Bradbury, reads <code>get_match</code> on{" "}
        <code>{CARNAGE_ADDRESS}</code>, and can sign a write from this browser.
      </p>

      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={r.ok === null ? "pend" : r.ok === "warn" ? "warn" : r.ok ? "ok" : "bad"}>
                {r.ok === null ? "..." : r.ok === "warn" ? "N/A" : r.ok ? "PASS" : "FAIL"}
              </td>
              <td className="lbl">{r.label}</td>
              <td className="det">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>write path (signed by your wallet)</h2>
      <div className="actions">
        <button onClick={onConnect} disabled={!!wallet}>
          {wallet ? `connected ${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "connect wallet"}
        </button>
        <button onClick={onSendWrite} disabled={!wallet || busy}>
          {busy ? "sending..." : "sign + send create_match"}
        </button>
      </div>
      <pre className="log">{writeLog.join("\n") || "no wallet activity yet"}</pre>

      <h2>raw get_match({MATCH_ID})</h2>
      <p className="sub">
        Field names below are the contract's own and are printed unchanged.
        One is worth reading twice: holder_claimed and buyer_claimed mean that
        side anchored its natural-language claim, not that it withdrew money.
        The payout fields are holder_claimable, buyer_claimable and paid_total.
      </p>
      <pre className="log">{matchJson || "loading..."}</pre>
    </div>
  );
}
