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
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { listConsumerBookings, listMyOutboundSpotlightRequests, listGoatShares } from '../lib/api';
import { fmtDollars } from '../lib/fees';
// FEED + REWARDS imports removed along with the fake "Friends
// recently booked" section — see CERGIO-GUARD in the JSX below.
// CERGIO-GUARD (2026-05-30): GoatSharesFeed below renders the new
// "GOATs have shared their go-to services" cards (per Tarik's mockup),
// but ONLY from real `recommendations` rows authored by Connectors.
// If there are zero Connector recommendations in the DB the whole
// section hides — never a fake feed, see feedback_no_fake_feeds.

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

// CERGIO-GUARD (2026-05-30): photo_class → cover-image gradient fallback.
// Same pool ResultsScreen uses so the look is consistent across screens.
const PHOTO_GRADIENTS = {
  'fv-jamie':  'from-[#e8dcc8] via-[#b89870] to-[#604030]',
  'fv-john':   'from-[#cad8e8] via-[#7088b0] to-[#2e4060]',
  'fv-steve':  'from-[#d8e8ca] via-[#88b070] to-[#406030]',
};

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase();
}

// One share row matching the mockup: owner-name headline, category
// badge + city, single cover image (when present), and the "Shared by
// {Connector}, GOAT" pill at the bottom. Tap → routes to the service PDP.
function GoatShareCard({ row, onClick }) {
  const svc        = row.service;
  const goatName   = row.recommender.display_name || 'A Connector';
  const goatId     = row.recommender.id || null;
  const followers  = row.recommender.follower_count || 0;
  const ownerName  = svc.owner_display_name || svc.title;
  const ownerId    = svc.owner_id || null;
  const cover      = svc.cover_url;
  const gradient   = PHOTO_GRADIENTS[svc.photo_class] || PHOTO_GRADIENTS['fv-jamie'];
  // CERGIO-GUARD (2026-05-30): real follower count > 0 → show the
  // "Sabir was shared to 45,414 followers" headline. Otherwise fall
  // back to the count-free copy. NEVER faked.
  const headline = followers > 0
    ? `was shared to ${followers.toLocaleString()} followers`
    : 'was shared on Cergio';

  // Both avatars (owner + recommender pill) are Links to public
  // profiles. The card itself is also clickable → service PDP, so the
  // avatar Links stopPropagation to avoid double-navigation.
  const ownerAvatarCls = `w-10 h-10 rounded-full bg-gradient-to-br from-[#5BC404] to-[#2F6E00]
                          text-white text-[12px] font-extrabold flex items-center justify-center flex-shrink-0`;
  const goatAvatarCls  = `w-5 h-5 rounded-full bg-gradient-to-br from-[#5BC404] to-[#2F6E00]
                          text-white text-[9px] font-extrabold flex items-center justify-center`;

  return (
    <div className="w-full text-left bg-transparent">
      <button onClick={onClick} className="w-full text-left bg-transparent">
        <div className="flex items-center gap-2.5 mb-2">
          {ownerId ? (
            <Link
              to={`/u/${ownerId}`}
              aria-label={`View ${ownerName}`}
              onClick={(e) => e.stopPropagation()}
              className={ownerAvatarCls}
            >
              {initials(ownerName)}
            </Link>
          ) : (
            <div className={ownerAvatarCls}>{initials(ownerName)}</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] leading-snug text-black">
              {ownerId ? (
                <Link
                  to={`/u/${ownerId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-extrabold underline"
                >
                  {ownerName}
                </Link>
              ) : (
                <span className="font-extrabold">{ownerName}</span>
              )}
              <span className="font-medium text-b2"> {headline}</span>
            </p>
            <p className="text-[11.5px] text-gd font-extrabold mt-0.5">
              <span className="inline-flex items-center gap-1">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
                  <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
                  <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                {svc.category || 'Service'}
              </span>
              {svc.location_text && <span className="text-b3 font-medium"> · {svc.location_text}</span>}
            </p>
          </div>
        </div>
        <div className={`h-[140px] rounded-[14px] overflow-hidden relative bg-gradient-to-br ${gradient}`}>
          {cover && (
            <img
              src={cover}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </div>
      </button>
      {/* Shared-by pill — separate from the PDP-tap button so the
          recommender avatar + name can navigate to the recommender's
          public profile without firing the PDP nav. */}
      <div className="mt-2.5 inline-flex items-center gap-1.5 bg-gl rounded-pill px-3 py-1">
        {goatId ? (
          <Link
            to={`/u/${goatId}`}
            aria-label={`View ${goatName}`}
            className={goatAvatarCls}
          >
            {initials(goatName)}
          </Link>
        ) : (
          <div className={goatAvatarCls}>{initials(goatName)}</div>
        )}
        <p className="text-[12px] text-gd font-extrabold">
          Shared by{' '}
          {goatId ? (
            <Link to={`/u/${goatId}`} className="underline">{goatName}</Link>
          ) : (
            goatName
          )}
          , Connector
        </p>
      </div>
    </div>
  );
}

export function ActivityScreen() {
  const navigate = useNavigate();
  const { auth } = useOutletContext() || {};
  const isSignedIn = !!auth?.isSignedIn;

  // Real data — loaded lazily on auth flip.
  const [bookings, setBookings]     = useState(null); // null = loading
  const [spotlights, setSpotlights] = useState(null);
  // CERGIO-GUARD: GOAT shares feed. Always loaded (public-ish data —
  // recommendations RLS is `select using (true)` so signed-out users
  // see the same feed). Hides the section when zero rows.
  const [goatShares, setGoatShares] = useState(null);
  useEffect(() => {
    if (!isSignedIn) { setBookings([]); setSpotlights([]); }
    else {
      listConsumerBookings().then(({ data }) => setBookings(data || []));
      listMyOutboundSpotlightRequests({ limit: 50 }).then(({ data }) => setSpotlights(data || []));
    }
    listGoatShares({ limit: 24 }).then(({ data }) => setGoatShares(data || []));
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
          What's happening on Cergio + your open requests.
        </p>
      </div>

      {/* ─── GOAT shares — real data only. Hidden when zero. ─────────────
          CERGIO-GUARD (2026-05-30): the cards here are REAL recommendations
          authored by Connectors (cc_verified_at NOT NULL). No fake feed,
          no fake numbers — see feedback_no_fake_feeds. */}
      {goatShares && goatShares.length > 0 && (
        <div className="mt-2 pb-4 border-b border-bdr">
          <div className="px-5 mb-3">
            <h2 className="text-[17px] font-extrabold text-black leading-tight">
              Connectors have shared their go-to services on Cergio
            </h2>
            <p className="text-[12px] text-gd font-extrabold mt-1">#cergioconnectors</p>
          </div>
          <div className="px-5 flex flex-col gap-5">
            {goatShares.map(row => (
              <GoatShareCard
                key={row.id}
                row={row}
                onClick={() => navigate(`/service/${row.service.id}`)}
              />
            ))}
          </div>
        </div>
      )}

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
