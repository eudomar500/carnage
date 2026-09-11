import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMatchView,
  isResolved,
  isUnknownMatch,
  type MatchState,
  type MatchView,
} from "../chain/contract";
import { classifyFailure, type FailureKind } from "../chain/errors";

const POLL_MS = 12_000;
const MAX_POLL_MS = 60_000;

export type MatchFeed = {
  view: MatchView | null;
  /** True when this id has simply never been created. */
  notFound: boolean;
  /** Fatal: there is nothing to show at all. */
  error: string | null;
  /** What kind of failure `error` describes, so the screen can offer a retry. */
  errorKind: FailureKind | null;
  /** Transient: the last good state is still on screen but reads are failing. */
  degraded: string | null;
  loading: boolean;
  /** Bumped on every successful poll; lets the hero re-trigger animations. */
  tick: number;
  /**
   * Re-reads now and hands back what it read.
   *
   * The confirmation watcher needs the value, not just the side effect, so it
   * can decide whether the change it is waiting for has landed. Returning it
   * here means one read serves both the watcher and the page instead of two
   * pollers racing each other against a rate-limited node.
   */
  refresh: () => Promise<MatchState | null>;
};

/**
 * Polls get_match and keeps the hero in sync.
 *
 * A null id is the start screen: no match is selected, so there is nothing to
 * read and the hook stays idle rather than burning a poll on a placeholder.
 *
 * The poll stops when the match reaches a terminal state: settled, resolved as
 * a no-reveal, resolved as inconclusive, or refunded before the lock. Nothing
 * the contract can do afterwards changes what get_match returns, and each read
 * is a gen_call the node executes in the GenVM, so a finished match left open
 * in a tab was costing a run of the contract every twelve seconds for nothing.
 * A manual refresh and a reload each still read once, and every other state
 * polls as before.
 */
export function useMatch(matchId: number | null): MatchFeed {
  const [view, setView] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<FailureKind | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(matchId !== null);
  const [tick, setTick] = useState(0);

  /**
   * The polling run the hook is currently on.
   *
   * This used to be one shared `alive` boolean, and that is what let a loop
   * come back from the dead. React runs the cleanup and then the next setup
   * back to back, so a cleanup that set the flag false was immediately
   * followed by a setup that set it true again. A loop parked on an in-flight
   * read woke up after both, found the flag true, and rescheduled itself, so
   * the old match kept polling forever alongside the new one and the two took
   * turns writing `view`. That is the alternating match the console showed.
   *
   * A token per run cannot be undone by the run that replaces it. Each loop,
   * and each read, holds the token it started under and answers only to that
   * one, so a cleanup retires exactly its own run and nothing else.
   */
  const run = useRef<{ cancelled: boolean }>({ cancelled: false });
  const hasView = useRef(false);
  const delay = useRef(POLL_MS);
  /** Collapses overlapping reads so the watcher and the poll share one call. */
  const inflight = useRef<Promise<MatchState | null> | null>(null);

  const read = useCallback(async (): Promise<MatchState | null> => {
    if (matchId === null) return null;
    // Taken at the start, not read at the end. A read that outlives its own
    // run has to know that, or it writes state describing a match the page
    // has already left. The value it returns is unaffected either way: the
    // caller asked for a read and gets one, only the setters are skipped.
    const mine = run.current;
    try {
      const next = await getMatchView(matchId);
      if (mine.cancelled) return next.accepted;
      hasView.current = true;
      setView(next);
      setError(null);
      setErrorKind(null);
      setDegraded(null);
      setNotFound(false);
      setTick((t) => t + 1);
      delay.current = POLL_MS;
      return next.accepted;
    } catch (e: any) {
      if (mine.cancelled) return null;
      if (isUnknownMatch(e)) {
        hasView.current = false;
        setNotFound(true);
        setView(null);
        setError(null);
        setErrorKind(null);
        setDegraded(null);
        return null;
      }
      const failure = classifyFailure(e);
      // A transient read failure must not blank a page that already has state.
      // Before this, one rate-limited poll dropped the whole match view and
      // replaced it with a read error.
      if (hasView.current) {
        setDegraded(failure.message);
      } else {
        setError(failure.message);
        setErrorKind(failure.kind);
      }
      if (failure.kind === "rate-limited" || failure.kind === "network") {
        delay.current = Math.min(delay.current * 2, MAX_POLL_MS);
      }
      return null;
    } finally {
      if (!mine.cancelled) setLoading(false);
    }
  }, [matchId]);

  const refresh = useCallback((): Promise<MatchState | null> => {
    if (inflight.current) return inflight.current;
    // A promise only retires its own entry. One that settles after a match
    // change has already been replaced in the slot, and clearing it there
    // would drop a live read belonging to the run that came after.
    const p = read().finally(() => {
      if (inflight.current === p) inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [read]);

  useEffect(() => {
    // Nothing to poll on the start screen. State from a previous match is
    // left untouched and masked below rather than cleared here, so this does
    // not cost a render.
    if (matchId === null) return;

    const mine = { cancelled: false };
    run.current = mine;
    // The previous run's read is not this run's read. Sharing it through the
    // dedup handed the new match the old match's state as its first answer,
    // which is the wrong match to judge a postcondition against.
    inflight.current = null;
    hasView.current = false;
    delay.current = POLL_MS;
    // Switching match id must not leave the previous match's state on screen
    // while the first read of the new one is still in flight.
    setView(null);
    setDegraded(null);
    setLoading(true);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      const state = await refresh();
      if (mine.cancelled) return;
      // Terminal is terminal. Anything that happens next, a claim included,
      // comes through refresh() from the panel that sent it.
      if (state && isResolved(state)) return;
      timer = setTimeout(loop, delay.current);
    };
    void loop();

    return () => {
      mine.cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [matchId, refresh]);

  if (matchId === null) {
    return {
      view: null,
      notFound: false,
      error: null,
      errorKind: null,
      degraded: null,
      loading: false,
      tick: 0,
      refresh,
    };
  }

  return { view, notFound, error, errorKind, degraded, loading, tick, refresh };
}
