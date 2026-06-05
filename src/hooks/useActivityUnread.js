// CERGIO-GUARD (2026-06-05): tiny "unread Activity" cue.
//
// Tarik 2026-06-04 v3 directive: include the deferred items —
// activity-tab red-dot for unread feed events.
//
// Implementation:
//   • `localStorage['cergio:lastActivitySeenAt']` is stamped with
//     the current ISO timestamp every time ActivityScreen mounts.
//   • This hook fetches `listSocialFeed` once on mount, then
//     returns `true` if any event in that response has
//     `created_at > lastSeen` (or `lastSeen` is unset → first visit
//     to the app).
//   • The hook auto-suppresses itself when the user is on /activity
//     (no point showing "you've got new stuff" while they're looking
//     at the stuff).
//   • Refreshes every 90s — cheap, low priority.
//
// BottomNav consumes the boolean to render a small red dot on the
// Activity icon. The dot is purely a visual cue; tapping the tab
// still navigates normally.

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { listSocialFeed } from '../lib/api';

const LS_KEY = 'cergio:lastActivitySeenAt';
const POLL_MS = 90_000;

export function stampActivitySeen() {
  try { localStorage.setItem(LS_KEY, new Date().toISOString()); } catch { /* private mode */ }
}

export function getLastActivitySeen() {
  try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
}

export function useActivityUnread({ enabled = true } = {}) {
  const location = useLocation();
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    if (!enabled) { setUnread(false); return; }
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      // Suppress while the user is actually on the Activity tab.
      if (location.pathname.startsWith('/activity')) {
        if (!cancelled) setUnread(false);
        stampActivitySeen();
        return;
      }
      const lastSeenIso = getLastActivitySeen();
      const lastSeenMs  = lastSeenIso ? Date.parse(lastSeenIso) : 0;
      try {
        const { data } = await listSocialFeed({ limit: 12, days: 14 });
        const hasFresh = Array.isArray(data) && data.some(ev => {
          const evMs = Date.parse(ev?.created_at || ev?.occurred_at || ev?.created || 0);
          return Number.isFinite(evMs) && evMs > lastSeenMs;
        });
        if (!cancelled) setUnread(hasFresh);
      } catch {
        // Network/RLS hiccups — never flag unread on failure.
        if (!cancelled) setUnread(false);
      }
    };

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, location.pathname]);

  return unread;
}
