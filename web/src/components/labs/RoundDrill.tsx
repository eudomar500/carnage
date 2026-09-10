import { useState } from "react";
import { explorerTxUrl } from "../../chain/txlog";
import { readRoundLabels, type RoundLabels } from "../../hooks/useLabData";
import type { MatchConvergence } from "../../chain/labs";

/**
 * What each consensus round decided, for one match.
 *
 * A discarded round writes nothing to the contract, so the labels it produced
 * exist only inside the transaction. Reading them costs one trace call per
 * round, which is why this is a button rather than something the page does on
 * its own, and why it is pointed at a single match.
 *
 * The trace returns both parties' labels together, holder first.
 */
export default function RoundDrill({ match }: { match: MatchConvergence }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ txId: string; applied: boolean; rounds: RoundLabels[] }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (rows.length || busy) return;
    setBusy(true);
    const out: { txId: string; applied: boolean; rounds: RoundLabels[] }[] = [];
    for (const a of match.attempts) {
      out.push({ txId: a.txId, applied: a.applied, rounds: await readRoundLabels(a.txId, a.rounds) });
    }
    setRows(out);
    setBusy(false);
  };

  return (
    <div className="lab-drill">
      <button className="act" onClick={load} disabled={busy}>
        {busy ? "READING ROUNDS..." : open ? "HIDE THE ROUNDS" : "SHOW WHAT EACH ROUND DECIDED"}
      </button>

      {open ? (
        busy && !rows.length ? (
          <p className="lab-note">
            One trace read per round, straight from the transaction. This takes a moment.
          </p>
        ) : (
          <div className="lab-drill-body">
            {rows.map((r, i) => {
              const url = explorerTxUrl(r.txId);
              return (
                <div className="lab-drill-tx" key={r.txId}>
                  <p className="lab-drill-head">
                    <span className={`lab-drill-tag${r.applied ? "" : " lab-drill-tag--dropped"}`}>
                      {r.applied ? "APPLIED" : "DISCARDED"}
                    </span>
                    attempt {i + 1}, <code>{r.txId.slice(0, 10)}...{r.txId.slice(-8)}</code>
                    {url ? (
                      <a className="inflight-link" href={url} target="_blank" rel="noreferrer">
                        CHECK THE EXPLORER
                      </a>
                    ) : null}
                  </p>
                  <div className="lab-drill-rounds">
                    {r.rounds.map((round) => (
                      <div className="lab-drill-round" key={round.round}>
                        <span className="lab-drill-n">round {round.round}</span>
                        {round.labels.length ? (
                          round.labels.map((l, k) => (
                            <span
                              key={`${l}-${k}`}
                              className={`lab-drill-label lab-drill-label--${l.toLowerCase()}`}
                            >
                              {k === 0 ? "H" : "B"} {l}
                            </span>
                          ))
                        ) : (
                          <span className="lab-drill-none">no label recoverable</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
