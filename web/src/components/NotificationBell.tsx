import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { NotificationFeed } from "../hooks/useNotifications";
import { Bell } from "./Icons";
import { hrefFor } from "../lib/route";

/**
 * The bell and its dropdown.
 *
 * The badge counts action items only, so a match that merely has something
 * worth reading never puts a number on the icon. Informational items are
 * dismissible and stay dismissed; action items are not, because they are
 * recomputed from live state every sweep and disappear on their own once the
 * thing they are asking for has been done.
 *
 * A wallet with no matches gets an empty state that says so. There is no
 * spinner past the first sweep, and no error face for a contract that simply
 * has nothing on it yet.
 */
export default function NotificationBell({
  feed,
  onOpenMatch,
}: {
  feed: NotificationFeed;
  /** Navigates to a match without a page load. */
  onOpenMatch: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (id: number) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setOpen(false);
    onOpenMatch(id);
  };

  const { items, roster, count, loading, coverage } = feed;

  return (
    <div className="bell" ref={box}>
      <button
        className={`bell-btn${count > 0 ? " bell-btn--live" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `${count} notifications needing attention` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="ico bell-ico" />
        {count > 0 ? <span className="bell-count">{count}</span> : null}
      </button>

      {open ? (
        <div className="bell-menu" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <span className="bell-title">NOTIFICATIONS</span>
            <button className="linkish" onClick={feed.refresh} disabled={loading}>
              {loading ? "REFRESHING..." : "REFRESH"}
            </button>
          </div>

          {loading && !items.length ? (
            <p className="bell-empty">Looking for your matches...</p>
          ) : items.length === 0 ? (
            <p className="bell-empty">
              {roster.length
                ? "Nothing needs your attention. Your matches are listed below."
                : "Nothing needs your attention. Anything you are owed, or owe a move on, shows up here."}
            </p>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.key} className={`bell-item bell-item--${n.severity}`}>
                  <a
                    className="bell-link"
                    href={hrefFor({ view: "app", matchId: Number(n.matchId) })}
                    onClick={go(Number(n.matchId))}
                  >
                    <span className="bell-item-title">{n.title}</span>
                    <span className="bell-item-match">MATCH #{`${n.matchId}`}</span>
                    <span className="bell-item-detail">{n.detail}</span>
                  </a>
                  {n.severity === "info" ? (
                    <button
                      className="linkish bell-dismiss"
                      onClick={() => feed.dismiss(n.key)}
                    >
                      DISMISS
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {roster.length ? (
            <div className="bell-roster">
              <div className="bell-roster-head">YOUR MATCHES</div>
              <ul className="bell-list">
                {roster.map((r) => (
                  <li
                    key={`roster-${r.matchId}`}
                    className={`bell-row${r.needsAction ? " bell-row--live" : ""}`}
                  >
                    <a
                      className="bell-link bell-link--row"
                      href={hrefFor({ view: "app", matchId: Number(r.matchId) })}
                      onClick={go(Number(r.matchId))}
                    >
                      <span className="bell-row-id">#{`${r.matchId}`}</span>
                      <span className="bell-row-status">{r.status}</span>
                      <span className="bell-row-role">{r.role}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {coverage ? <p className="bell-foot">{coverage}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
