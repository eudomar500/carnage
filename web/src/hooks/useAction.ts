import { useCallback, useEffect, useRef, useState } from "react";
import type { Confirmation } from "../chain/confirm";
import type { MatchState } from "../chain/contract";
import { classifyFailure } from "../chain/errors";
import {
  clearAttempt,
  noteHash,
  readAttempt,
  subscribe,
  writeAttempt,
  type Attempt,
} from "../chain/journal";
import type { ActionId } from "../chain/roles";
import { readTxVerdict } from "../chain/txstate";

/**
 * Where one action currently stands.
 *
 * `confirmed` is the only success state, and it means the state change was
 * observed in get_match. There is deliberately no phase for "the transaction
 * was accepted", because that told us nothing useful and reporting it as
 * success is what stranded match 2.
 */
export type ActionPhase =
  | { kind: "idle" }
  | { kind: "submitting"; note: string }
  | { kind: "pending"; note: string }
  | { kind: "confirmed"; note: string }
  | { kind: "failed"; note: string; retryLabel: string }
  | { kind: "unconfirmed"; note: string; retryLabel: string }
  /**
   * The transaction is terminal on-chain and the change never appeared.
   *
   * Not a timeout. The chain has answered, the answer is no, and the step is
   * open again. The hash rides along so the message can point at the round
   * that was thrown away even after its journal record is gone.
   */
  | { kind: "discarded"; note: string; retryLabel: string; hash: string | null };

/**
 * An attempt this page did not start, picked up from the journal.
 *
 * Only ever set for a record left behind by an earlier page load or a second
 * tab. An action started in this session does not produce one, because the
 * user is already watching it happen and the form they filled in is still on
 * screen where they left it.
 */
export type InFlight = {
  actionId: ActionId;
  /** Null when the wallet never handed a hash back before the page went away. */
  hash: string | null;
  /** Epoch ms at which the attempt was first submitted. */
  startedAt: number;
};

export type ActionRunner = {
  phase: ActionPhase;
  /** True whenever a send or a confirmation watch is in flight. */
  busy: boolean;
  /** Non-null while an attempt recovered from the journal is being watched. */
  inFlight: InFlight | null;
  /** The current attempt's transaction hash, once there is one. */
  hash: string | null;
  run: (
    fn: (say: (note: string) => void, sent: (hash: string) => void) => Promise<string>,
  ) => Promise<void>;
  reset: () => void;
  /** Gives up on a recovered attempt the user has decided is dead. */
  dismiss: () => void;
};

export type ActionOptions = {
  matchId: bigint | number;
  confirm: Confirmation;
  /** Re-reads the match and hands back what it read. */
  refresh?: () => Promise<MatchState | null>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How long a journaled attempt is treated as still alive after a reload.
 *
 * Deliberately far longer than the in-session watch window. Once the page has
 * been reloaded there is a recorded hash and an explorer to check it against,
 * so waiting costs nothing; putting the button back under a transaction that
 * is merely slow is the move that costs something. Bradbury takes minutes when
 * the validator set is being shuffled, and 90 seconds of patience is not an
 * honest answer to that.
 */
export const RESUME_BUDGET_MS = 30 * 60_000;

/**
 * Minimum gap between two reads of the transaction's own status.
 *
 * The state poll already runs at the confirmation's own cadence; this rides
 * alongside it and there is no reason for both to run at the same rate.
 */
const TX_CHECK_MS = 10_000;

/**
 * The journaled attempt worth resuming, read straight from storage.
 *
 * This runs during the first render rather than in an effect, and that is the
 * whole point. The old code consulted the journal only after mount and after
 * an await on get_match, so the first paint following a refresh was an idle
 * button over a live transaction: exactly the screen that makes a user think
 * their commit failed and send it again.
 */
function resumable(opts: ActionOptions): Attempt | null {
  const prior = readAttempt(opts.matchId, opts.confirm.actionId);
  if (!prior || prior.outcome !== "pending") return null;
  if (Date.now() - prior.startedAt >= RESUME_BUDGET_MS) return null;
  return prior;
}

/**
 * Drives one action from click to confirmed state change.
 *
 * The sequence is: disable on click -> check the change has not already
 * landed -> submit -> watch get_match until the declared postcondition holds
 * or the window closes. A step is only ever re-enabled from `failed` (we know
 * nothing was sent) or `unconfirmed` (we waited and the change never
 * appeared). It is never re-enabled while a transaction may still be in
 * flight, which is the whole point.
 */
export function useAction(opts: ActionOptions): ActionRunner {
  // Read once, at first render. See resumable() above for why this cannot
  // wait for an effect.
  const [journaled] = useState<Attempt | null>(() => resumable(opts));

  const [phase, setPhase] = useState<ActionPhase>(() =>
    journaled ? { kind: "pending", note: opts.confirm.pendingNote } : { kind: "idle" },
  );
  const [inFlight, setInFlight] = useState<InFlight | null>(() =>
    journaled
      ? {
          actionId: opts.confirm.actionId,
          hash: journaled.hash ?? null,
          startedAt: journaled.startedAt,
        }
      : null,
  );
  const [hash, setHash] = useState<string | null>(journaled?.hash ?? null);

  const alive = useRef(false);
  /**
   * Which attempt owns the hook right now.
   *
   * Bumped by every run and by every dismiss, so a watch loop that is asleep
   * between polls can tell on waking that it has been superseded and must not
   * write state belonging to somebody else's attempt.
   */
  const gen = useRef(0);
  /**
   * The generation that is currently driving the hook, and whether that work
   * is an interactive send or a watch resumed from the journal. Zero means
   * nobody is driving anything.
   *
   * This used to be a bare `running` boolean, and a boolean cannot say whose
   * work it describes. A watch superseded while it was asleep left the flag
   * raised, because the only place that lowered it was guarded on the
   * generation still matching and it no longer did. From that moment the hook
   * believed an attempt was in progress for the rest of the mount: the resume
   * effect refused to start a replacement watch, and the journal listener
   * refused to retire the notice when the sweep cleared the record. Those two
   * together are what left an in-flight notice on screen after the claim had
   * already landed, with only a manual reload to take it down.
   *
   * Ownership keyed to a generation cannot get stuck. A superseded owner stops
   * counting as busy the moment it is superseded, and it only ever releases
   * the slot it took itself, so it cannot lower a flag belonging to somebody
   * else either.
   */
  const owner = useRef(0);
  const ownerKind = useRef<"send" | "resume" | null>(null);
  const hashRef = useRef<string | null>(journaled?.hash ?? null);
  const latest = useRef(opts);
  /** Mirrors `inFlight` so the journal listener can read it without a closure. */
  const inFlightRef = useRef<InFlight | null>(inFlight);
  // Synced after render rather than during it. Nothing reads these until a
  // click, a timer or a journal change fires, all of which happen after
  // effects have flushed.
  useEffect(() => {
    latest.current = opts;
    inFlightRef.current = inFlight;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Whether the generation holding the hook is still the current one. */
  const driving = useCallback(() => owner.current !== 0 && owner.current === gen.current, []);

  /** Takes the hook for `myGen`. The caller has already checked `driving`. */
  const take = useCallback((myGen: number, kind: "send" | "resume") => {
    owner.current = myGen;
    ownerKind.current = kind;
  }, []);

  /** Releases the hook, but only from the generation that actually took it. */
  const release = useCallback((myGen: number) => {
    if (owner.current !== myGen) return;
    owner.current = 0;
    ownerKind.current = null;
  }, []);

  const set = useCallback((next: ActionPhase) => {
    if (alive.current) setPhase(next);
  }, []);

  /** A read failure here is not the action failing, so it never throws. */
  const readState = useCallback(async (): Promise<MatchState | null> => {
    const refresh = latest.current.refresh;
    if (!refresh) return null;
    try {
      return await refresh();
    } catch {
      return null;
    }
  }, []);

  /**
   * Whether the transaction behind an attempt has already answered.
   *
   * Throttled, because this is a second RPC alongside the state poll and the
   * node rate limits. A transaction cannot be terminal in the first seconds
   * anyway, so nothing is lost by asking less often than we read state.
   */
  const isDead = useCallback(
    async (c: Confirmation, hash: string | null): Promise<boolean> => {
      if (!hash) return false;
      const verdict = await readTxVerdict(hash);
      if (!verdict?.terminal) return false;
      // The change may have landed between the state read and this one, so
      // never call an attempt dead without looking at state one more time.
      const after = await readState();
      if (after && c.landed && c.landed(after)) return false;
      return true;
    },
    [readState],
  );

  const awaitLanding = useCallback(
    async (
      c: Confirmation,
      deadline: number,
      mine: () => boolean,
    ): Promise<"landed" | "discarded" | "timeout"> => {
      if (!c.landed) return "landed";
      let nextTxCheck = Date.now() + TX_CHECK_MS;
      for (;;) {
        if (!mine()) return "timeout";
        const m = await readState();
        if (!mine()) return "timeout";
        if (m && c.landed(m)) return "landed";

        // The change is not there. Ask whether the transaction that was meant
        // to produce it is still capable of doing so. Once it is terminal,
        // waiting out the rest of the window only delays reopening the step.
        if (Date.now() >= nextTxCheck) {
          nextTxCheck = Date.now() + TX_CHECK_MS;
          const dead = await isDead(c, hashRef.current);
          if (!mine()) return "timeout";
          if (dead) return "discarded";
        }

        const left = deadline - Date.now();
        if (left <= 0) break;
        set({ kind: "pending", note: `${c.pendingNote} (${Math.ceil(left / 1000)}s left)` });
        await sleep(Math.min(c.pollMs, left));
      }
      if (!mine()) return "timeout";
      // One last look: the change may have landed during the final sleep.
      const last = await readState();
      if (last && c.landed(last)) return "landed";
      return (await isDead(c, hashRef.current)) ? "discarded" : "timeout";
    },
    [isDead, readState, set],
  );

  /**
   * Drops the journal record and reopens the step.
   *
   * This is the whole point of the terminal check. A record left behind by a
   * round the chain threw away used to sit in storage until the resume budget
   * expired, or until somebody cleared localStorage by hand, and the button
   * stayed dead the entire time.
   */
  const markDiscarded = useCallback(
    (c: Confirmation, matchId: bigint | number) => {
      clearAttempt(matchId, c.actionId);
      setInFlight(null);
      set({
        kind: "discarded",
        note: c.discardedNote,
        retryLabel: c.retryLabel,
        hash: hashRef.current,
      });
    },
    [set],
  );

  const settle = useCallback(
    async (
      c: Confirmation,
      matchId: bigint | number,
      successNote: string,
      mine: () => boolean,
    ) => {
      set({ kind: "pending", note: c.pendingNote });
      const outcome = await awaitLanding(c, Date.now() + c.windowMs, mine);
      if (!mine()) return;
      if (outcome === "landed") {
        clearAttempt(matchId, c.actionId);
        setInFlight(null);
        set({ kind: "confirmed", note: successNote });
        return;
      }
      if (outcome === "discarded") {
        markDiscarded(c, matchId);
        return;
      }
      writeAttempt(matchId, c.actionId, "unconfirmed", undefined, hashRef.current ?? undefined);
      set({ kind: "unconfirmed", note: c.unconfirmedNote, retryLabel: c.retryLabel });
    },
    [awaitLanding, markDiscarded, set],
  );

  const run = useCallback(
    async (
      fn: (say: (note: string) => void, sent: (hash: string) => void) => Promise<string>,
    ) => {
      if (driving()) return;
      const myGen = ++gen.current;
      const mine = () => alive.current && gen.current === myGen;
      take(myGen, "send");

      const { matchId, confirm } = latest.current;
      // A retry is a new attempt. Anything the last one left behind, including
      // its hash and its recovered in-flight notice, belongs to that one.
      hashRef.current = null;
      setHash(null);
      setInFlight(null);
      // Disabled on the click itself, before the first await.
      set({ kind: "submitting", note: "checking preconditions..." });

      const sent = (h: string) => {
        if (gen.current !== myGen) return;
        hashRef.current = h;
        noteHash(matchId, confirm.actionId, h);
        if (alive.current) setHash(h);
      };

      try {
        // If the change is already on-chain there is nothing to send. This is
        // what keeps a permissionless action safe to retry: whoever got there
        // first wins and the second caller spends nothing.
        if (confirm.landed) {
          const before = await readState();
          if (!mine()) return;
          if (before && confirm.landed(before)) {
            clearAttempt(matchId, confirm.actionId);
            set({ kind: "confirmed", note: `${confirm.confirmedNote} (already on-chain)` });
            return;
          }
        }

        writeAttempt(matchId, confirm.actionId, "pending");

        let note: string;
        try {
          note = await fn((n) => {
            if (mine()) set({ kind: "submitting", note: n });
          }, sent);
        } catch (err) {
          const failure = classifyFailure(err);
          if (!mine()) return;
          // With no postcondition there is nothing to check state against, so
          // a throw is the final word rather than something to watch out.
          if (failure.nothingSent || !confirm.landed) {
            // Nothing reached the network, so there is no attempt to recover
            // and no reason for the next page load to say there is.
            clearAttempt(matchId, confirm.actionId);
            set({ kind: "failed", note: failure.message, retryLabel: confirm.retryLabel });
            return;
          }
          // The transaction reached the network and we lost sight of it. The
          // only honest move is to go and look at contract state.
          await settle(confirm, matchId, confirm.confirmedNote, mine);
          return;
        }

        if (!mine()) return;
        await settle(confirm, matchId, note, mine);
      } finally {
        // Released whether or not this attempt was superseded along the way.
        // Guarding this on the generation still matching is what used to pin
        // the hook busy forever once anything bumped it.
        release(myGen);
      }
    },
    [driving, readState, release, set, settle, take],
  );

  /**
   * Picks an attempt back up after a reload or in a second tab.
   *
   * Contract state cannot distinguish "nobody has tried yet" from "a round was
   * fired and discarded", so the journal supplies that. The first render has
   * already put the in-flight state on screen from the record alone; this is
   * what checks it against the chain and takes it back down again.
   *
   * Three outcomes, in order. The change is already visible, so the record is
   * dropped and the confirmed state shown. Or it is not visible and the
   * attempt is still inside its budget, so the watch resumes. Or the budget is
   * spent, and only then is a retry put on offer.
   */
  useEffect(() => {
    const { matchId, confirm } = latest.current;
    if (!confirm.landed) return;

    const prior = readAttempt(matchId, confirm.actionId);
    if (!prior || prior.outcome === "confirmed") return;

    // The watch below asks the transaction for its own status, so it needs the
    // hash from the record and not only from a send this page made.
    if (prior.hash && !hashRef.current) hashRef.current = prior.hash;

    const myGen = ++gen.current;
    const mine = () => alive.current && gen.current === myGen;

    void (async () => {
      // Ownership, not a boolean. In dev the effect is mounted, torn down and
      // mounted again before the first read comes back, and the setup that
      // arrives second has to be able to take the hook from the one the
      // teardown already superseded. Otherwise the record is left seeded on
      // screen with nothing watching it.
      if (driving()) return;
      take(myGen, "resume");
      try {
        const now = await readState();
        if (!mine()) return;
        if (now && confirm.landed!(now)) {
          clearAttempt(matchId, confirm.actionId);
          setInFlight(null);
          set({ kind: "confirmed", note: confirm.confirmedNote });
          return;
        }

        // Before settling in to watch, ask the chain whether there is anything
        // left to watch for. A record whose transaction is already terminal
        // with nothing written is the case that used to strand the step behind
        // an in-flight notice for the rest of the resume budget.
        if (await isDead(confirm, prior.hash ?? null)) {
          if (!mine()) return;
          markDiscarded(confirm, matchId);
          return;
        }
        if (!mine()) return;

        if (prior.outcome === "pending" && Date.now() - prior.startedAt < RESUME_BUDGET_MS) {
          set({ kind: "pending", note: confirm.pendingNote });
          const outcome = await awaitLanding(confirm, prior.startedAt + RESUME_BUDGET_MS, mine);
          if (!mine()) return;
          if (outcome === "landed") {
            clearAttempt(matchId, confirm.actionId);
            setInFlight(null);
            set({ kind: "confirmed", note: confirm.confirmedNote });
            return;
          }
          if (outcome === "discarded") {
            markDiscarded(confirm, matchId);
            return;
          }
        }

        writeAttempt(matchId, confirm.actionId, "unconfirmed", prior.startedAt, prior.hash);
        setInFlight(null);
        set({ kind: "unconfirmed", note: confirm.unconfirmedNote, retryLabel: confirm.retryLabel });
      } finally {
        // Same rule as run(): a superseded watch still hands the hook back.
        release(myGen);
      }
    })();

    return () => {
      // Supersede this watch so a loop asleep between polls stops on waking.
      gen.current += 1;
    };
  }, [awaitLanding, driving, isDead, markDiscarded, readState, release, set, take]);

  /**
   * Retires a recovered notice the moment its record goes away.
   *
   * The app-level sweep, or another tab, can clear this attempt while the
   * panel showing it is mounted. Without this the panel kept rendering an
   * in-flight notice for a record that no longer existed, because `inFlight`
   * is React state seeded once at mount and nothing told it to look again.
   * That was the visible half of the orphaned-create bug: the sweep had done
   * its job and the screen did not know.
   *
   * Deliberately narrow. It only ever retires a notice recovered from the
   * journal, so it cannot disturb a run this page is driving, which writes and
   * clears its own record as part of the normal sequence.
   */
  useEffect(
    () =>
      subscribe(() => {
        if (!alive.current) return;
        // A send this page is driving writes and clears its own record as part
        // of the normal sequence, and must not be disturbed by hearing about
        // it. A resumed watch is the opposite case: the record it is watching
        // has just been retired by the sweep, on the same postcondition it was
        // polling for, and this is the only notification it will ever get. The
        // sweep announces once, at the moment it clears the record, and if the
        // panel ignores that one announcement nothing announces again. Bailing
        // out here for a resumed watch is what left the notice up until the
        // page was reloaded by hand.
        if (driving() && ownerKind.current === "send") return;
        if (!inFlightRef.current) return;
        const { matchId, confirm } = latest.current;
        if (readAttempt(matchId, confirm.actionId)) return;
        // Supersede any watch still polling for the attempt that just went.
        gen.current += 1;
        inFlightRef.current = null;
        setInFlight(null);
        setPhase({ kind: "idle" });
      }),
    [driving],
  );

  const reset = useCallback(() => set({ kind: "idle" }), [set]);

  /**
   * The escape hatch for an attempt that really did die.
   *
   * A transaction the wallet dropped, or one the chain threw away, never
   * changes state, so nothing on-chain will ever clear its record. Without
   * this the notice would outlive the transaction it describes. It leaves the
   * user in the same place the expired budget would have: a retry, labelled as
   * one, with the record gone so the next reload starts clean.
   */
  const dismiss = useCallback(() => {
    const { matchId, confirm } = latest.current;
    gen.current += 1;
    owner.current = 0;
    ownerKind.current = null;
    hashRef.current = null;
    clearAttempt(matchId, confirm.actionId);
    setInFlight(null);
    setHash(null);
    set({ kind: "unconfirmed", note: confirm.unconfirmedNote, retryLabel: confirm.retryLabel });
  }, [set]);

  return {
    phase,
    busy: phase.kind === "submitting" || phase.kind === "pending",
    inFlight,
    hash,
    run,
    reset,
    dismiss,
  };
}
