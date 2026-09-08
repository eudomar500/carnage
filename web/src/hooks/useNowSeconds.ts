import { useEffect, useState } from "react";

/**
 * Current Unix seconds, refreshed on an interval.
 *
 * Two things in the console depend on the clock rather than on contract
 * state: whether the pre-lock refund is callable yet, and the line that says
 * when it will be. Reading Date.now() during render would make those depend
 * on whatever else happened to trigger a re-render, so the time lives in
 * state and the deadline crossing shows up on its own.
 */
export function useNowSeconds(periodMs = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}
