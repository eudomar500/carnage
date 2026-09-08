import { useEffect, useState } from "react";
import {
  acceptSinkAddress,
  adjudicate,
  anchorClaim,
  checkReveal,
  commit,
  computeCommitment,
  forceSettle,
  fund,
  proposePrice,
  proposeSinkAddress,
  refundBeforeLock,
  reveal,
} from "../chain/actions";
import { sendClaim, type ClaimGate, type MatchState } from "../chain/contract";
import { confirmationFor } from "../chain/confirm";
import { buildTicket, deriveSalt, parseTicket, primeSalt, type RecoveryTicket } from "../chain/salt";
import { sinkTransferPending, ZERO_ADDRESS, type Role } from "../chain/roles";
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
      say("hashing locally, the secret never leaves this browser...");
      const commitment = computeCommitment(match.match_id, state, salt, wallet);
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

  /**
   * The console only shows this panel once settlement has run, so the seat
   * either has a payout waiting or has nothing left to take. Labelling every
   * non-ready case as "waiting for finalization" contradicted the reason line
   * beside it, which already said the balance was gone.
   *
   * "SETTLEMENT COMPLETE" rather than "FULLY CLAIMED": a zero balance does not
   * always mean the money was withdrawn. An agent labelled FALSE has its whole
   * stake slashed to the counterparty, so it never had anything to claim and
   * nothing was claimed. The escrow panel also uses "FULLY CLAIMED" for the
   * whole pool, and the two would read as the same statement about different
   * things.
   *
   * The other two states cannot reach here today, but they are spelled out so
   * this stays right if the console ever widens what it shows.
   */
  const label = ready
    ? `CLAIM ${formatToken(gate.amount)} ${TOKEN_SYMBOL}`
    : gate.state === "nothing-to-claim"
      ? "SETTLEMENT COMPLETE"
      : gate.state === "not-settled"
        ? "WAITING FOR FINALIZATION"
        : "NOT A PARTY TO THIS MATCH";

  return (
    <div className="panel-form">
      <p className="turn-hint">
        {ready
          ? `The verdict is final. Settlement only runs once adjudication finalizes, so ${formatToken(gate.amount)} ${TOKEN_SYMBOL} is locked in as yours. The transfer itself is released when your claim transaction finalizes.`
          : `${gate.reason}.`}
      </p>
      <ActionButton
        label={label}
        phase={a.phase}
        disabled={!ready}
        onClick={go}
      />
      {payout ? <p className="act-step act-step--muted">{payout}</p> : null}
    </div>
  );
}

// ---- recovery -------------------------------------------------------------

/**
 * Permissionless exit for a match that funded and then stalled before the
 * deal price locked.
 *
 * The console only mounts this once the lock deadline has passed, so the
 * panel itself does not re-gate on the clock. The contract checks block time
 * regardless, and the preflight inside refundBeforeLock surfaces its answer.
 */
export function RefundBeforeLockPanel({ wallet, match, role, refresh }: PanelProps) {
  const a = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("refund_before_lock", role),
    refresh,
  });
  const go = () =>
    a.run(async (say) => {
      say("simulating, then confirm the transaction in your wallet...");
      await refundBeforeLock(wallet, match.match_id);
      return "stakes refunded";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        The two sides funded but never agreed a deal price, and the lock
        deadline has passed. Anyone may trigger the refund: the holder gets
        back {formatToken(match.holder_escrow)} {TOKEN_SYMBOL} and the buyer
        {" "}{formatToken(match.buyer_escrow)} {TOKEN_SYMBOL}, exactly what each
        one funded. Nothing is slashed and nothing goes to the sink, because
        nobody broke a rule here.
      </p>
      <p className="turn-hint turn-hint--muted">
        Refunds are credited as claimable balances, so each side still
        withdraws its own with claim().
      </p>
      <ActionButton label="REFUND STAKES" phase={a.phase} onClick={go} />
    </div>
  );
}

/**
 * Permissionless fallback for a verdict that never got paid out.
 *
 * get_match does not expose adjudicated_at, so this cannot show a countdown.
 * The button is offered whenever a match is adjudicated and unsettled, and
 * the preflight answers with the contract's own "settle grace period has not
 * passed yet" when it is still too early.
 */
export function ForceSettlePanel({ wallet, match, role, refresh }: PanelProps) {
  const a = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("force_settle", role),
    refresh,
  });
  const go = () =>
    a.run(async (say) => {
      say("simulating, then confirm the transaction in your wallet...");
      await forceSettle(wallet, match.match_id);
      return "settlement applied";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        <strong>This only works about 2 hours after adjudication.</strong>{" "}
        Settlement normally runs by itself: adjudicate schedules it for the
        moment that transaction finalizes, which takes a while on this chain.
        Give the automatic path the first go.
      </p>
      <p className="turn-hint turn-hint--muted">
        Press it earlier and nothing is signed or spent: the simulation that
        runs before your wallet opens comes back with the contract's own
        "settle grace period has not passed yet", and the button simply
        re-enables. After the grace period it applies the same stored labels
        through the same settlement rule the automatic path would have used.
      </p>
      <ActionButton label="FORCE SETTLEMENT" phase={a.phase} onClick={go} />
    </div>
  );
}

// ---- protocol sink --------------------------------------------------------

/** Withdraws the sink's own credited balance. Same claim() as a player uses. */
export function SinkClaimPanel({ wallet, match, role, gate, refresh }: PanelProps & { gate: ClaimGate }) {
  const a = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("claim_sink", role),
    refresh,
  });
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
      return "sink balance claimed";
    });

  const ready = gate.state === "ready";
  return (
    <div className="panel-form">
      <p className="turn-hint">
        {ready
          ? `Both sides drew an adverse label, so the slashed portions went to the sink instead of crossing between them. ${formatToken(gate.amount)} ${TOKEN_SYMBOL} is claimable.`
          : `${gate.reason}.`}
      </p>
      <ActionButton
        label={ready ? `CLAIM ${formatToken(gate.amount)} ${TOKEN_SYMBOL}` : "NOTHING TO CLAIM"}
        phase={a.phase}
        disabled={!ready}
        onClick={go}
      />
      {payout ? <p className="act-step act-step--muted">{payout}</p> : null}
    </div>
  );
}

/**
 * The two-step sink handover.
 *
 * One step per wallet: the current sink proposes, and only the proposed
 * address can accept. A mistyped address can never take the role, because it
 * would have to send the acceptance itself.
 */
export function SinkTransferPanel({ wallet, match, role, refresh }: PanelProps) {
  const [next, setNext] = useState("");
  const propose = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("propose_sink", role),
    refresh,
  });
  const accept = useAction({
    matchId: match.match_id,
    confirm: confirmationFor("accept_sink", role),
    refresh,
  });

  const isSink = match.sink_address.toLowerCase() === wallet.toLowerCase();
  const pending = sinkTransferPending(match);
  const isPending = pending && match.pending_sink.toLowerCase() === wallet.toLowerCase();

  /**
   * Once the chain shows the new pending sink, the form goes live again.
   *
   * A confirmed action stays disabled by design, which is right for a step
   * that happens once. Proposing is not that: a sink may overwrite a pending
   * proposal, or cancel it by proposing the zero address, and neither should
   * need a page reload. Resetting on the observed change rather than on the
   * send keeps the button disabled until the result is actually visible.
   */
  useEffect(() => {
    if (propose.phase.kind === "confirmed") {
      propose.reset();
      setNext("");
    }
    // Only the observed pending sink drives this. Depending on the phase too
    // would reset the moment the send confirmed, before anyone could see it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.pending_sink]);

  const doPropose = () =>
    propose.run(async (say) => {
      say("simulating, then confirm the transaction in your wallet...");
      await proposeSinkAddress(wallet, next.trim());
      return "proposal recorded";
    });

  const doAccept = () =>
    accept.run(async (say) => {
      say("simulating, then confirm the transaction in your wallet...");
      await acceptSinkAddress(wallet);
      return "sink role accepted";
    });

  return (
    <div className="panel-form">
      <p className="turn-hint">
        The sink holds what both-lie settlements forfeit. Handing it over takes
        two transactions from two wallets: the current sink proposes, and the
        proposed address accepts. The role does not move until it does.
      </p>

      <div className="sink-facts">
        <p className="turn-hint turn-hint--muted">
          current sink: <code>{match.sink_address}</code>
        </p>
        <p className="turn-hint turn-hint--muted">
          {pending
            ? <>pending: <code>{match.pending_sink}</code>, waiting for that address to accept</>
            : "no transfer pending"}
        </p>
      </div>

      {isSink ? (
        <>
          <label className="form-row form-row--wide">
            <span>new sink address</span>
            <input
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="0x..."
              spellCheck={false}
            />
          </label>
          <p className="turn-hint turn-hint--muted">
            Proposing the zero address ({ZERO_ADDRESS}) cancels a pending
            transfer.
          </p>
          <ActionButton
            label="PROPOSE SINK TRANSFER"
            phase={propose.phase}
            disabled={!next.trim()}
            onClick={doPropose}
          />
        </>
      ) : null}

      {isPending ? (
        <>
          <p className="turn-hint">
            This wallet is the pending sink. Accepting completes the handover
            and clears the pending slot, so the same acceptance cannot be
            replayed later.
          </p>
          <ActionButton label="ACCEPT SINK ROLE" phase={accept.phase} onClick={doAccept} />
        </>
      ) : null}
    </div>
  );
}
