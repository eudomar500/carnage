import { useCallback, useEffect, useRef, useState } from "react";
import { getMatchView, isUnknownMatch, type MatchState, type MatchView } from "../chain/contract";
import { classifyFailure } from "../chain/errors";

const POLL_MS = 12_000;
const MAX_POLL_MS = 60_000;

export type MatchFeed = {
  view: MatchView | null;
  /** True when this id has simply never been created. */
  notFound: boolean;
  /** Fatal: there is nothing to show at all. */
  error: string | null;
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

/** Polls get_match and keeps the hero in sync. */
export function useMatch(matchId: number): MatchFeed {
  const [view, setView] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const alive = useRef(true);
  const hasView = useRef(false);
  const delay = useRef(POLL_MS);
  /** Collapses overlapping reads so the watcher and the poll share one call. */
  const inflight = useRef<Promise<MatchState | null> | null>(null);

  const read = useCallback(async (): Promise<MatchState | null> => {
    try {
      const next = await getMatchView(matchId);
      if (!alive.current) return next.accepted;
      hasView.current = true;
      setView(next);
      setError(null);
      setDegraded(null);
      setNotFound(false);
      setTick((t) => t + 1);
      delay.current = POLL_MS;
      return next.accepted;
    } catch (e: any) {
      if (!alive.current) return null;
      if (isUnknownMatch(e)) {
        hasView.current = false;
        setNotFound(true);
        setView(null);
        setError(null);
        setDegraded(null);
        return null;
      }
      const failure = classifyFailure(e);
      // A transient read failure must not blank a page that already has state.
      // Before this, one rate-limited poll dropped the whole match view and
      // replaced it with a read error.
      if (hasView.current) setDegraded(failure.message);
      else setError(failure.message);
      if (failure.kind === "rate-limited" || failure.kind === "network") {
        delay.current = Math.min(delay.current * 2, MAX_POLL_MS);
      }
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [matchId]);

  const refresh = useCallback((): Promise<MatchState | null> => {
    if (inflight.current) return inflight.current;
    const p = read().finally(() => {
      inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [read]);

  useEffect(() => {
    alive.current = true;
    hasView.current = false;
    delay.current = POLL_MS;
    // Switching match id must not leave the previous match's state on screen
    // while the first read of the new one is still in flight.
    setView(null);
    setDegraded(null);
    setLoading(true);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      await refresh();
      if (!alive.current) return;
      timer = setTimeout(loop, delay.current);
    };
    void loop();

    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  return { view, notFound, error, degraded, loading, tick, refresh };
}
