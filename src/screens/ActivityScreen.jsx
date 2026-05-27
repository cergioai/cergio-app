// Activity — the consumer's "what's happening" hub.
//
// CERGIO-GUARD: previously this screen had TWO sections — a fake
// "Friends recently booked" feed (FEED mock) and the user's own
// open requests. The fake feed was removed once (task #9) and
// silently regressed. It's now gone permanently and locked down
// by qa.mjs invariant #12 (no-mock-on-signed-in-paths). When we
// have real friend-activity data (consumer's `network` graph
// joined to recent `bookings`), we re-add the section reading
// from that — never from `../data/mock`.
//
// Provider-side outgoing requests live in /inbox 'Sent' tab — this screen
// is the consumer's view only.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { listConsumerBookings, listMyOutboundSpotlightRequests } from '../lib/api';
import { fmtDollars } from '../lib/fees';
// FEED + REWARDS imports removed along with the fake "Friends
// recently booked" section — see CERGIO-GUARD in the JSX below.

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)    return 'just now';
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StatusPill({ status }) {
  const map = {
    pending:    { bg: 'bg-bg5',    tx: 'text-b2',       label: 'Pending' },
    countered:  { bg: 'bg-warnBg', tx: 'text-warnText', label: 'Counter offer' },
    accepted:   { bg: 'bg-gl',     tx: 'text-gd',       label: 'Accepted' },
    paid:       { bg: 'bg-gl',     tx: 'text-gd',       label: 'Paid · awaiting post' },
    posted:     { bg: 'bg-gl',     tx: 'text-gd',       label: 'Posted' },
    confirmed:  { bg: 'bg-gl',     tx: 'text-gd',       label: 'Confirmed' },
    cleared:    { bg: 'bg-gl',     tx: 'text-gd',       label: 'Cleared' },
    completed:  { bg: 'bg-gl',     tx: 'text-gd',       label: 'Completed' },
    declined:   { bg: 'bg-bg5',    tx: 'text-danger',   label: 'Declined' },
    cancelled:  { bg: 'bg-bg5',    tx: 'text-danger',   label: 'Cancelled' },
    expired:    { bg: 'bg-bg5',    tx: 'text-danger',   label: 'Expired' },
  };
  const m = map[status] || { bg: 'bg-bg5', tx: 'text-b2', label: status || '—' };
  return (
    <span className={`inline-block rounded-pill px-2 py-0.5 text-[10px] font-extrabold ${m.bg} ${m.tx}`}>
      {m.label}
    </span>
  );
}

function BookingRow({ booking, onClick }) {
  const title  = booking.service?.title || 'Service request';
  const when   = booking.scheduled_at ? fmtDate(booking.scheduled_at) : timeAgo(booking.created_at);
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3 text-left
                 hover:border-g/40 transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="1.8">
          <rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-extrabold text-black leading-tight truncate">{title}</p>
        <p className="text-[11px] text-b3 mt-0.5 leading-snug">
          {when} · <StatusPill status={booking.status || 'pending'} />
        </p>
      </div>
      <span className="text-b3 text-base">›</span>
    </button>
  );
}

function SpotlightRow({ req, onClick }) {
  const platform = req.platform === 'tiktok' ? 'TikTok' : 'Instagram';
  const price    = req.accepted_price_cents || req.offered_price_cents || req.official_price_cents || 0;
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3 text-left
                 hover:border-g/40 transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#3D8B00">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-extrabold text-black leading-tight truncate">{platform} spotlight</p>
        <p className="text-[11px] text-b3 mt-0.5 leading-snug">
          {timeAgo(req.created_at)} · <StatusPill status={req.status || 'pending'} />
          {price ? ` · ${fmtDollars(price)}` : ''}
        </p>
      </div>
      <span className="text-b3 text-base">›</span>
    </button>
  );
}

export function ActivityScreen() {
  const navigate = useNavigate();
  const { auth } = useOutletContext() || {};
  const isSignedIn = !!auth?.isSignedIn;

  // Real data — loaded lazily on auth flip.
  const [bookings, setBookings]     = useState(null); // null = loading
  const [spotlights, setSpotlights] = useState(null);
  useEffect(() => {
    if (!isSignedIn) { setBookings([]); setSpotlights([]); return; }
    listConsumerBookings().then(({ data }) => setBookings(data || []));
    listMyOutboundSpotlightRequests({ limit: 50 }).then(({ data }) => setSpotlights(data || []));
  }, [isSignedIn]);

  // Active = anything that isn't in a terminal state — those are what
  // the user actually wants to see in "Open requests".
  const TERMINAL = ['completed', 'cleared', 'confirmed', 'declined', 'cancelled', 'expired'];
  const openBookings   = (bookings   || []).filter(b => !TERMINAL.includes(b.status));
  const openSpotlights = (spotlights || []).filter(s => !TERMINAL.includes(s.status));
  const hasOpen        = openBookings.length > 0 || openSpotlights.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24 overflow-y-auto">
      <div className="px-5 pt-8 pb-2">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">Activity</h1>
        <p className="text-[13px] text-b3 font-medium mt-1.5 leading-snug">
          Your own open requests.
        </p>
      </div>

      {/* CERGIO-GUARD: the "Friends recently booked" section that
          rendered FEED (Stephanie K. booked Jamie Hall — Deep
          Cleaning, etc.) has been removed AGAIN. It was deleted
          once before (task #9) and silently regressed. Until we
          have a real friend-activity query that pulls from the
          consumer's `network` graph + recent bookings, this
          block stays gone. The "Bring more friends" CTA moves
          into a small invite card below the open-requests block
          so it doesn't sit under a fake-friends header. */}

      {/* ─── Open requests — the user's own outgoing pile. ────────────── */}
      <p className="px-5 mt-3 mb-2 text-[11px] font-extrabold uppercase tracking-widest text-b3 flex items-center justify-between">
        <span>Your open requests</span>
        {hasOpen && (
          <span className="text-g normal-case tracking-normal">
            {openBookings.length + openSpotlights.length} active
          </span>
        )}
      </p>

      {!isSignedIn && (
        <div className="mx-5 bg-white border border-bdr rounded-[14px] p-4">
          <p className="text-[13px] font-extrabold text-black">Sign in to see your requests</p>
          <p className="text-[11px] text-b3 mt-1 leading-snug">
            Your booking + spotlight requests show up here once you sign in.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="mt-3 bg-g text-white rounded-pill px-4 py-1.5 text-[12px] font-extrabold"
          >
            Sign in
          </button>
        </div>
      )}

      {isSignedIn && !hasOpen && bookings !== null && spotlights !== null && (
        <div className="mx-5 bg-white border border-bdr rounded-[14px] p-4">
          <p className="text-[13px] font-extrabold text-black">No open requests right now</p>
          <p className="text-[11px] text-b3 mt-1 leading-snug">
            Send a booking from Home — Cergio negotiates and books for you.
          </p>
          <button
            onClick={() => navigate('/home')}
            className="mt-3 bg-g text-white rounded-pill px-4 py-1.5 text-[12px] font-extrabold"
          >
            Find a service →
          </button>
        </div>
      )}

      {isSignedIn && hasOpen && (
        <div className="px-5 flex flex-col gap-2">
          {openBookings.map(b => (
            <BookingRow key={b.id} booking={b} onClick={() => navigate(`/request/${b.id}`)} />
          ))}
          {openSpotlights.map(s => (
            <SpotlightRow key={s.id} req={s} onClick={() => navigate('/connectors/requests')} />
          ))}
        </div>
      )}
    </div>
  );
}
