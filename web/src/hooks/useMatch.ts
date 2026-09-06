import { useCallback, useEffect, useRef, useState } from "react";
import { getMatchView, isUnknownMatch, type MatchView } from "../chain/contract";

const POLL_MS = 12_000;

export type MatchFeed = {
  view: MatchView | null;
  /** True when this id has simply never been created. */
  notFound: boolean;
  error: string | null;
  loading: boolean;
  /** Bumped on every successful poll; lets the hero re-trigger animations. */
  tick: number;
  refresh: () => void;
};

/** Polls get_match at both consensus heights and keeps the hero in sync. */
export function useMatch(matchId: number): MatchFeed {
  const [view, setView] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await getMatchView(matchId);
      if (!alive.current) return;
      setView(next);
      setError(null);
      setNotFound(false);
      setTick((t) => t + 1);
    } catch (e: any) {
      if (!alive.current) return;
      if (isUnknownMatch(e)) {
        setNotFound(true);
        setView(null);
        setError(null);
      } else {
        setError(String(e?.shortMessage ?? e?.message ?? e));
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load]);

  return { view, notFound, error, loading, tick, refresh: load };
}
