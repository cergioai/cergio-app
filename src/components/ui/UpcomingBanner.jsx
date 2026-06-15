// Global dismissible banner: "N upcoming services — tap to view" (Tarik
// 2026-06-15). Mounted in the app shell on nav screens. Dismiss persists via
// localStorage keyed on the count, so it re-appears when the count changes.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listConsumerBookings, listProviderBookings } from '../../lib/api';

const DISMISS_KEY = 'cergio_upcoming_banner_dismissed_count';

// Same "live job" rule as the Jobs inbox Upcoming tab.
function isLive(b) {
  return ['confirmed', 'in_progress'].includes(b.status) ||
    (b.is_free_for_rainmaker && !b.post_confirmed_at &&
      ['confirmed', 'in_progress', 'completed'].includes(b.status));
}

export function UpcomingBanner({ isSignedIn }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isSignedIn) { setCount(0); return; }
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([listConsumerBookings(), listProviderBookings()]);
      if (cancelled) return;
      const n = [
        ...(c.data || []).filter(b => isLive(b) || b.status === 'pending'),
        ...(p.data || []).filter(isLive),
      ].length;
      setCount(n);
      let dismissedAt = 0;
      try { dismissedAt = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10); } catch { /* no storage */ }
      setDismissed(n > 0 && dismissedAt === n);
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  if (!isSignedIn || count === 0 || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(count)); } catch { /* no storage */ }
    setDismissed(true);
  };

  return (
    <div className="w-full bg-gl border-b border-g/20 px-5 py-2.5 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => navigate('/inbox')}
        className="flex-1 text-left text-meta font-extrabold text-gd leading-snug"
      >
        {count} upcoming {count === 1 ? 'service' : 'services'} — tap to view
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-gd/70 text-body font-extrabold px-1 leading-none"
      >
        ×
      </button>
    </div>
  );
}
