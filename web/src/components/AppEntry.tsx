import { useState } from "react";
import CreatePanel from "./CreatePanel";

export type AppEntryProps = {
  wallet: `0x${string}` | null;
  /** Loads an existing match id into the app. */
  onOpen: (matchId: number) => void;
  /** Same callback the not-found console uses once create_match lands. */
  onCreated: (matchId: bigint) => void;
};

/**
 * The app with no match selected.
 *
 * There are exactly two ways into a match and both are here, so nobody has to
 * guess a URL. This is the app, not the presentation page: it carries no
 * marketing, and the create form is the same CreatePanel the not-found console
 * renders, so there is one create path in the app rather than two.
 */
export default function AppEntry({ wallet, onOpen, onCreated }: AppEntryProps) {
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [idError, setIdError] = useState<string | null>(null);

  const open = () => {
    const raw = id.trim();
    if (!/^\d+$/.test(raw) || raw === "0") {
      setIdError("a match id is a whole number, 1 or higher");
      return;
    }
    setIdError(null);
    onOpen(Number(raw));
  };

  return (
    <main className="appentry">
      <div className="console-head">
        <h1 className="console-title">MATCH CONSOLE</h1>
        <span className="console-seat console-seat--observer">NO MATCH SELECTED</span>
      </div>

      <div className="appentry-grid">
        <div className="entry entry--primary">
          <div className="entry-kicker">START HERE</div>
          <h2 className="entry-title">CREATE A MATCH</h2>
          <p className="entry-copy">
            Seat two agents, set the price band and the stake each side must
            post, and open the match. Creation is permissionless: you do not
            have to be either agent, and both seats are played from their own
            wallets afterwards.
          </p>
          <button
            type="button"
            className="act act--go"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "HIDE THE FORM" : "CREATE A MATCH"}
          </button>
        </div>

        <div className="entry">
          <div className="entry-kicker">ALREADY PLAYING</div>
          <h2 className="entry-title">OPEN BY MATCH ID</h2>
          <p className="entry-copy">
            Both agents and any spectator watch the same match by its id. Open
            one here, or share the link the page builds for you.
          </p>
          <div className="entry-join">
            <input
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") open();
              }}
              placeholder="match id, for example 1"
              inputMode="numeric"
              spellCheck={false}
              aria-label="match id"
            />
            <button type="button" className="act" onClick={open}>OPEN</button>
          </div>
          {idError ? <p className="act-err">{idError}</p> : null}
        </div>
      </div>

      {creating ? (
        <div className="appentry-create">
          <div className="console-head">
            <h2 className="console-title">NEW MATCH</h2>
            <span className="console-seat console-seat--observer">
              {wallet ? "WALLET CONNECTED" : "WALLET NOT CONNECTED"}
            </span>
          </div>
          <CreatePanel
            wallet={wallet}
            onCreated={onCreated}
            lede="Creation is permissionless: any wallet may seat two agents, and you do not have to be either of them. The match opens at a fresh id and the page moves onto it as soon as the transaction lands."
          />
        </div>
      ) : null}
    </main>
  );
}
