// My Requests — outgoing requests the signed-in user has sent out.
// Two sections that both render when they have rows:
//   1. SERVICES I asked for — bookings the user submitted (consumer side)
//   2. SPOTLIGHTS I asked for — outbound spotlight requests (provider side,
//      shown only if the user has at least one outbound row OR is in
//      serviceMode so the section is discoverable)
//
// Each row is tappable, routing to the existing detail screen. Empty state
// pushes back into Home or Find Friends with a clear earn-loop CTA.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { listConsumerBookings, listMyOutboundSpotlightRequests } from '../lib/api';
import { fmtDollars } from '../lib/fees';
import { REWARDS } from '../lib/rewards';

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
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Service-booking row.
function BookingRow({ booking, onClick }) {
  const title  = booking.service?.title || 'Service request';
  const status = booking.status || 'pending';
  const when   = booking.scheduled_at ? fmtDate(booking.scheduled_at) : timeAgo(booking.created_at);
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3 text-left
                 hover:border-g/40 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="1.8">
          <rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-extrabold text-black leading-tight truncate">{title}</p>
        <p className="text-[12px] text-b3 mt-0.5 leading-snug">
          {when} · <StatusPill status={status} />
        </p>
      </div>
      <span className="text-b3 text-base">›</span>
    </button>
  );
}

// Spotlight-request row (outbound — sent by the user to a Connector).
function SpotlightRow({ req, onClick }) {
  const platform = req.platform === 'tiktok' ? 'TikTok' : 'Instagram';
  const status   = req.status || 'pending';
  const price    = req.accepted_price_cents || req.offered_price_cents || req.official_price_cents || 0;
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3 text-left
                 hover:border-g/40 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#3D8B00">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-extrabold text-black leading-tight truncate">
          {platform} spotlight
        </p>
        <p className="text-[12px] text-b3 mt-0.5 leading-snug">
          {timeAgo(req.created_at)} · <StatusPill status={status} />
          {price ? ` · ${fmtDollars(price)}` : ''}
        </p>
      </div>
      <span className="text-b3 text-base">›</span>
    </button>
  );
}

// Color-coded status pill — green for done/cleared, amber for in-flight,
// red for declined / cancelled.
function StatusPill({ status }) {
  const map = {
    pending:    { bg: 'bg-bg5',   tx: 'text-b2',     label: 'Pending' },
    countered:  { bg: 'bg-warnBg', tx: 'text-warnText', label: 'Counter offer' },
    accepted:   { bg: 'bg-gl',    tx: 'text-gd',     label: 'Accepted' },
    paid:       { bg: 'bg-gl',    tx: 'text-gd',     label: 'Paid · awaiting post' },
    posted:     { bg: 'bg-gl',    tx: 'text-gd',     label: 'Posted' },
    confirmed:  { bg: 'bg-gl',    tx: 'text-gd',     label: 'Confirmed' },
    cleared:    { bg: 'bg-gl',    tx: 'text-gd',     label: 'Cleared' },
    declined:   { bg: 'bg-bg5',   tx: 'text-danger', label: 'Declined' },
    cancelled:  { bg: 'bg-bg5',   tx: 'text-danger', label: 'Cancelled' },
    expired:    { bg: 'bg-bg5',   tx: 'text-danger', label: 'Expired' },
    completed:  { bg: 'bg-gl',    tx: 'text-gd',     label: 'Completed' },
    confirmed_booking: { bg: 'bg-gl', tx: 'text-gd', label: 'Confirmed' },
  };
  const m = map[status] || { bg: 'bg-bg5', tx: 'text-b2', label: status };
  return (
    <span className={`inline-block rounded-pill px-2 py-0.5 text-[10px] font-extrabold ${m.bg} ${m.tx}`}>
      {m.label}
    </span>
  );
}

export function ActivityScreen() {
  const navigate = useNavigate();
  const { auth, serviceMode } = useOutletContext() || {};
  const isSignedIn = !!auth?.isSignedIn;

  // Two independent loads, both keyed to auth state.
  const [bookings, setBookings] = useState(null);   // null = loading
  const [spotlights, setSpotlights] = useState(null);
  useEffect(() => {
    if (!isSignedIn) { setBookings([]); setSpotlights([]); return; }
    listConsumerBookings().then(({ data }) => setBookings(data || []));
    listMyOutboundSpotlightRequests({ limit: 50 }).then(({ data }) => setSpotlights(data || []));
  }, [isSignedIn]);

  const loading = bookings === null || spotlights === null;
  const hasAny  = (bookings?.length || 0) > 0 || (spotlights?.length || 0) > 0;
  // Active = anything not in a terminal status — used to surface the count
  // in the section header.
  const TERMINAL = ['completed', 'cleared', 'confirmed', 'declined', 'cancelled', 'expired'];
  const activeBookings   = (bookings || []).filter(b => !TERMINAL.includes(b.status));
  const activeSpotlights = (spotlights || []).filter(s => !TERMINAL.includes(s.status));

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24 overflow-y-auto">
      <div className="px-5 pt-8 pb-2">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">My requests</h1>
        <p className="text-[13px] text-b3 font-medium mt-1.5 leading-snug">
          Services you asked for and spotlights you sent — all in one place.
        </p>
      </div>

      {/* Loading shimmer */}
      {loading && (
        <div className="px-5 mt-4 space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white border border-bdr rounded-[14px] h-14 animate-pulse" />
          ))}
        </div>
      )}

      {/* Signed-out empty state */}
      {!loading && !isSignedIn && (
        <div className="mx-5 mt-4 bg-white border border-bdr rounded-[18px] p-5">
          <p className="text-[15px] font-extrabold text-black leading-tight">Sign in to see your requests</p>
          <p className="text-[12px] text-b3 mt-1.5 leading-snug">
            Booking requests and spotlight asks show up here once you sign in.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="mt-4 w-full bg-g text-white rounded-[24px] py-3 text-[14px] font-extrabold"
          >
            Sign in
          </button>
        </div>
      )}

      {/* Signed-in but no rows */}
      {!loading && isSignedIn && !hasAny && (
        <div className="mx-5 mt-4 bg-white border border-bdr rounded-[18px] p-5">
          <p className="text-[15px] font-extrabold text-black leading-tight">No open requests</p>
          <p className="text-[12px] text-b3 mt-1.5 leading-snug">
            Send a booking request from Home, or — if you're a provider — request a Connector spotlight.
          </p>
          <div className="flex flex-col gap-2 mt-4">
            <button
              onClick={() => navigate('/home')}
              className="w-full bg-g text-white rounded-[24px] py-3 text-[14px] font-extrabold"
            >
              Find a service →
            </button>
            <button
              onClick={() => navigate('/find-friends')}
              className="w-full bg-white border border-bdr text-black rounded-[24px] py-3 text-[14px] font-extrabold"
            >
              Refer a friend — ${REWARDS.perFriend}/friend
            </button>
          </div>
        </div>
      )}

      {/* Section 1: services I asked for */}
      {!loading && (bookings?.length || 0) > 0 && (
        <div className="mt-5">
          <div className="px-5 mb-2 flex items-center justify-between">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3">
              Services I asked for
            </p>
            {activeBookings.length > 0 && (
              <span className="text-[11px] font-extrabold text-g">
                {activeBookings.length} active
              </span>
            )}
          </div>
          <div className="px-5 flex flex-col gap-2">
            {(bookings || []).map(b => (
              <BookingRow
                key={b.id}
                booking={b}
                onClick={() => navigate(`/request/${b.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section 2: spotlights I asked for — render whenever there are rows,
          regardless of serviceMode. Providers see this naturally; non-
          providers won't have rows so the section just doesn't appear. */}
      {!loading && (spotlights?.length || 0) > 0 && (
        <div className="mt-6">
          <div className="px-5 mb-2 flex items-center justify-between">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3">
              Spotlights I asked for
            </p>
            {activeSpotlights.length > 0 && (
              <span className="text-[11px] font-extrabold text-g">
                {activeSpotlights.length} active
              </span>
            )}
          </div>
          <div className="px-5 flex flex-col gap-2">
            {(spotlights || []).map(s => (
              <SpotlightRow
                key={s.id}
                req={s}
                onClick={() => navigate('/connectors/requests')}
              />
            ))}
          </div>
          {/* Quick path to the full Connector inbox */}
          <button
            onClick={() => navigate('/connectors/requests')}
            className="mx-5 mt-3 w-[calc(100%-2.5rem)] bg-white border border-bdr rounded-[14px] py-2.5
                       text-[12px] font-extrabold text-b2 hover:border-g/40"
          >
            Manage in Connector inbox →
          </button>
        </div>
      )}

      {/* CTA strip when signed-in user only has one of the two kinds — push
          them to start the other side if it makes sense. */}
      {!loading && isSignedIn && hasAny && (bookings?.length || 0) === 0 && serviceMode && (
        <div className="mx-5 mt-6 bg-white border border-bdr rounded-[18px] p-4">
          <p className="text-[13px] font-extrabold text-black">Need a service yourself?</p>
          <p className="text-[11px] text-b3 mt-0.5 leading-snug">
            Cergio works for you too — friends-of-friends recommendations beat reviews.
          </p>
          <button
            onClick={() => navigate('/home')}
            className="mt-3 bg-g text-white rounded-pill px-4 py-1.5 text-[12px] font-extrabold"
          >
            Find a service →
          </button>
        </div>
      )}
    </div>
  );
}
