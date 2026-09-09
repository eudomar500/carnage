import { useCallback, useEffect, useRef, useState } from "react";
import { coverageNote, discoverMatches, type Discovery } from "../chain/discovery";
import { noteObserved } from "../chain/grace";
import {
  actionCount,
  buildRoster,
  notificationsForMatches,
  type Notification,
  type RosterEntry,
} from "../chain/notifications";

/**
 * The wallet's notifications, refreshed on a slow timer.
 *
 * Two tiers, because reads are expensive. The first run after a wallet
 * connects walks the match ids to find out which matches involve this wallet
 * and caches the answer. Every run after that re-reads only those matches and
 * peeks a little past the end for new ones.
 *
 * Nothing here computes a notification. That is notifications.ts, which is
 * pure: this hook only decides when to read and holds the result.
 */

const REFRESH_MS = 45_000;

export type NotificationFeed = {
  items: Notification[];
  /**
   * Every match this wallet has a stake in, action-needed first then newest.
   * Built from the same states the notifications came from, so it costs no
   * extra reads.
   */
  roster: RosterEntry[];
  /** Action items only. This is the number on the badge. */
  count: number;
  /** True only during the first load for a wallet, so the bell can stay quiet. */
  loading: boolean;
  /** One line about what the scan covered, or why it is incomplete. */
  coverage: string;
  dismiss: (key: string) => void;
  refresh: () => void;
};

const PREFIX = "carnage.dismissed";

/** Dismissals are per wallet: another account has not read your notices. */
function dismissKey(wallet: string): string {
  return `${PREFIX}.${wallet.toLowerCase()}`;
}

function readDismissed(wallet: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissKey(wallet));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function writeDismissed(wallet: string, keys: Set<string>): void {
  try {
    localStorage.setItem(dismissKey(wallet), JSON.stringify([...keys]));
  } catch {
    // Dismissals are a convenience. Losing them is not worth an error.
  }
}

export function useNotifications(wallet: `0x${string}` | null): NotificationFeed {
  const [items, setItems] = useState<Notification[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setDismissed(wallet ? readDismissed(wallet) : new Set<string>());
  }, [wallet]);

  useEffect(() => {
    if (!wallet) {
      setItems([]);
      setRoster([]);
      setDiscovery(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Only the first pass for a wallet shows as loading. Later refreshes
    // happen underneath whatever is already on screen.
    const first = discovery === null;
    if (first) setLoading(true);

    void (async () => {
      try {
        const found = await discoverMatches(wallet);
        if (cancelled || !alive.current) return;
        setDiscovery(found);
        // The sweep sees matches the user has not opened, so this is the
        // earliest sighting the force-settle estimate can get.
        for (const m of found.matches) noteObserved(m);
        // One pass over the matches discovery already read. No second scan.
        const next = notificationsForMatches(found.matches, wallet);
        setItems(next);
        setRoster(buildRoster(found.matches, wallet, next));
      } catch {
        // A failed sweep leaves the previous list alone rather than blanking
        // the bell on one bad read.
        if (!cancelled && alive.current && first) {
          setDiscovery({ ids: [], scannedTo: 0, capped: false, degraded: "could not read the contract" });
        }
      } finally {
        if (!cancelled && alive.current) setLoading(false);
      }
    })();

    const id = setInterval(() => setNonce((n) => n + 1), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // `discovery` is deliberately not a dependency: it is written by this
    // effect, and depending on it would restart the timer on every sweep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, nonce]);

  const dismiss = useCallback(
    (key: string) => {
      if (!wallet) return;
      setDismissed((prev) => {
        const next = new Set(prev).add(key);
        writeDismissed(wallet, next);
        return next;
      });
    },
    [wallet],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Action items ignore dismissals: they are recomputed from live state and
  // clear themselves when the condition stops holding, so hiding one would
  // only hide a real thing still waiting to be done.
  const visible = items.filter((n) => n.severity === "action" || !dismissed.has(n.key));

  return {
    items: visible,
    roster,
    count: actionCount(visible),
    loading,
    coverage: discovery ? coverageNote(discovery) : "",
    dismiss,
    refresh,
  };
}
