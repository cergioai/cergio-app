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
import { listConsumerBookings, listMyOutboundSpotlightRequests, listSocialFeed, getMyFollowedIds, getMyInviteCounts, getMyInvitesDetailed, followProfile, unfollowProfile } from '../lib/api';
import { stampActivitySeen } from '../hooks/useActivityUnread';
import { supabase, supabaseReady } from '../lib/supabase';
import { REWARDS } from '../lib/rewards';
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
  // Phase 6 (2026-06-01): "vice versa" — the consumer/Connector side of
  // the booking now reads the same exchange context the provider sees
  // on RequestDetailScreen. The booking row leads with the purpose
  // ("Free spotlight ask" / "Booking request"), so when this user
  // (the consumer in this row) opens their own activity, they see
  // what they asked for, not just a calendar event title.
  const isFree  = !!booking.is_free_for_rainmaker;
  const purpose = isFree ? 'Free spotlight ask' : 'Booking request';
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
        <p className={`text-[11px] font-extrabold leading-none mb-0.5 ${isFree ? 'text-gd' : 'text-b3'}`}>
          {purpose.toUpperCase()}
        </p>
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

// CERGIO-GUARD (2026-06-03): one-tap share. Web Share API first,
// clipboard fallback. Same icon set as ResultsScreen.share. Lives
// on every feed card so the user can forward any spotlight / reco
// / listing without leaving the feed.
async function shareItem({ title, text, url, onCopied }) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
  } catch { /* user cancelled */ return; }
  try {
    await navigator.clipboard.writeText(`${text}${url ? `\n${url}` : ''}`);
    onCopied?.();
  } catch { /* silent */ }
}
function ShareIconButton({ onClick, label = 'Share' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      aria-label={label}
      className="w-8 h-8 rounded-full bg-white border border-bdr text-b2 hover:text-gd hover:border-g/40
                 flex items-center justify-center flex-shrink-0 transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
      </svg>
    </button>
  );
}

// One share row matching the mockup: owner-name headline, category
// badge + city, single cover image (when present), and the "Shared by
// {Connector}, GOAT" pill at the bottom. Tap → routes to the service PDP.
function GoatShareCard({ row, onClick }) {
  // CERGIO-GUARD (2026-05-31): personalized feed copy per Tarik:
  // "your friend/Connector Jordan... Penny was spotlighted by
  // Connector X to 7388 followers". Card now reads as a single,
  // social-feed-style sentence:
  //   Penny Plumber — Plumbing · Miami Beach, FL
  //   Spotlighted by your Connector Connie Connect to 8,930 followers
  //
  // The headline owner-name + the actor's relation prefix
  // ("your Connector" / "your friend") + the actor's follower count
  // are all in one block. Follower count is the AUDIENCE reached,
  // not the count-free fallback the v1 had.
  const svc          = row.service;
  const goatName     = row.recommender.display_name || 'A Connector';
  const goatId       = row.recommender.id || null;
  const goatIsConn   = !!row.recommender.is_connector;
  const goatIsFriend = !!row.recommender.is_friend; // wired when graph lands
  const followers    = row.recommender.follower_count || 0;
  const ownerName    = svc.owner_display_name || svc.title;
  const ownerId      = svc.owner_id || null;
  const cover        = svc.cover_url;
  const gradient     = PHOTO_GRADIENTS[svc.photo_class] || PHOTO_GRADIENTS['fv-jamie'];

  // CERGIO-GUARD (2026-06-03 v2): priority flipped to Connector >
  // Friend per Tarik — "your Connector Connie Connect spotlighted
  // Maria...". A Connector's role is the salient signal (and only
  // appears here when the viewer FOLLOWS them), so it wins the
  // prefix. Plain followed users (no Connector status) fall back
  // to "your friend".
  const relation = goatIsConn
    ? 'your Connector'
    : goatIsFriend
      ? 'your friend'
      : null;

  // Both avatars (owner + recommender pill) are Links to public
  // profiles. The card itself is also clickable → service PDP, so the
  // avatar Links stopPropagation to avoid double-navigation.
  const ownerAvatarCls = `w-10 h-10 rounded-full bg-gradient-to-br from-[#5BC404] to-[#2F6E00]
                          text-white text-[12px] font-extrabold flex items-center justify-center flex-shrink-0`;
  const goatAvatarCls  = `w-5 h-5 rounded-full bg-gradient-to-br from-[#5BC404] to-[#2F6E00]
                          text-white text-[9px] font-extrabold flex items-center justify-center`;

  const serviceTypeLabel = svc.taxonomy_provider_type || svc.category || 'Service';
  const shareUrl  = typeof window !== 'undefined'
    ? `${window.location.origin}/service/${svc.id}`
    : `/service/${svc.id}`;
  const shareText = `${relation ? relation + ' ' : ''}${goatName} spotlighted ${ownerName} (${serviceTypeLabel}${svc.location_text ? ' · ' + svc.location_text : ''})${followers > 0 ? ` to ${followers.toLocaleString()} followers` : ''}.`;

  return (
    <div className="w-full text-left bg-white border border-bdr rounded-[16px] p-3.5">
      {/* CERGIO-GUARD (2026-06-03): all the WHO / WHAT / TO-WHOM lives
          in ONE block at the top of the card per Tarik — actor pill,
          service title, type + location, audience reached. Photo is
          DECORATION only, sits below the text block. Share button
          right-aligned in the same row as the actor. */}
      <div className="flex items-start gap-2.5">
        {goatId ? (
          <Link
            to={`/u/${goatId}`}
            aria-label={`View ${goatName}`}
            onClick={(e) => e.stopPropagation()}
            className={ownerAvatarCls}
          >
            {initials(goatName)}
          </Link>
        ) : (
          <div className={ownerAvatarCls}>{initials(goatName)}</div>
        )}
        <p className="flex-1 min-w-0 text-[14px] leading-snug text-black">
          <span className="font-medium text-b2">
            {relation ? `${relation} ` : ''}
          </span>
          {goatId ? (
            <Link
              to={`/u/${goatId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-extrabold underline"
            >
              {goatName}
            </Link>
          ) : (
            <span className="font-extrabold">{goatName}</span>
          )}
          <span className="font-medium text-b2"> spotlighted </span>
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
          <span className="font-medium text-b2">
            {' '}({serviceTypeLabel}{svc.location_text ? ` · ${svc.location_text}` : ''})
          </span>
          {followers > 0 && (
            <span className="font-medium text-b2"> to {followers.toLocaleString()} followers</span>
          )}
        </p>
        <ShareIconButton
          onClick={() => shareItem({ title: ownerName, text: shareText, url: shareUrl })}
          label={`Share ${ownerName}`}
        />
      </div>
      {/* Photo — pure decoration, tap to open PDP. */}
      <button
        onClick={onClick}
        className="block w-full mt-2.5 text-left bg-transparent border-none p-0 cursor-pointer"
        aria-label={`View ${ownerName}`}
      >
        <div className={`h-[120px] rounded-[12px] overflow-hidden relative bg-gradient-to-br ${gradient}`}>
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
    </div>
  );
}

// CERGIO-GUARD (2026-05-30): "X joined Cergio" card — small, single-
// row, avatar + name. No image (signups aren't media events). Connector
// signups get the Connector chip; everyone else just the join verb.
function JoinedCard({ ev }) {
  const p = ev.profile;
  const avatarCls = `w-10 h-10 rounded-full bg-gradient-to-br from-[#5BC404] to-[#2F6E00]
                     text-white text-[12px] font-extrabold flex items-center justify-center flex-shrink-0`;
  return (
    <div className="flex items-center gap-2.5">
      {p.id ? (
        <Link to={`/u/${p.id}`} aria-label={`View ${p.display_name}`} className={avatarCls}>
          {initials(p.display_name)}
        </Link>
      ) : (
        <div className={avatarCls}>{initials(p.display_name)}</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] leading-snug text-black">
          {p.id ? (
            <Link to={`/u/${p.id}`} className="font-extrabold underline">{p.display_name}</Link>
          ) : (
            <span className="font-extrabold">{p.display_name}</span>
          )}
          <span className="font-medium text-b2"> joined Cergio</span>
        </p>
        <p className="text-[11.5px] text-b3 font-medium mt-0.5">
          {timeAgo(ev.at)}
          {p.is_connector && <span className="text-gd font-extrabold"> · Connector</span>}
        </p>
      </div>
    </div>
  );
}

// CERGIO-GUARD (2026-05-30): "X listed a new service" card. Mid-size
// — name + small cover image so the listing reads as a "new thing
// available" event rather than a heavy reco. Tap the row → service PDP.
function ListingCard({ ev, onClick }) {
  const svc   = ev.service;
  const owner = ev.owner;
  const ownerName = owner?.display_name || 'A provider';
  const ownerId   = owner?.id || null;
  const gradient  = PHOTO_GRADIENTS[svc.photo_class] || PHOTO_GRADIENTS['fv-jamie'];
  const cover     = svc.cover_url;
  const avatarCls = `w-10 h-10 rounded-full bg-gradient-to-br from-[#5BC404] to-[#2F6E00]
                     text-white text-[12px] font-extrabold flex items-center justify-center flex-shrink-0`;
  // CERGIO-GUARD (2026-06-03): inline share for the listing announcement.
  const serviceTypeLabel = svc.taxonomy_provider_type || svc.category || 'Service';
  const shareUrl  = typeof window !== 'undefined'
    ? `${window.location.origin}/service/${svc.id}`
    : `/service/${svc.id}`;
  const shareText = `${ownerName} listed a new service: ${svc.title} (${serviceTypeLabel}${svc.location_text ? ' · ' + svc.location_text : ''}).`;
  return (
    <div className="w-full text-left bg-white border border-bdr rounded-[16px] p-3.5">
      <div className="flex items-start gap-2.5">
        <button onClick={onClick} className="flex-1 flex items-start gap-2.5 text-left bg-transparent border-none p-0 cursor-pointer min-w-0">
          {ownerId ? (
            <Link
              to={`/u/${ownerId}`}
              aria-label={`View ${ownerName}`}
              onClick={(e) => e.stopPropagation()}
              className={avatarCls}
            >
              {initials(ownerName)}
            </Link>
          ) : (
            <div className={avatarCls}>{initials(ownerName)}</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[14px] leading-snug text-black">
              {ownerId ? (
                <Link to={`/u/${ownerId}`} onClick={(e) => e.stopPropagation()} className="font-extrabold underline">
                  {ownerName}
                </Link>
              ) : (
                <span className="font-extrabold">{ownerName}</span>
              )}
              <span className="font-medium text-b2"> listed a new service: </span>
              <span className="font-extrabold">{svc.title}</span>
              <span className="font-medium text-b2">
                {' '}({serviceTypeLabel}{svc.location_text ? ` · ${svc.location_text}` : ''})
              </span>
            </p>
          </div>
        </button>
        <ShareIconButton
          onClick={() => shareItem({ title: svc.title, text: shareText, url: shareUrl })}
          label={`Share ${svc.title}`}
        />
      </div>
      <button onClick={onClick} className="block w-full mt-2.5 text-left bg-transparent border-none p-0 cursor-pointer" aria-label={`View ${svc.title}`}>
        <div className={`h-[120px] rounded-[12px] overflow-hidden relative bg-gradient-to-br ${gradient}`}>
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
    </div>
  );
}

// CERGIO-GUARD (2026-05-30): "X spotlighted Y on Instagram/TikTok"
// card. Single-line summary linking both profiles. Small platform
// chip so it's distinguishable at a glance from regular recos.
function SpotlightCard({ ev }) {
  const connector = ev.connector;
  const requester = ev.requester;
  const platform  = ev.platform === 'tiktok' ? 'TikTok' : 'Instagram';
  const avatarCls = `w-10 h-10 rounded-full bg-gradient-to-br from-[#8A6FD6] to-[#4F3DB0]
                     text-white text-[12px] font-extrabold flex items-center justify-center flex-shrink-0`;
  const cName = connector?.display_name || 'A Connector';
  const rName = requester?.display_name || 'a provider';
  return (
    <div className="flex items-center gap-2.5">
      {connector?.id ? (
        <Link to={`/u/${connector.id}`} aria-label={`View ${cName}`} className={avatarCls}>
          {initials(cName)}
        </Link>
      ) : (
        <div className={avatarCls}>{initials(cName)}</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] leading-snug text-black">
          {connector?.id ? (
            <Link to={`/u/${connector.id}`} className="font-extrabold underline">{cName}</Link>
          ) : (
            <span className="font-extrabold">{cName}</span>
          )}
          <span className="font-medium text-b2"> spotlighted </span>
          {requester?.id ? (
            <Link to={`/u/${requester.id}`} className="font-extrabold underline">{rName}</Link>
          ) : (
            <span className="font-extrabold">{rName}</span>
          )}
          <span className="font-medium text-b2"> on {platform}</span>
        </p>
        <p className="text-[11.5px] text-b3 font-medium mt-0.5">
          {timeAgo(ev.at)}
        </p>
      </div>
    </div>
  );
}

export function ActivityScreen() {
  const navigate = useNavigate();
  const { auth } = useOutletContext() || {};
  const isSignedIn = !!auth?.isSignedIn;

  // CERGIO-GUARD (2026-06-05 v7): network tabs per Tarik's video
  // (timer 6:36-6:42 + 2:48-3:11). Four discrete views over the same
  // social graph: Summary (aggregates + recent), Friends (invites
  // I sent w/ status), Connectors (ambassadors w/ follow + reco
  // count), Feed (existing social feed).
  const [activeTab, setActiveTab] = useState('feed');

  // Real data — loaded lazily on auth flip.
  const [bookings, setBookings]     = useState(null); // null = loading
  const [spotlights, setSpotlights] = useState(null);
  const [inviteCounts, setInviteCounts]   = useState({ invited: 0, joined: 0, booked: 0 });
  const [invitesDetailed, setInvitesDetailed] = useState(null);
  const [connectors, setConnectors] = useState(null);
  // CERGIO-GUARD (2026-05-30): unified social feed. Replaces the old
  // Connector-only goatShares list. Includes friend recos, Connector
  // shares, new sign-ups ("X joined Cergio"), new service listings,
  // and confirmed spotlights — all from real tables, never mocked.
  // Tarik: "need to see all recommendations from friends, bookings,
  // joining, spotlights... friend announced a service, friend joined".
  const [feed, setFeed] = useState(null);
  // CERGIO-GUARD (2026-06-03): viewer's followed set drives which
  // events surface AND which carry the "your Connector / your friend"
  // prefix. Following a Connector OR a service provider counts as
  // "friend equivalent" per Tarik 2026-06-03.
  const [followedIds, setFollowedIds] = useState(new Set());
  useEffect(() => {
    if (!isSignedIn) {
      setBookings([]); setSpotlights([]); setFollowedIds(new Set());
      setInviteCounts({ invited: 0, joined: 0, booked: 0 });
      setInvitesDetailed([]); setConnectors([]);
    } else {
      listConsumerBookings().then(({ data }) => setBookings(data || []));
      listMyOutboundSpotlightRequests({ limit: 50 }).then(({ data }) => setSpotlights(data || []));
      getMyFollowedIds().then(({ data }) => setFollowedIds(new Set(data || [])));
      getMyInviteCounts().then(({ data }) => setInviteCounts(data || { invited: 0, joined: 0, booked: 0 }));
      getMyInvitesDetailed({ limit: 100 }).then(({ data }) => setInvitesDetailed(data || []));
      // Connectors = profiles with cc_verified_at set. Pull the top
      // 50 ordered by verified date; tab UI surfaces follow state +
      // recos count derived from the row.
      if (supabaseReady) {
        supabase
          .from('profiles')
          .select('id, display_name, avatar_url, instagram_handle, tiktok_handle, instagram_followers, tiktok_followers, cc_verified_at')
          .not('cc_verified_at', 'is', null)
          .order('cc_verified_at', { ascending: false })
          .limit(50)
          .then(({ data }) => setConnectors(data || []));
      }
    }
    listSocialFeed({ limit: 40, days: 60 }).then(({ data }) => setFeed(data || []));
    // CERGIO-GUARD (2026-06-05 v3): stamp lastActivitySeenAt so the
    // BottomNav red-dot clears once the user lands here. See
    // useActivityUnread hook for the read-side.
    stampActivitySeen();
  }, [isSignedIn]);

  // Active = anything that isn't in a terminal state — those are what
  // the user actually wants to see in "Open requests".
  const TERMINAL = ['completed', 'cleared', 'confirmed', 'declined', 'cancelled', 'expired'];
  const openBookings   = (bookings   || []).filter(b => !TERMINAL.includes(b.status));
  const openSpotlights = (spotlights || []).filter(s => !TERMINAL.includes(s.status));
  const hasOpen        = openBookings.length > 0 || openSpotlights.length > 0;

  // Friend graph aggregates for Summary tab.
  const recsAuthored = (invitesDetailed || []).filter(i => !!i.recipient_phone_for_reco || i.kind === 'reco').length;
  const totalActivities = (feed || []).length;

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24 overflow-y-auto">
      <div className="px-5 pt-8 pb-2">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">Activity</h1>
        <p className="text-[13px] text-b3 font-medium mt-1.5 leading-snug">
          Your network at a glance.
        </p>
      </div>

      {/* CERGIO-GUARD (2026-06-05 v7): network tabs per Tarik's video
          (6:36-6:42) — Summary / Friends / Connectors / Feed. Compact
          pill bar; keyboard accessible. Active tab = bold + filled. */}
      <div className="px-5 mb-3" role="tablist" aria-label="Network">
        <div className="flex bg-bg5 rounded-pill p-1">
          {[
            { id: 'summary',    label: 'Summary' },
            { id: 'friends',    label: 'Friends' },
            { id: 'connectors', label: 'Connectors' },
            { id: 'feed',       label: 'Feed' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 rounded-pill py-1.5 text-[12px] font-extrabold transition-colors
                ${activeTab === t.id ? 'bg-white text-black shadow-sm' : 'text-b3 hover:text-b2'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary tab ─────────────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="px-5 mb-3 flex flex-col gap-3">
          {/* Count tiles — friends + services + activity */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { n: inviteCounts.invited, label: 'friends invited', onClick: () => setActiveTab('friends') },
              { n: inviteCounts.joined,  label: 'friends joined',  onClick: () => setActiveTab('friends') },
              { n: inviteCounts.booked,  label: 'friends booked',  onClick: () => setActiveTab('friends') },
            ].map(c => (
              <button
                key={c.label}
                type="button"
                onClick={c.onClick}
                className="bg-white border border-bdr rounded-[12px] py-2.5 px-2 text-left hover:bg-bg5/40 transition-colors"
              >
                <p className="text-[20px] font-extrabold text-black leading-none">{c.n}</p>
                <p className="text-[10.5px] text-b3 font-extrabold uppercase tracking-wide mt-0.5">{c.label}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { n: recsAuthored,   label: 'recos sent',  onClick: () => navigate('/invite/recommend') },
              { n: connectors?.length || 0, label: 'connectors', onClick: () => setActiveTab('connectors') },
              { n: totalActivities, label: 'activities', onClick: () => setActiveTab('feed') },
            ].map(c => (
              <button
                key={c.label}
                type="button"
                onClick={c.onClick}
                className="bg-white border border-bdr rounded-[12px] py-2.5 px-2 text-left hover:bg-bg5/40 transition-colors"
              >
                <p className="text-[20px] font-extrabold text-black leading-none">{c.n}</p>
                <p className="text-[10.5px] text-b3 font-extrabold uppercase tracking-wide mt-0.5">{c.label}</p>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => navigate('/invite/friends-popup')}
              className="flex-1 bg-g text-white rounded-pill py-2.5 text-[12.5px] font-extrabold"
            >
              Invite a friend
            </button>
            <button
              type="button"
              onClick={() => navigate('/invite/recommend')}
              className="flex-1 bg-white border border-bdr text-b2 rounded-pill py-2.5 text-[12.5px] font-extrabold"
            >
              Reco a provider
            </button>
          </div>

          <p className="text-[11.5px] text-b3 leading-snug mt-1">
            Every friend who joins + books earns you {' '}
            <span className="font-extrabold text-black">${REWARDS.perFriendUser} credit</span>{' '}
            (up to ${REWARDS.perFriend}) — plus {' '}
            <span className="font-extrabold text-black">${REWARDS.friendOfFriendBonus}</span>{' '}
            per friend-of-friend signup.
          </p>
        </div>
      )}

      {/* ── Friends tab ─────────────────────────────────────────────── */}
      {activeTab === 'friends' && (
        <NetworkFriendsTab invitesDetailed={invitesDetailed} navigate={navigate} />
      )}

      {/* ── Connectors tab ──────────────────────────────────────────── */}
      {activeTab === 'connectors' && (
        <NetworkConnectorsTab
          connectors={connectors}
          followedIds={followedIds}
          onToggleFollow={async (id, isFollowing) => {
            if (isFollowing) {
              await unfollowProfile(id);
              setFollowedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            } else {
              await followProfile(id);
              setFollowedIds(prev => new Set(prev).add(id));
            }
          }}
          navigate={navigate}
        />
      )}

      {/* Feed tab — wraps the existing feed IIFE + open requests
          below. CERGIO-GUARD (2026-06-05 v7): kept the original
          block intact; just gated rendering by activeTab. */}
      {activeTab === 'feed' && <>

      {/* ─── Social feed — real data only. Hidden when zero. ──────────
          CERGIO-GUARD (2026-05-30): unified feed mixing four event
          kinds (reco / join / listing / spotlight). Each event renders
          with its own card style. All rows come from real tables —
          recommendations / profiles / services / spotlight_requests.
          See feedback_no_fake_feeds.
          CERGIO-GUARD (2026-05-31): per Tarik "you don't see anything
          unless it's from Connectors or your network (friends and
          friends-of-friends recommending or booking or listing a
          service)". The friend graph isn't in the DB yet — filter
          to Connector-driven events only. When the graph lands,
          extend the predicate to include is_friend / is_fof. */}
      {(() => {
        // CERGIO-GUARD (2026-06-03): filter to events whose primary
        // actor the viewer FOLLOWS. Tarik: "users see only friends and
        // friends-of-friends or Connectors they follow". Following IS
        // the friend-equivalent signal — Connector status alone no
        // longer earns a slot in the feed.
        const isFollowed = (id) => !!id && followedIds.has(id);
        // Stamp is_friend on the relevant actor profile so each card's
        // existing "your friend / your Connector" logic reads true
        // for followed actors. Mutating the row in-place is safe here
        // because we re-build visibleFeed every render.
        const visibleFeed = (feed || []).filter(ev => {
          if (ev.kind === 'reco') {
            if (!isFollowed(ev.recommender?.id)) return false;
            ev.recommender.is_friend = true;
            return true;
          }
          if (ev.kind === 'spotlight') {
            const cFollowed = isFollowed(ev.connector?.id);
            const rFollowed = isFollowed(ev.requester?.id);
            if (!cFollowed && !rFollowed) return false;
            if (cFollowed && ev.connector) ev.connector.is_friend = true;
            if (rFollowed && ev.requester) ev.requester.is_friend = true;
            return true;
          }
          if (ev.kind === 'listing') {
            if (!isFollowed(ev.owner?.id)) return false;
            if (ev.owner) ev.owner.is_friend = true;
            return true;
          }
          if (ev.kind === 'join') {
            if (!isFollowed(ev.profile?.id)) return false;
            if (ev.profile) ev.profile.is_friend = true;
            return true;
          }
          return false;
        });
        // CERGIO-GUARD (2026-06-04 v8): when the viewer follows
        // nobody yet, the feed silently disappeared — empty state
        // felt broken. Replace with a single Follow-Connectors CTA
        // card that opens BrowseConnectors so the feed has a clear
        // first action. Signed-out users get the standard "Sign in
        // to follow" cue.
        if (visibleFeed.length === 0) {
          if (followedIds.size === 0) {
            return (
              <div className="mt-2 pb-4 border-b border-bdr">
                <div className="px-5 mb-3">
                  <h2 className="text-[17px] font-extrabold text-black leading-tight">
                    What&apos;s happening on Cergio
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(isSignedIn ? '/connectors' : '/auth')}
                  className="mx-5 w-[calc(100%-2.5rem)] bg-gradient-to-br from-gl to-white border border-g/30 rounded-[16px] p-4 text-left hover:from-gl/80 hover:to-gl/40 transition-colors"
                >
                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-gd">Your feed</p>
                  <p className="text-[15px] font-extrabold text-black leading-snug mt-1">
                    {isSignedIn
                      ? 'Follow Connectors to see their picks here.'
                      : 'Sign in + follow Connectors to see their picks here.'}
                  </p>
                  <p className="text-[12px] text-b3 font-medium mt-1.5 leading-snug">
                    {isSignedIn
                      ? <>Connectors are the locals who spotlight services worth booking. <span className="text-gd font-extrabold">Browse Connectors →</span></>
                      : <>Connectors are the locals who spotlight services worth booking. <span className="text-gd font-extrabold">Sign in →</span></>}
                  </p>
                </button>
              </div>
            );
          }
          return null;
        }
        return (
        <div className="mt-2 pb-4 border-b border-bdr">
          <div className="px-5 mb-3">
            <h2 className="text-[17px] font-extrabold text-black leading-tight">
              What&apos;s happening on Cergio
            </h2>
            <p className="text-[12px] text-gd font-extrabold mt-1">From your Connectors and network · #cergiofeed</p>
          </div>
          <div className="px-5 flex flex-col gap-5">
            {visibleFeed.map(ev => {
              if (ev.kind === 'reco') {
                return (
                  <GoatShareCard
                    key={ev.id}
                    row={ev}
                    onClick={() => navigate(`/service/${ev.service.id}`)}
                  />
                );
              }
              if (ev.kind === 'join') {
                return <JoinedCard key={ev.id} ev={ev} />;
              }
              if (ev.kind === 'listing') {
                return (
                  <ListingCard
                    key={ev.id}
                    ev={ev}
                    onClick={() => navigate(`/service/${ev.service.id}`)}
                  />
                );
              }
              if (ev.kind === 'spotlight') {
                return <SpotlightCard key={ev.id} ev={ev} />;
              }
              return null;
            })}
          </div>
        </div>
        );
      })()}

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

      </>}
    </div>
  );
}

// CERGIO-GUARD (2026-06-05 v7): network sub-tabs from Tarik's video.
// Friends tab — list of invites I sent with their join/book status.
// Each row taps into the invitee's public profile if they joined.
function NetworkFriendsTab({ invitesDetailed, navigate }) {
  if (invitesDetailed === null) {
    return <p className="px-5 mt-4 text-[13px] text-b3">Loading friends…</p>;
  }
  if (invitesDetailed.length === 0) {
    return (
      <div className="mx-5 mt-4 bg-gradient-to-br from-gl to-white border border-g/30 rounded-[16px] p-4">
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-gd">Friends</p>
        <p className="text-[15px] font-extrabold text-black leading-snug mt-1">No friends yet.</p>
        <p className="text-[12px] text-b3 font-medium mt-1.5 leading-snug">
          Invite friends to start building your network.{' '}
          <button
            type="button"
            onClick={() => navigate('/invite/friends-popup')}
            className="text-gd font-extrabold underline-offset-2 hover:underline bg-transparent border-none p-0 cursor-pointer"
          >
            Send invite →
          </button>
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {invitesDetailed.map(inv => {
        const name = inv.invitee?.display_name
          || inv.invitee_phone
          || inv.invitee_email
          || 'Friend';
        const joined = !!inv.invitee?.id;
        const booked = !!inv.first_booking_at;
        const status = booked ? 'Booked' : joined ? 'Joined' : 'Pending';
        const statusClass = booked
          ? 'bg-gl text-gd'
          : joined
            ? 'bg-bg5 text-b2'
            : 'bg-warnBg text-warnText';
        const initials = String(name)
          .split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase() || '?';
        return (
          <button
            key={inv.id}
            type="button"
            onClick={() => {
              if (joined) navigate(`/u/${inv.invitee.id}`);
              else navigate('/earnings/invites');
            }}
            className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-bg5/30 border-b border-bdr"
          >
            <div className="w-10 h-10 rounded-full bg-bg5 flex items-center justify-center text-black text-[14px] font-extrabold flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-extrabold text-black truncate">{name}</p>
              <p className="text-[11.5px] text-b3 mt-0.5">
                Invited {inv.invited_at ? new Date(inv.invited_at).toLocaleDateString() : '—'}
              </p>
            </div>
            <span className={`text-[10.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-pill ${statusClass}`}>
              {status}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Connectors tab — verified Connectors with follow + recos count.
function NetworkConnectorsTab({ connectors, followedIds, onToggleFollow, navigate }) {
  if (connectors === null) {
    return <p className="px-5 mt-4 text-[13px] text-b3">Loading Connectors…</p>;
  }
  if (connectors.length === 0) {
    return (
      <div className="mx-5 mt-4 bg-white border border-bdr rounded-[16px] p-4">
        <p className="text-[13px] font-extrabold text-black mb-1">No Connectors yet</p>
        <p className="text-[11.5px] text-b3 leading-snug">
          Connectors are locals with reach who spotlight services on IG + TikTok.
          They show up here as they verify.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {connectors.map(c => {
        const isFollowing = followedIds.has(c.id);
        const name = c.display_name || c.instagram_handle || c.tiktok_handle || 'Connector';
        const initials = String(name)
          .split(/\s+/).map(s => s[0] || '').slice(0, 2).join('').toUpperCase() || '?';
        const reach = (c.instagram_followers || 0) + (c.tiktok_followers || 0);
        return (
          <div
            key={c.id}
            className="w-full px-5 py-3 flex items-center gap-3 border-b border-bdr hover:bg-bg5/30"
          >
            <button
              type="button"
              onClick={() => navigate(`/u/${c.id}`)}
              className="w-10 h-10 rounded-full bg-bg5 flex items-center justify-center text-black text-[14px] font-extrabold flex-shrink-0 cursor-pointer border-none"
              aria-label={`Open ${name}`}
            >
              {initials}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/u/${c.id}`)}
              className="flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer"
            >
              <p className="text-[14px] font-extrabold text-black truncate">{name}</p>
              <p className="text-[11.5px] text-b3 mt-0.5 truncate">
                {c.instagram_handle && <>IG @{c.instagram_handle}</>}
                {c.instagram_handle && c.tiktok_handle && ' · '}
                {c.tiktok_handle && <>TT @{c.tiktok_handle}</>}
                {reach > 0 && <> · {reach >= 1000 ? `${(reach/1000).toFixed(1).replace(/\.0$/,'')}K` : reach} reach</>}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onToggleFollow(c.id, isFollowing)}
              className={`rounded-pill px-3 py-1 text-[11.5px] font-extrabold whitespace-nowrap ${isFollowing ? 'bg-bg5 text-b2' : 'bg-g text-white'}`}
            >
              {isFollowing ? 'Following' : 'Follow'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
