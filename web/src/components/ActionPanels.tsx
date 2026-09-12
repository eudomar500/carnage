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
import { forceSettleGate, formatWait } from "../chain/grace";
import { noteSinkTarget } from "../chain/journal";
import { deriveSalt } from "../chain/salt";
import { sinkTransferPending, ZERO_ADDRESS, type Role } from "../chain/roles";
import { useAction } from "../hooks/useAction";
import { useNowSeconds } from "../hooks/useNowSeconds";
import ActionButton from "./ActionButton";
import InFlightNotice from "./InFlight";
import { formatToken, TOKEN_SYMBOL } from "../lib/format";

export type PanelProps = {
  wallet: `0x${string}`;
  match: MatchState;
  role: Role;
  /** Re-reads the match; the confirmation watcher drives the page from this. */
  refresh: () => Promise<MatchState | null>;
};

const SIGN_NOTE = "sign the salt message in your wallet; this is not a transaction";

/** Epoch seconds as the same trimmed ISO stamp the console uses elsewhere. */
const isoSeconds = (s: number) =>
  new Date(s * 1000).toISOString().replace(".000Z", "Z");

// ---- commit ---------------------------------------------------------------

export function CommitPanel({ wallet, match, role, refresh }: PanelProps) {
  const field = role === "holder" ? "minimum_price" : "maximum_budget";
  const blurb =
    role === "holder"
      ? "the lowest price you would truly accept"
      : "the highest price you could truly pay";
  const [value, setValue] = useState("");
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("commit", role), refresh });

  const go = () =>
    a.run(async (say, sent) => {
      const state = BigInt(value);
      say(SIGN_NOTE);
      const salt = await deriveSalt(match.match_id, role, wallet);
      say("hashing locally, the secret never leaves this browser...");
      const commitment = computeCommitment(match.match_id, state, salt, wallet);
      say("simulating, then confirm the transaction in your wallet...");
      await commit(wallet, match.match_id, role, commitment, { onSubmitted: sent });
      return "commitment sealed on-chain";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Enter your private constraint: {blurb}. Only a salted hash goes
        on-chain, and nothing about it is stored anywhere. At reveal time your
        salt comes back by signing the same message again, so the number itself
        is the only thing you need to remember.
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
            disabled={a.busy}
          />
        </label>
      </div>
      <ActionButton
        label={`COMMIT ${field.toUpperCase()}`}
        phase={a.phase}
        disabled={!value}
        hash={a.hash}
        onClick={go}
      />
    </div>
  );
}

// ---- fund -----------------------------------------------------------------

export function FundPanel({ wallet, match, role, refresh }: PanelProps) {
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("fund", role), refresh });
  const go = () =>
    a.run(async (say, sent) => {
      say("confirm the transaction in your wallet...");
      await fund(wallet, match.match_id, role, match.stake_amount, { onSubmitted: sent });
      return "stake deposited";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Deposits exactly {formatToken(match.stake_amount)} {TOKEN_SYMBOL} into
        escrow. This transaction carries value, so your wallet will show the amount.
      </p>
      <ActionButton
        label={`FUND ${formatToken(match.stake_amount)} ${TOKEN_SYMBOL}`}
        phase={a.phase}
        hash={a.hash}
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
    a.run(async (say, sent) => {
      say("simulating, then confirm the transaction in your wallet...");
      await anchorClaim(wallet, match.match_id, role, text.trim(), { onSubmitted: sent });
      return "claim anchored";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

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
        disabled={a.busy}
      />
      <div className="char-count">{text.length} / 2000</div>
      <ActionButton
        label="ANCHOR CLAIM"
        phase={a.phase}
        disabled={!text.trim()}
        hash={a.hash}
        onClick={go}
      />
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
    a.run(async (say, sent) => {
      say("simulating, then confirm the transaction in your wallet...");
      await proposePrice(wallet, match.match_id, role, BigInt(price), { onSubmitted: sent });
      return "price proposed";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="panel-form">
      <p className="turn-hint">
        The deal price is agreed off-chain. Settle on a number with your
        counterparty first, in chat or wherever you are negotiating: the
        contract never suggests one, it only records what the two of you
        already agreed.
      </p>
      <p className="turn-hint">
        The price locks only when both sides propose the same number. Must sit
        inside the band {`${match.price_floor}`}-{`${match.price_ceil}`}.
        {counterparty > 0n ? (
          <> The counterparty has proposed <strong>{`${counterparty}`}</strong>.</>
        ) : (
          <> The counterparty has not proposed yet.</>
        )}
      </p>
      {/*
        The window closes, and nothing else on this panel said so. A player
        could sit here past the deadline and only find out from a revert.
      */}
      <p className="turn-hint turn-hint--muted">
        Proposals are refused at or after lock_deadline,{" "}
        <strong>{isoSeconds(Number(match.lock_deadline))}</strong>, which sits a
        full reveal window before reveal_deadline.
      </p>
      <div className="form-grid">
        <label className="form-row form-row--wide">
          <span>deal price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={counterparty > 0n ? `${counterparty}` : "750"}
            disabled={a.busy}
          />
        </label>
      </div>
      <ActionButton
        label="PROPOSE PRICE"
        phase={a.phase}
        disabled={!price}
        hash={a.hash}
        onClick={go}
      />
    </div>
  );
}

// ---- reveal ---------------------------------------------------------------

export function RevealPanel({ wallet, match, role, refresh }: PanelProps) {
  const field = role === "holder" ? "minimum_price" : "maximum_budget";
  const [value, setValue] = useState("");
  const a = useAction({ matchId: match.match_id, confirm: confirmationFor("reveal", role), refresh });

  const go = () =>
    a.run(async (say, sent) => {
      const state = BigInt(value);
      say(SIGN_NOTE);
      const salt = await deriveSalt(match.match_id, role, wallet);

      say("dry-running the reveal against your stored commitment...");
      await checkReveal(wallet, match.match_id, role, state, salt);

      say("match confirmed; confirm the transaction in your wallet...");
      await reveal(wallet, match.match_id, role, state, salt, { onSubmitted: sent });
      return "constraint revealed";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="panel-form">
      <p className="turn-hint">
        Re-enter the {field} you committed. Your salt is regenerated by signing
        the same message as before; nothing was stored. The value is dry-run
        against your commitment first, so a wrong number costs no gas.
      </p>
      <div className="form-grid">
        <label className="form-row form-row--wide">
          <span>{field}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="the number you committed"
            autoComplete="off"
            disabled={a.busy}
          />
        </label>
      </div>
      <ActionButton
        label="REVEAL CONSTRAINT"
        phase={a.phase}
        disabled={!value}
        hash={a.hash}
        onClick={go}
      />
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
    a.run(async (say, sent) => {
      say("confirm in your wallet; the jury runs on-chain, this is slow...");
      await adjudicate(wallet, match.match_id, {
        onSubmitted: (hash) => {
          sent(hash);
          // The wait for acceptance alone runs to six minutes on this step.
          // Leaving the wallet prompt on screen for all of it reads as a
          // stuck panel, so the note moves on once the round is out.
          say("jury round submitted, waiting for the validators to return...");
        },
      });
      return "verdict recorded on-chain";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

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
      <ActionButton label="SUMMON THE JURY" phase={a.phase} hash={a.hash} onClick={go} />
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
    a.run(async (say, sent) => {
      say("confirm the transaction in your wallet...");
      await sendClaim(
        match.match_id,
        wallet,
        (stage) =>
          setPayout(
            stage === "accepted"
              ? "claim accepted; the GEN is released when this transaction finalizes"
              : "payout finalized; the GEN has left escrow",
          ),
        sent,
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

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

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
        hash={a.hash}
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
    a.run(async (say, sent) => {
      say("simulating, then confirm the transaction in your wallet...");
      await refundBeforeLock(wallet, match.match_id, { onSubmitted: sent });
      return "stakes refunded";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="panel-form">
      <p className="turn-hint">
        The price never locked and the lock deadline has passed. Anyone may
        trigger the refund: each side gets back exactly what it funded, the
        holder {formatToken(match.holder_escrow)} {TOKEN_SYMBOL} and the buyer
        {" "}{formatToken(match.buyer_escrow)} {TOKEN_SYMBOL}. Nothing is
        slashed and nothing goes to the sink, because nobody broke a rule here.
      </p>
      <p className="turn-hint turn-hint--muted">
        Refunds are credited as claimable balances, so each side still
        withdraws its own with claim().
      </p>
      <ActionButton label="REFUND STAKES" phase={a.phase} hash={a.hash} onClick={go} />
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
  const now = useNowSeconds();
  // The estimate can only ever be too cautious, so there has to be a way past
  // it for a verdict that was recorded before this browser ever saw the match.
  const [override, setOverride] = useState(false);
  const gate = forceSettleGate(match, now);
  const held = gate.state === "waiting" && !override;
  const wait = gate.state === "waiting" ? formatWait(gate.secondsLeft) : "";
  const go = () =>
    a.run(async (say, sent) => {
      say("simulating, then confirm the transaction in your wallet...");
      await forceSettle(wallet, match.match_id, { onSubmitted: sent });
      return "settlement applied";
    });

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

  return (
    <div className="panel-form">
      <p className="turn-hint">
        <strong>This only works about 2 hours after adjudication.</strong>{" "}
        Settlement normally runs by itself: adjudicate schedules it for the
        moment that transaction finalizes, which takes a while on this chain.
        Give the automatic path the first go.
      </p>

      {gate.state === "waiting" ? (
        <p className="turn-hint turn-hint--muted">
          This browser first saw the verdict at{" "}
          <strong>{isoSeconds(gate.observedAt)}</strong>, so the fallback should
          open in {wait}. That is an estimate, not the contract's clock:
          get_match does not publish adjudicated_at, so the count starts from
          the first time this browser saw the match sitting adjudicated and
          unsettled. If the verdict landed while this page was closed, the real
          wait is shorter than what is shown here.
        </p>
      ) : null}

      <ActionButton
        label={held ? `AVAILABLE IN ${wait.toUpperCase()}` : "FORCE SETTLEMENT"}
        phase={a.phase}
        disabled={held}
        hash={a.hash}
        onClick={go}
      />

      {held ? (
        <button className="linkish" onClick={() => setOverride(true)}>
          the verdict is older than that, let me try anyway
        </button>
      ) : null}

      <p className="turn-hint turn-hint--muted">
        Nothing is signed or spent by trying too early: the simulation that runs
        before your wallet opens comes back with the contract's own "settle
        grace period has not passed yet", and the button simply re-enables.
        After the grace period it applies the same stored labels through the
        same settlement rule the automatic path would have used.
      </p>
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
    a.run(async (say, sent) => {
      say("confirm the transaction in your wallet...");
      await sendClaim(
        match.match_id,
        wallet,
        (stage) =>
          setPayout(
            stage === "accepted"
              ? "claim accepted; the GEN is released when this transaction finalizes"
              : "payout finalized; the GEN has left escrow",
          ),
        sent,
      );
      return "sink balance claimed";
    });

  const ready = gate.state === "ready";

  if (a.inFlight) return <InFlightNotice inFlight={a.inFlight} onDismiss={a.dismiss} />;

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
        hash={a.hash}
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
    propose.run(async (say, sent) => {
      const target = next.trim();
      // Written before the send, so a tab that navigates away mid-proposal
      // still leaves the app-level sweep something it can recognise as landed.
      noteSinkTarget(match.match_id, "propose_sink", target);
      say("simulating, then confirm the transaction in your wallet...");
      await proposeSinkAddress(wallet, target, { onSubmitted: sent });
      return "proposal recorded";
    });

  const doAccept = () =>
    accept.run(async (say, sent) => {
      say("simulating, then confirm the transaction in your wallet...");
      await acceptSinkAddress(wallet, { onSubmitted: sent });
      return "sink role accepted";
    });

  // Two actions share this panel, so whichever of them is out takes it over.
  const out = propose.inFlight ? propose : accept.inFlight ? accept : null;
  if (out?.inFlight) {
    return <InFlightNotice inFlight={out.inFlight} onDismiss={out.dismiss} />;
  }

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
              disabled={propose.busy}
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
            hash={propose.hash}
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
          <ActionButton
            label="ACCEPT SINK ROLE"
            phase={accept.phase}
            hash={accept.hash}
            onClick={doAccept}
          />
        </>
      ) : null}
    </div>
  );
}
