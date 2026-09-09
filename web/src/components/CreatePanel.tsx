import { useState } from "react";
import { parseUnits } from "viem";
import { createMatch } from "../chain/actions";
import { confirmationFor } from "../chain/confirm";
import { useAction } from "../hooks/useAction";
import ActionButton from "./ActionButton";
import InFlightNotice from "./InFlight";
import { TOKEN_DECIMALS } from "../chain/client";
import { TOKEN_SYMBOL } from "../lib/format";

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export type CreatePanelProps = {
  wallet: `0x${string}` | null;
  onCreated: (matchId: bigint) => void;
  /**
   * Opening line. The panel is reached from two places that need different
   * framing: an id that was never minted, and the start screen where there is
   * no id in play at all.
   */
  lede?: string;
};

const DEFAULT_LEDE =
  "No match at this id yet. Opening one is permissionless: any wallet may seat two agents. You do not have to be either of them.";

/** create_match is permissionless: any wallet may open a match. */
export default function CreatePanel({ wallet, onCreated, lede = DEFAULT_LEDE }: CreatePanelProps) {
  const [holder, setHolder] = useState("");
  const [buyer, setBuyer] = useState("");
  const [floor, setFloor] = useState("500");
  const [ceil, setCeil] = useState("1000");
  const [stake, setStake] = useState("0.01");
  const [revealAt, setRevealAt] = useState(isoInDays(7));
  const [inconclusiveAt, setInconclusiveAt] = useState(isoInDays(14));
  // create_match has no prior match to watch, so the action layer proves its
  // own outcome by scanning for the minted id and there is no postcondition
  // for the watcher to poll.
  const a = useAction({ matchId: 0, confirm: confirmationFor("create_match", "holder") });

  const fillMine = (set: (v: string) => void) => () => wallet && set(wallet);

  const submit = () =>
    a.run(async (say, sent) => {
      if (!wallet) throw new Error("connect a wallet first");
      say("simulating against live state...");
      const res = await createMatch(
        wallet,
        {
          holder: holder.trim(),
          buyer: buyer.trim(),
          priceFloor: BigInt(floor),
          priceCeil: BigInt(ceil),
          stakeWei: parseUnits(stake, TOKEN_DECIMALS),
          revealDeadline: revealAt.trim(),
          inconclusiveDeadline: inconclusiveAt.trim(),
        },
        { onSubmitted: sent },
      );
      onCreated(res.matchId);
      return `match #${res.matchId} created`;
    });

  /**
   * create_match is the one action with no postcondition to watch, because
   * there is no prior match to read and the id it will mint is a guess until
   * it lands. So nothing on-chain can clear this notice by itself: the user
   * checks the explorer and drops it, or opens the minted id directly.
   */
  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="console-body">
      <p className="console-lede">{lede}</p>

      <div className="form-grid">
        <label className="form-row form-row--wide">
          <span>holder address</span>
          <div className="form-inline">
            <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="0x..." spellCheck={false} disabled={a.busy} />
            <button type="button" className="mini" disabled={!wallet || a.busy} onClick={fillMine(setHolder)}>use mine</button>
          </div>
        </label>
        <label className="form-row form-row--wide">
          <span>buyer address</span>
          <div className="form-inline">
            <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="0x..." spellCheck={false} disabled={a.busy} />
            <button type="button" className="mini" disabled={!wallet || a.busy} onClick={fillMine(setBuyer)}>use mine</button>
          </div>
        </label>
        <label className="form-row">
          <span>price_floor</span>
          <input value={floor} onChange={(e) => setFloor(e.target.value)} inputMode="numeric" disabled={a.busy} />
        </label>
        <label className="form-row">
          <span>price_ceil</span>
          <input value={ceil} onChange={(e) => setCeil(e.target.value)} inputMode="numeric" disabled={a.busy} />
        </label>
        <label className="form-row">
          <span>stake each ({TOKEN_SYMBOL})</span>
          <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" disabled={a.busy} />
        </label>
        <label className="form-row form-row--wide">
          <span>reveal_deadline</span>
          <input value={revealAt} onChange={(e) => setRevealAt(e.target.value)} spellCheck={false} disabled={a.busy} />
        </label>
        <label className="form-row form-row--wide">
          <span>inconclusive_deadline</span>
          <input value={inconclusiveAt} onChange={(e) => setInconclusiveAt(e.target.value)} spellCheck={false} disabled={a.busy} />
        </label>
        <p className="turn-hint turn-hint--muted form-row--wide">
          Both deadlines are ISO timestamps and must carry a timezone, the Z on
          the end. Both must be in the future, inconclusive_deadline must fall
          after reveal_deadline, and reveal_deadline must be more than 15
          minutes out: the contract reserves that window so the reveal phase
          cannot be squeezed to nothing. The defaults above are 7 and 14 days.
        </p>
      </div>

      <ActionButton
        label="CREATE MATCH"
        phase={a.phase}
        disabled={!wallet || !holder || !buyer}
        hash={a.hash}
        onClick={submit}
      />
      {!wallet ? (
        <p className="act-step act-step--muted">connect a wallet in the top right to create</p>
      ) : null}
    </div>
  );
}
