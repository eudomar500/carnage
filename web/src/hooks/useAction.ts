import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPT_WAIT_MS } from "../chain/actions";
import type { Confirmation } from "../chain/confirm";
import type { MatchState } from "../chain/contract";
import { classifyFailure } from "../chain/errors";
import { clearAttempt, readAttempt, writeAttempt } from "../chain/journal";

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
  | { kind: "unconfirmed"; note: string; retryLabel: string };

export type ActionRunner = {
  phase: ActionPhase;
  /** True whenever a send or a confirmation watch is in flight. */
  busy: boolean;
  run: (fn: (say: (note: string) => void) => Promise<string>) => Promise<void>;
  reset: () => void;
};

export type ActionOptions = {
  matchId: bigint | number;
  confirm: Confirmation;
  /** Re-reads the match and hands back what it read. */
  refresh?: () => Promise<MatchState | null>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [phase, setPhase] = useState<ActionPhase>({ kind: "idle" });

  const alive = useRef(false);
  const running = useRef(false);
  const latest = useRef(opts);
  // Synced after render rather than during it. Nothing reads this until a
  // click or a timer fires, both of which happen after effects have flushed.
  useEffect(() => {
    latest.current = opts;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
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

  const awaitLanding = useCallback(
    async (c: Confirmation, deadline: number): Promise<boolean> => {
      if (!c.landed) return true;
      for (;;) {
        if (!alive.current) return false;
        const m = await readState();
        if (!alive.current) return false;
        if (m && c.landed(m)) return true;

        const left = deadline - Date.now();
        if (left <= 0) break;
        set({ kind: "pending", note: `${c.pendingNote} (${Math.ceil(left / 1000)}s left)` });
        await sleep(Math.min(c.pollMs, left));
      }
      // One last look: the change may have landed during the final sleep.
      const last = await readState();
      return Boolean(last && c.landed(last));
    },
    [readState, set],
  );

  const settle = useCallback(
    async (c: Confirmation, matchId: bigint | number, successNote: string) => {
      set({ kind: "pending", note: c.pendingNote });
      const landed = await awaitLanding(c, Date.now() + c.windowMs);
      if (!alive.current) return;
      if (landed) {
        clearAttempt(matchId, c.actionId);
        set({ kind: "confirmed", note: successNote });
        return;
      }
      writeAttempt(matchId, c.actionId, "unconfirmed");
      set({ kind: "unconfirmed", note: c.unconfirmedNote, retryLabel: c.retryLabel });
    },
    [awaitLanding, set],
  );

  const run = useCallback(
    async (fn: (say: (note: string) => void) => Promise<string>) => {
      if (running.current) return;
      running.current = true;

      const { matchId, confirm } = latest.current;
      // Disabled on the click itself, before the first await.
      set({ kind: "submitting", note: "checking preconditions..." });

      try {
        // If the change is already on-chain there is nothing to send. This is
        // what keeps a permissionless action safe to retry: whoever got there
        // first wins and the second caller spends nothing.
        if (confirm.landed) {
          const before = await readState();
          if (!alive.current) return;
          if (before && confirm.landed(before)) {
            clearAttempt(matchId, confirm.actionId);
            set({ kind: "confirmed", note: `${confirm.confirmedNote} (already on-chain)` });
            return;
          }
        }

        writeAttempt(matchId, confirm.actionId, "pending");

        let note: string;
        try {
          note = await fn((n) => set({ kind: "submitting", note: n }));
        } catch (err) {
          const failure = classifyFailure(err);
          // With no postcondition there is nothing to check state against, so
          // a throw is the final word rather than something to watch out.
          if (failure.nothingSent || !confirm.landed) {
            writeAttempt(matchId, confirm.actionId, "failed");
            set({ kind: "failed", note: failure.message, retryLabel: confirm.retryLabel });
            return;
          }
          // The transaction reached the network and we lost sight of it. The
          // only honest move is to go and look at contract state.
          await settle(confirm, matchId, confirm.confirmedNote);
          return;
        }

        await settle(confirm, matchId, note);
      } finally {
        running.current = false;
      }
    },
    [readState, set, settle],
  );

  /**
   * Picks an attempt back up after a reload or in a second tab.
   *
   * Contract state cannot distinguish "nobody has tried yet" from "a round was
   * fired and discarded", so the journal supplies that. Inside the original
   * budget we resume watching, because the transaction may still be live;
   * past it we offer the retry.
   */
  useEffect(() => {
    const { matchId, confirm } = latest.current;
    if (!confirm.landed) return;

    const prior = readAttempt(matchId, confirm.actionId);
    if (!prior || prior.outcome === "confirmed") return;

    let cancelled = false;
    void (async () => {
      if (running.current) return;
      running.current = true;
      try {
        const now = await readState();
        if (cancelled || !alive.current) return;
        if (now && confirm.landed!(now)) {
          clearAttempt(matchId, confirm.actionId);
          return;
        }

        const budget = confirm.windowMs + ACCEPT_WAIT_MS;
        if (prior.outcome === "pending" && Date.now() - prior.startedAt < budget) {
          set({ kind: "pending", note: confirm.pendingNote });
          const landed = await awaitLanding(confirm, prior.startedAt + budget);
          if (cancelled || !alive.current) return;
          if (landed) {
            clearAttempt(matchId, confirm.actionId);
            set({ kind: "confirmed", note: confirm.confirmedNote });
            return;
          }
        }

        writeAttempt(matchId, confirm.actionId, "unconfirmed", prior.startedAt);
        set({ kind: "unconfirmed", note: confirm.unconfirmedNote, retryLabel: confirm.retryLabel });
      } finally {
        running.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [awaitLanding, readState, set]);

  const reset = useCallback(() => set({ kind: "idle" }), [set]);

  return {
    phase,
    busy: phase.kind === "submitting" || phase.kind === "pending",
    run,
    reset,
  };
}
