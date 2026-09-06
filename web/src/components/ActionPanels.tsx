import { useState } from "react";
import {
  adjudicate,
  anchorClaim,
  checkReveal,
  commit,
  computeCommitment,
  fund,
  proposePrice,
  reveal,
} from "../chain/actions";
import { sendClaim, type ClaimGate, type MatchState } from "../chain/contract";
import { confirmationFor } from "../chain/confirm";
import { buildTicket, deriveSalt, parseTicket, primeSalt, type RecoveryTicket } from "../chain/salt";
import type { Role } from "../chain/roles";
import { useAction } from "../hooks/useAction";
import ActionButton from "./ActionButton";
import { formatToken, TOKEN_SYMBOL } from "../lib/format";

export type PanelProps = {
  wallet: `0x${string}`;
  match: MatchState;
  role: Role;
  /** Re-reads the match; the confirmation watcher drives the page from this. */
  refresh: () => Promise<MatchState | null>;
};

const SIGN_NOTE = "sign the salt message in your wallet; this is not a transaction";

// ---- commit ---------------------------------------------------------------

export function CommitPanel({ wallet, match, role, refresh }: PanelProps) {
  const field = role === "holder" ? "minimum_price" : "maximum_budget";
  const blurb =
    role === "holder"
      ? "the lowest price you would truly accept"
      : "the highest price you could truly pay";
  const [value, setValue] = useState("");
  const [ticket, setTicket] = useState<RecoveryTicket | null>(null);
  const [copied, setCopied] = useState(false);
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("commit", role), refresh });

  const go = () =>
    a.run(async (say) => {
      const state = BigInt(value);
      say(SIGN_NOTE);
      const salt = await deriveSalt(match.match_id, role, wallet);
      say("hashing through the contract's compute_commitment...");
      const commitment = await computeCommitment(match.match_id, state, salt, wallet);
      say("simulating, then confirm the transaction in your wallet...");
      await commit(wallet, match.match_id, role, commitment);
      setTicket(buildTicket(match.match_id, role, wallet, state, salt));
      return "commitment sealed on-chain";
    });

  const json = ticket ? JSON.stringify(ticket, null, 2) : "";

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Enter your private constraint: {blurb}. Only a salted hash goes on-chain.
      </p>
      <div className="form-grid">
        <label className="form-row form-row--wide">
          <span>{field}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={`between ${match.price_floor} and ${match.price_ceil}`}
            autoComplete="off"
          />
        </label>
      </div>
      <ActionButton
        label={`COMMIT ${field.toUpperCase()}`}
        phase={a.phase}
        disabled={!value}
        onClick={go}
      />
      {ticket ? (
        <>
          <p className="turn-hint">
            Optional backup. Your salt regenerates from a wallet signature at
            reveal time, so this file is only insurance.
          </p>
          <pre className="ticket">{json}</pre>
          <div className="act-row">
            <button
              className="act"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
                const el = document.createElement("a");
                el.href = url;
                el.download = `carnage-reveal-m${match.match_id}-${role}.json`;
                el.click();
                URL.revokeObjectURL(url);
              }}
            >
              DOWNLOAD TICKET
            </button>
            <button
              className="act"
              onClick={() => {
                navigator.clipboard?.writeText(json);
                setCopied(true);
              }}
            >
              {copied ? "COPIED" : "COPY"}
            </button>
            <button className="act" onClick={() => setTicket(null)}>DISMISS</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---- fund -----------------------------------------------------------------

export function FundPanel({ wallet, match, role, refresh }: PanelProps) {
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("fund", role), refresh });
  const go = () =>
    a.run(async (say) => {
      say("confirm the transaction in your wallet...");
      await fund(wallet, match.match_id, role, match.stake_amount);
      return "stake deposited";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Deposits exactly {formatToken(match.stake_amount)} {TOKEN_SYMBOL} into
        escrow. This transaction carries value, so your wallet will show the amount.
      </p>
      <ActionButton
        label={`FUND ${formatToken(match.stake_amount)} ${TOKEN_SYMBOL}`}
        phase={a.phase}
        onClick={go}
      />
    </div>
  );
}

// ---- anchor claim ---------------------------------------------------------

export function AnchorClaimPanel({ wallet, match, role, refresh }: PanelProps) {
  const [text, setText] = useState("");
  const a = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("anchor_claim", role),
    refresh,
  });
  const go = () =>
    a.run(async (say) => {
      say("simulating, then confirm the transaction in your wallet...");
      await anchorClaim(wallet, match.match_id, role, text.trim());
      return "claim anchored";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        The natural-language claim the jury will judge against your revealed
        constraint. Public the moment it lands. Max 2000 characters.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder={role === "holder" ? "I can't go below 780." : "My maximum budget is 900."}
      />
      <div className="char-count">{text.length} / 2000</div>
      <ActionButton label="ANCHOR CLAIM" phase={a.phase} disabled={!text.trim()} onClick={go} />
    </div>
  );
}

// ---- propose price --------------------------------------------------------

export function ProposePricePanel({ wallet, match, role, refresh }: PanelProps) {
  const [price, setPrice] = useState("");
  const a = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("propose_price", role),
    refresh,
  });
  const counterparty = role === "holder" ? match.buyer_proposed_price : match.holder_proposed_price;
  const go = () =>
    a.run(async (say) => {
      say("simulating, then confirm the transaction in your wallet...");
      await proposePrice(wallet, match.match_id, role, BigInt(price));
      return "price proposed";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        The price locks only when both sides propose the same number. Must sit
        inside the band {`${match.price_floor}`}-{`${match.price_ceil}`}.
        {counterparty > 0n ? (
          <> The counterparty has proposed <strong>{`${counterparty}`}</strong>.</>
        ) : (
          <> The counterparty has not proposed yet.</>
        )}
      </p>
      <div className="form-grid">
        <label className="form-row form-row--wide">
          <span>deal price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={counterparty > 0n ? `${counterparty}` : "750"}
          />
        </label>
      </div>
      <ActionButton label="PROPOSE PRICE" phase={a.phase} disabled={!price} onClick={go} />
    </div>
  );
}

// ---- reveal ---------------------------------------------------------------

export function RevealPanel({ wallet, match, role, refresh }: PanelProps) {
  const field = role === "holder" ? "minimum_price" : "maximum_budget";
  const [value, setValue] = useState("");
  const [ticketText, setTicketText] = useState("");
  const [showTicket, setShowTicket] = useState(false);
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("reveal", role), refresh });

  const go = () =>
    a.run(async (say) => {
      let state: bigint;
      let salt: `0x${string}`;

      if (showTicket && ticketText.trim()) {
        const t = parseTicket(ticketText.trim());
        state = BigInt(t.state);
        salt = t.salt;
        primeSalt(match.match_id, role, wallet, salt);
      } else {
        state = BigInt(value);
        say(SIGN_NOTE);
        salt = await deriveSalt(match.match_id, role, wallet);
      }

      say("dry-running the reveal against your stored commitment...");
      await checkReveal(wallet, match.match_id, role, state, salt);

      say("match confirmed; confirm the transaction in your wallet...");
      await reveal(wallet, match.match_id, role, state, salt);
      return "constraint revealed";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Re-enter the {field} you committed. Your salt is regenerated by signing
        the same message as before; nothing was stored. The value is dry-run
        against your commitment first, so a wrong number costs no gas.
      </p>
      {showTicket ? (
        <textarea
          value={ticketText}
          onChange={(e) => setTicketText(e.target.value)}
          rows={5}
          placeholder="paste your recovery ticket JSON here"
        />
      ) : (
        <div className="form-grid">
          <label className="form-row form-row--wide">
            <span>{field}</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="the number you committed"
              autoComplete="off"
            />
          </label>
        </div>
      )}
      <ActionButton
        label="REVEAL CONSTRAINT"
        phase={a.phase}
        disabled={showTicket ? !ticketText.trim() : !value}
        onClick={go}
      />
      <button className="linkish" onClick={() => setShowTicket((v) => !v)}>
        {showTicket ? "<- re-sign instead" : "use a recovery ticket instead"}
      </button>
    </div>
  );
}

// ---- adjudicate -----------------------------------------------------------

export function AdjudicatePanel({
  wallet,
  match,
  role,
  refresh,
}: {
  wallet: `0x${string}`;
  match: MatchState;
  role: Role;
  refresh: () => Promise<MatchState | null>;
}) {
  const a = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("adjudicate", role),
    refresh,
  });
  const go = () =>
    a.run(async (say) => {
      say("confirm in your wallet; the jury runs on-chain, this is slow...");
      await adjudicate(wallet, match.match_id);
      return "verdict recorded on-chain";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Permissionless: anyone may summon the jury. Validators independently
        classify both claims against the revealed evidence, so this takes
        noticeably longer than an ordinary transaction. Settlement is scheduled
        automatically once this finalizes.
      </p>
      <p className="turn-hint turn-hint--muted">
        A jury round can end without writing a verdict, either because the
        leader timed out or because the validators did not converge. Nothing is
        spent from escrow when that happens, and this step stays open so it can
        be summoned again.
      </p>
      <ActionButton label="SUMMON THE JURY" phase={a.phase} onClick={go} />
    </div>
  );
}

// ---- claim ----------------------------------------------------------------

export function ClaimActionPanel({
  wallet,
  match,
  role,
  gate,
  refresh,
}: {
  wallet: `0x${string}`;
  match: MatchState;
  role: Role;
  gate: ClaimGate;
  refresh: () => Promise<MatchState | null>;
}) {
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("claim", role), refresh });
  const [payout, setPayout] = useState<string | null>(null);
  const go = () =>
    a.run(async (say) => {
      say("confirm the transaction in your wallet...");
      await sendClaim(match.match_id, wallet, (stage) =>
        setPayout(
          stage === "accepted"
            ? "claim accepted; the GEN is released when this transaction finalizes"
            : "payout finalized; the GEN has left escrow",
        ),
      );
      return "claim recorded";
    });

  const ready = gate.state === "ready";
  return (
    <div className="panel-form">
      <p className="turn-hint">
        {ready
          ? `The verdict is final. Settlement only runs once adjudication finalizes, so ${formatToken(gate.amount)} ${TOKEN_SYMBOL} is locked in as yours. The transfer itself is released when your claim transaction finalizes.`
          : `${gate.reason}.`}
      </p>
      <ActionButton
        label={ready ? `CLAIM ${formatToken(gate.amount)} ${TOKEN_SYMBOL}` : "WAITING FOR FINALIZATION"}
        phase={a.phase}
        disabled={!ready}
        onClick={go}
      />
      {payout ? <p className="act-step act-step--muted">{payout}</p> : null}
    </div>
  );
}
