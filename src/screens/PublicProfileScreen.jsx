// CERGIO-GUARD (2026-05-30): Public profile view for any Cergio user.
//
// Route: /u/:profileId
//
// Wired from every avatar in the app — PDP recommender stack/lead, the
// Activity-feed GoatShareCard (owner + recommender pill avatars), the
// ResultsScreen ProviderCard friend stack. The view is modeled on
// Tarik's 7 attached mockups (Jennifer Leighton + Jacob Flores empty
// state) and is read-only — owners edit via /profile.
//
// Sections (all from real DB rows; empty sections collapse silently —
// never fake-data, per feedback_no_fake_feeds):
//   • Header — close button, large avatar, big name, role badge,
//     Connector badge when cc_verified_at NOT NULL
//   • About — bio prose (with "No bio yet" empty state)
//   • Social — IG handle + follower count, falls back to plain "Instagram"
//     when not connected
//   • {Name}'s Services — services they own (top 1–N, opens PDP on tap)
//   • People who love {Name} — review rows from bookings on those services
//   • {Name}'s Go-Tos — services this profile has recommended (recommendations
//     authored by them, joined to services + service owners)
//
// Every nested avatar that points at another user is itself a Link
// to /u/{their-id}, so the graph is fully navigable.

import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { followProfile, unfollowProfile, amIFollowing, getPublicProfileStats, respondToRequest, getInboxPartyCounts, isConnectorProfile } from '../lib/api';
import { ProfileSignalBlock } from '../components/ui/ProfileSignalBlock';
import { REWARDS } from '../lib/rewards';

function initialsOf(name) {
  if (!name) return '?';
  return name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase();
}

// Brand-friendly gradient pool — same set as ServiceDetailScreen so the
// avatar colors stay consistent across the app.
const AV_GRADS = [
  'bg-gradient-to-br from-[#8A6FD6] to-[#4F3DB0]',
  'bg-gradient-to-br from-[#F5A65E] to-[#C76A18]',
  'bg-gradient-to-br from-[#EE5586] to-[#A52454]',
  'bg-gradient-to-br from-[#5BC404] to-[#2F6E00]',
  'bg-gradient-to-br from-[#4478AA] to-[#2A5070]',
];
const PHOTO_GRADIENTS = {
  'fv-jamie': 'from-[#e8dcc8] via-[#b89870] to-[#604030]',
  'fv-john':  'from-[#cad8e8] via-[#7088b0] to-[#2e4060]',
  'fv-steve': 'from-[#d8e8ca] via-[#88b070] to-[#406030]',
};

function gradFor(id, fallback = 0) {
  if (!id) return AV_GRADS[fallback];
  // Stable hash → consistent color per profile id.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AV_GRADS[Math.abs(h) % AV_GRADS.length];
}

// Small circular avatar that's also a link to that user's public profile.
// `clickable` defaults to true; pass false to render a non-link circle
// (e.g. when the avatar belongs to the page's own subject and tapping
// would be a no-op).
function AvatarLink({ id, name, size = 40, className = '', clickable = true }) {
  const cls = `${gradFor(id)} rounded-full text-white font-extrabold
               flex items-center justify-center flex-shrink-0 ${className}`;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.32)) };
  const body  = initialsOf(name);
  if (!clickable || !id) {
    return <span className={cls} style={style}>{body}</span>;
  }
  return (
    <Link to={`/u/${id}`} className={cls} style={style} aria-label={`View ${name || 'profile'}`}>
      {body}
    </Link>
  );
}

function ConnectorBadge() {
  return (
    <span className="inline-flex items-center gap-2 bg-gl border border-g/30 rounded-pill px-3.5 py-1.5 text-body-sm text-gd font-extrabold">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
      </svg>
      Verified Connector
    </span>
  );
}

function RoleBadge({ label }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-body-sm text-gd font-extrabold">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
        <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
        <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
      {label}
    </span>
  );
}

function fmtMonthYear(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// One service-card row (used in the "Their Services" + "Their Go-Tos"
// sections). Cover image or photo-class gradient fallback. Tap → PDP.
function ServiceTile({ svc, recoSummary, onOpen }) {
  const grad = PHOTO_GRADIENTS[svc.photo_class] || PHOTO_GRADIENTS['fv-jamie'];
  const price = svc.price_cents != null ? Math.round(svc.price_cents / 100) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-white border border-bdr rounded-[16px] overflow-hidden hover:border-g/40 cg-tap"
    >
      <div className={`relative h-[160px] bg-gradient-to-br ${grad}`}>
        {svc.cover_url && (
          <img
            src={svc.cover_url}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                         w-10 h-10 rounded-full bg-white/85 flex items-center justify-center text-base pl-0.5">
          ▶
        </span>
      </div>
      <div className="p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-body-lg font-extrabold text-black truncate">{svc.title || 'Service'}</p>
          {price != null && (
            <p className="text-body-lg font-extrabold text-black">
              {price === 0 ? 'Free' : `$${price}`}
            </p>
          )}
        </div>
        {svc.category && (
          <p className="inline-flex items-center gap-1 text-meta text-gd font-extrabold mt-0.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
              <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
              <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            {svc.taxonomy_provider_type || svc.category}
          </p>
        )}
        {svc.description && (
          <p className="text-meta text-b3 leading-snug mt-1.5 line-clamp-2">{svc.description}</p>
        )}
        {recoSummary && recoSummary.total > 0 && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 bg-gl rounded-pill px-3 py-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4" aria-hidden="true">
              <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
            </svg>
            <p className="text-meta-sm text-gd font-extrabold leading-none">
              Reco&apos;d by {recoSummary.friends || 0} {(recoSummary.friends === 1) ? 'friend' : 'friends'}
              {recoSummary.connectors > 0 && (
                <> and {recoSummary.connectors} {recoSummary.connectors === 1 ? 'Connector' : 'Connectors'}</>
              )}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}

export function PublicProfileScreen() {
  const navigate = useNavigate();
  const { profileId } = useParams();
  const [searchParams] = useSearchParams();
  // Request context — populated when opened from the Inbox via ?reqId=
  const reqId = searchParams.get('reqId') || null;
  const myServiceId = searchParams.get('myServiceId') || null;

  // CERGIO-GUARD (2026-06-03): viewer's auth context — needed for Follow.
  const outlet = useOutletContext() || {};
  const auth = outlet.auth;
  // Viewer priority (SPEC-49/48c): consumer mode (false) → service facet leads;
  // provider mode (true) → connector facet leads. Same rule as request previews.
  const serviceMode = !!outlet.serviceMode;
  const showToast = outlet.showToast || ((m) => { /* eslint-disable-next-line no-console */ console.log('[toast]', m); });

  const [profile, setProfile] = useState(null);
  // Follow state — null = unknown, true/false = known.
  const [following, setFollowing] = useState(null);
  const [followPending, setFollowPending] = useState(false);
  // Request-context bar state (when ?reqId= is set).
  const [reqCtx, setReqCtx] = useState(null);
  const [respondingInline, setRespondingInline] = useState(null); // null | 'pending' | 'done'
  const [counterOpenInline, setCounterOpenInline] = useState(false);
  const [counterDraftInline, setCounterDraftInline] = useState('');
  // CERGIO-GUARD (2026-06-04): network-impact stats — Invited / Joined
  // / Booked / Reco'd / Services. Counts only; $ amounts stay private
  // to the self-view via EarningsScreen.
  const [stats, setStats] = useState(null);
  // Party-signal counts for the lead block — SAME source as the request
  // previews (getInboxPartyCounts → formatKeyCounts) so a profile is judged
  // with identical data + ordering (SPEC-49).
  const [counts, setCounts] = useState(null);
  // Recommendations RECEIVED on this profile's services — "People who love
  // {name}" (Tarik 2026-06-16: recos received, not the bookings-review table).
  const [recosReceived, setRecosReceived] = useState([]);
  const [services, setServices] = useState([]);
  // svcId → { total, friends, connectors }
  const [svcRecoSummary, setSvcRecoSummary] = useState({});
  // Reviews on services this profile owns: { id, stars, comment, reviewer:{id,name}, booked_at }
  const [reviews, setReviews] = useState([]);
  // Recommendations this profile has authored, joined to services + owners.
  const [recoServices, setRecoServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // "See all (N) →" pagination toggles per § 5.5 — collapsed by default
  // (top 4 / 5 / 6 rows shown), tap to expand the section in place. No
  // sub-route needed; the affordance is a soft expand within the page so
  // every Reco'd / review / service remains discoverable without
  // bouncing the user off the profile they're inspecting.
  const [showAllServices, setShowAllServices] = useState(false);
  const [showAllReviews,  setShowAllReviews]  = useState(false);
  const [showAllGoTos,    setShowAllGoTos]    = useState(false);

  // CERGIO-GUARD (2026-06-03): probe whether the signed-in viewer
  // already follows this profile. Used to gate the Follow / Following
  // button.
  useEffect(() => {
    if (!auth?.isSignedIn || !profileId) { setFollowing(null); return; }
    let cancelled = false;
    amIFollowing(profileId).then(({ data }) => {
      if (!cancelled) setFollowing(!!data);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn, profileId]);

  // Network-impact stats — public, no $ amounts.
  useEffect(() => {
    if (!profileId) { setStats(null); return; }
    let cancelled = false;
    getPublicProfileStats(profileId).then(({ data }) => {
      if (!cancelled) setStats(data);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  // Lead party-signal counts (mutual · network · recos · IG/TikTok · connector).
  useEffect(() => {
    if (!profileId) { setCounts(null); return; }
    let cancelled = false;
    getInboxPartyCounts([profileId]).then(({ data }) => {
      if (!cancelled) setCounts((data || {})[profileId] || null);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  // QUARANTINED (2026-06-14): the old ?reqId= sticky Accept/Counter/Decline
  // bar is RETIRED — the canonical response surface is now /inbound/:reqId
  // (RequestFromConnectorScreen, SPEC-48). The Inbox no longer links here with
  // ?reqId, so we never hydrate reqCtx; the bar below can never render. Kept
  // the dead branch only to avoid touching the large render tree.
  useEffect(() => { setReqCtx(null); }, [reqId]);

  useEffect(() => {
    if (!supabaseReady || !profileId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);

      // Profile + Connector flag + IG/TikTok handles.
      // CERGIO-GUARD (2026-05-30): SELECT trimmed to columns that
      // actually exist on profiles. avatar_url was rejected by
      // PostgREST (column doesn't exist), which silently nulled the
      // whole row → "blank profile page" bug Tarik hit. Now we only
      // ask for what's verified across api.js.
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id, display_name, headline, bio, cc_verified_at, instagram_handle, instagram_followers, tiktok_handle, tiktok_followers, follower_count')
        .eq('id', profileId)
        .maybeSingle();
      if (cancelled) return;
      if (profErr) {
        // eslint-disable-next-line no-console
        console.warn('[PublicProfile] profile fetch error:', profErr);
      }
      if (!prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof);

      // Services they own (for the "Their Services" + "People who love"
      // and to derive role).
      const { data: svcs } = await supabase
        .from('services')
        .select(`
          id, title, category, description, location_text, photo_class, cover_url,
          taxonomy_provider_type, owner_id, status,
          offerings ( id, name, price_cents, is_default )
        `)
        .eq('owner_id', profileId)
        .eq('status', 'listed')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const svcRows = (svcs || []).map(s => {
        const def = (s.offerings || []).find(o => o.is_default) || s.offerings?.[0];
        return { ...s, price_cents: def?.price_cents ?? null };
      });
      setServices(svcRows);

      // For each service: count reco buckets (friends vs Connectors).
      if (svcRows.length) {
        const svcIds = svcRows.map(s => s.id);
        const { data: ownerRecs } = await supabase
          .from('recommendations')
          .select('id, service_id, recommender_id, message, sent_at')
          .in('service_id', svcIds)
          .order('sent_at', { ascending: false });
        const recRows = ownerRecs || [];
        const recIds = [...new Set(recRows.map(r => r.recommender_id).filter(Boolean))];
        const { data: recProfs } = recIds.length
          ? await supabase.from('profiles').select('id, display_name, cc_verified_at').in('id', recIds)
          : { data: [] };
        const profMap = Object.fromEntries((recProfs || []).map(p => [p.id, p]));
        const summary = {};
        for (const r of recRows) {
          const k = r.service_id;
          if (!summary[k]) summary[k] = { total: 0, friends: 0, connectors: 0 };
          summary[k].total += 1;
          if (profMap[r.recommender_id]?.cc_verified_at) summary[k].connectors += 1;
          else summary[k].friends += 1;
        }
        if (!cancelled) setSvcRecoSummary(summary);

        // "People who love {name}" — the recommendations this profile's
        // services RECEIVED (recommender + their note). Tarik 2026-06-16.
        const svcTitleMap = Object.fromEntries(svcRows.map(s => [s.id, s.title]));
        const shapedReceived = recRows.map(r => {
          const rp = profMap[r.recommender_id];
          return {
            id: r.id,
            message: r.message || '',
            sent_at: r.sent_at,
            serviceTitle: svcTitleMap[r.service_id] || '',
            recommender: rp ? { id: rp.id, name: rp.display_name, is_connector: !!rp.cc_verified_at } : null,
          };
        });
        if (!cancelled) setRecosReceived(shapedReceived);

        // Reviews for those services — go reviews → bookings join.
        // Schema (verified against api.js): reviews(id, booking_id,
        // rater_id, rated_id, stars, comment, created_at);
        // bookings(id, service_id, consumer_id, created_at). The
        // reviewer is reviews.rater_id directly (not booking.consumer_id),
        // so we read it from reviews and skip the booking-side hop.
        const { data: bkgs } = await supabase
          .from('bookings')
          .select('id, service_id, created_at')
          .in('service_id', svcIds);
        const bkgMap = Object.fromEntries((bkgs || []).map(b => [b.id, b]));
        const bkgIds = (bkgs || []).map(b => b.id);
        const { data: revs, error: revsErr } = bkgIds.length
          ? await supabase
              .from('reviews')
              .select('id, booking_id, rater_id, stars, comment, created_at')
              .in('booking_id', bkgIds)
              .order('created_at', { ascending: false })
              .limit(8)
          : { data: [], error: null };
        if (revsErr) {
          // eslint-disable-next-line no-console
          console.warn('[PublicProfile] reviews fetch error:', revsErr);
        }
        const raterIds = [...new Set((revs || []).map(r => r.rater_id).filter(Boolean))];
        const { data: revProfs } = raterIds.length
          ? await supabase.from('profiles').select('id, display_name').in('id', raterIds)
          : { data: [] };
        const revProfMap = Object.fromEntries((revProfs || []).map(p => [p.id, p]));
        const shaped = (revs || []).map(r => {
          const bk = bkgMap[r.booking_id];
          const reviewer = revProfMap[r.rater_id] || null;
          return {
            id: r.id,
            stars: r.stars,
            comment: r.comment || '',
            booked_at: bk?.created_at || r.created_at,
            reviewer: reviewer ? { id: reviewer.id, name: reviewer.display_name } : null,
          };
        }).filter(r => r.comment); // only show rows with a comment
        if (!cancelled) setReviews(shaped);
      } else {
        setReviews([]);
        setSvcRecoSummary({});
        setRecosReceived([]);
      }

      // Their Go-Tos — services this profile has recommended.
      const { data: myRecs } = await supabase
        .from('recommendations')
        .select('id, service_id, message, sent_at')
        .eq('recommender_id', profileId)
        .order('sent_at', { ascending: false })
        .limit(20);
      const myRecRows = myRecs || [];
      const recoSvcIds = [...new Set(myRecRows.map(r => r.service_id).filter(Boolean))];
      const { data: recoSvcs } = recoSvcIds.length
        ? await supabase
            .from('services')
            .select(`
              id, title, category, description, location_text, photo_class, cover_url,
              taxonomy_provider_type, owner_id,
              offerings ( id, name, price_cents, is_default )
            `)
            .in('id', recoSvcIds)
        : { data: [] };
      const recoSvcMap = Object.fromEntries((recoSvcs || []).map(s => [s.id, s]));

      // Owner profiles for the recommended services (so the tile sub-line
      // can say "by {OwnerName}, {role}") and so we can show their avatar
      // as a clickable link.
      const ownerIds = [...new Set((recoSvcs || []).map(s => s.owner_id).filter(Boolean))];
      const { data: ownerProfs } = ownerIds.length
        ? await supabase.from('profiles').select('id, display_name, cc_verified_at').in('id', ownerIds)
        : { data: [] };
      const ownerProfMap = Object.fromEntries((ownerProfs || []).map(p => [p.id, p]));

      const shapedRecos = myRecRows
        .map(r => {
          const s = recoSvcMap[r.service_id];
          if (!s) return null;
          const def = (s.offerings || []).find(o => o.is_default) || s.offerings?.[0];
          const owner = ownerProfMap[s.owner_id];
          return {
            id: r.id,
            sent_at: r.sent_at,
            message: r.message || '',
            service: {
              id: s.id,
              title: s.title,
              category: s.category,
              taxonomy_provider_type: s.taxonomy_provider_type,
              description: s.description,
              location_text: s.location_text,
              photo_class: s.photo_class,
              cover_url: s.cover_url,
              price_cents: def?.price_cents ?? null,
              owner_id: s.owner_id,
            },
            owner: owner ? { id: owner.id, name: owner.display_name, is_connector: !!owner.cc_verified_at } : null,
          };
        })
        .filter(Boolean);
      if (!cancelled) setRecoServices(shapedRecos);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  // Role for the badge row — pulled from the first listed service's
  // taxonomy_provider_type (e.g. "Housekeeper"). Falls back to null
  // when the profile has no services (purely a Connector who shares
  // others' services — no role badge needed).
  const role = useMemo(() => {
    return services?.[0]?.taxonomy_provider_type || services?.[0]?.category || null;
  }, [services]);

  const igHandle = profile?.instagram_handle || null;
  const igFollowers = profile?.instagram_followers || profile?.follower_count || 0;
  // CERGIO-GUARD (2026-06-13): Connector status — ≥300 followers (user-
  // entered IG count for now) OR manually accepted (cc_verified_at).
  // Shown as a badge so providers can judge connector strength.
  const profileIsConnector = Number(igFollowers) >= 300 || !!profile?.cc_verified_at;

  // Skeleton shell — keeps the close button + cream background visible
  // even while data is in-flight or missing, so the user always has a
  // way out and is never staring at a blank scroll area. CERGIO-GUARD
  // (2026-05-30): added after Tarik hit a "blank page" on a freshly-
  // visited /u/{id} link — root cause was a 400 on the profile SELECT
  // that crashed the inner state without ever revealing the X.
  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-cream pb-24">
        <div className="px-5 pt-7">
          <button
            onClick={() => navigate(-1)}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
          >×</button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-body text-b3 font-medium">Loading profile…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col bg-cream pb-24">
        <div className="px-5 pt-7">
          <button
            onClick={() => navigate(-1)}
            aria-label="Close"
            className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
          >×</button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <p className="text-body-lg font-extrabold text-black mb-1">Profile not found</p>
          <p className="text-body-sm text-b3 font-medium text-center">
            This user may no longer be on Cergio.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 bg-g text-white rounded-pill px-5 py-2.5 text-body-sm font-extrabold"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const name = profile?.display_name || 'Cergio user';
  const firstName = name.split(' ')[0];
  const isConnector = !!profile?.cc_verified_at;

  return (
    <>
    <div className={`flex-1 flex flex-col bg-cream overflow-y-auto ${reqCtx && respondingInline !== 'done' ? 'pb-36' : 'pb-24'}`}>
      {/* Top bar — close (×) + Follow button (right-aligned).
          CERGIO-GUARD (2026-06-03): Follow is the canonical way the
          viewer adds someone to their graph. Following a service
          provider OR a Connector counts as "friend equivalent" in
          downstream feed/recommendation filters per Tarik. Own
          profile + signed-out viewers see no Follow button. */}
      <div className="px-5 pt-7 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
        >
          ×
        </button>
        {auth?.isSignedIn && profileId !== auth?.user?.id && following !== null && (
          <button
            type="button"
            disabled={followPending}
            onClick={async () => {
              if (followPending) return;
              setFollowPending(true);
              if (following) {
                const { error } = await unfollowProfile(profileId);
                if (error) showToast('Could not unfollow — try again.');
                else { setFollowing(false); showToast(`Unfollowed ${(profile?.display_name || 'them').split(' ')[0]}`); }
              } else {
                const { error } = await followProfile(profileId);
                if (error) showToast('Could not follow — try again.');
                else { setFollowing(true); showToast(`Now following ${(profile?.display_name || 'them').split(' ')[0]}`); }
              }
              setFollowPending(false);
            }}
            className={`rounded-pill px-4 py-1.5 text-meta font-extrabold transition-colors disabled:opacity-60
                        ${following
                          ? 'bg-white border border-bdr text-b2 hover:border-g/40'
                          : 'bg-g text-white cg-cta'}`}
          >
            {followPending ? '…' : following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {/* Header — avatar + big name + role/Connector badge row.
          CERGIO-GUARD (2026-05-30 v2): avatar 64 → 72 + name 26 → 28
          to match the heavier hierarchy on the mockup. Badges drop a
          row below name so the line doesn't crowd. */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3.5">
          <AvatarLink id={profile?.id} name={name} size={72} clickable={false} className="ring-2 ring-white shadow-sm" />
          <div className="flex-1 min-w-0">
            <h1 className="text-display-2 font-extrabold text-black leading-[1.05]">{name}</h1>
            {/* CERGIO-GUARD (2026-06-05): user-authored headline —
                appears beside the name when set. One short line that
                gives context before the role/Connector pills. */}
            {profile?.headline && (
              <p className="mt-1 text-body-sm text-b2 leading-snug font-medium">
                {profile.headline}
              </p>
            )}
          </div>
        </div>
        {/* QUARANTINED (2026-06-16, SPEC-49): the standalone RoleBadge +
            ConnectorBadge row is replaced by the viewer-prioritized signal
            block below, which carries the Connector pill + role + the same
            reach/reputation data as the request previews. */}
      </div>

      {/* Lead signal block — connector + service facets, ordered by viewer
          mode (consumer → service first; provider → connector first). */}
      <ProfileSignalBlock
        counts={counts}
        role={role}
        isService={services.length > 0}
        isConnector={counts?.isConnector ?? isConnector}
        serviceMode={serviceMode}
      />

      {/* CERGIO-GUARD (2026-06-04): By-the-numbers block per Tarik —
          "need # of friends invited (or services reco'd) and joined
          and services on users profiles prominently so they track
          their networks". Public counts only — engaging signal of
          network impact. Tappable on the SELF view (routes the user
          to /earnings/invites + /earnings) so the numbers turn into
          action. Hides silently when zero across the board. */}
      {/* CERGIO-GUARD (2026-06-04 v8): self-view nudge when all
          stats are zero. Other people's profiles still hide cleanly
          when there's nothing to show. Self-view shows a "Just
          getting started" card pointing to invite — turns a hollow
          profile into a hook for first action. */}
      {(() => {
        const isSelf = auth?.user?.id === profileId;
        if (stats && (stats.invited + stats.joined + stats.booked + stats.recommended + stats.listedServices) === 0) {
          if (!isSelf) return null;
          return (
            <Link
              to="/invite/friends-popup"
              className="mx-5 mt-6 block bg-gradient-to-br from-gl to-white border border-g/30 rounded-[16px] p-4 hover:from-gl/80 hover:to-gl/40 transition-colors"
            >
              <p className="text-meta-sm font-extrabold uppercase tracking-widest text-gd">By the numbers</p>
              <p className="text-body-lg font-extrabold text-black leading-snug mt-1">Just getting started.</p>
              <p className="text-meta text-b3 font-medium mt-1 leading-snug">
                Invite your first friend to start building your network. <span className="text-gd font-extrabold">Send invite →</span>
              </p>
            </Link>
          );
        }
        return null;
      })()}
      {stats && (stats.invited + stats.joined + stats.booked + stats.recommended + stats.listedServices) > 0 && (() => {
        const isSelf = auth?.user?.id === profileId;
        const cells = [
          { key: 'invited',         label: 'Invited',     value: stats.invited,        to: isSelf ? '/earnings/invites' : null },
          { key: 'joined',          label: 'Joined',      value: stats.joined,         to: isSelf ? '/earnings/invites' : null },
          { key: 'booked',          label: 'Booked',      value: stats.booked,         to: isSelf ? '/earnings' : null },
          { key: 'recommended',     label: "Reco'd",       value: stats.recommended,   to: null },
          { key: 'listedServices',  label: 'Services',    value: stats.listedServices, to: null },
        ].filter(c => c.value > 0);
        return (
          <div className="mx-5 mt-6 bg-white border border-bdr rounded-[16px] p-4">
            <p className="text-meta-sm font-extrabold uppercase tracking-widest text-b3 mb-2">
              By the numbers
            </p>
            <div className="grid grid-cols-3 gap-2">
              {cells.map(c => {
                const inner = (
                  <>
                    <p className="text-heading-1 font-extrabold text-black leading-none">{c.value}</p>
                    <p className="text-caps font-extrabold uppercase tracking-wide text-b3 mt-1">{c.label}</p>
                  </>
                );
                return c.to ? (
                  <Link
                    key={c.key}
                    to={c.to}
                    className="bg-bg5/60 rounded-[10px] py-2 px-1 text-center hover:bg-bg5 transition-colors"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={c.key} className="bg-bg5/60 rounded-[10px] py-2 px-1 text-center">
                    {inner}
                  </div>
                );
              })}
            </div>
            <p className="text-meta-sm text-b3 font-medium leading-snug mt-3">
              {isSelf
                ? <>You earn ${REWARDS.referrerSharePercent}% of every friend's booking up to ${REWARDS.perFriend} per friend, plus ${REWARDS.friendOfFriendBonus} chain bonus per friend-of-friend.</>
                : <>{firstName}'s network drives ${REWARDS.referrerSharePercent}% per friend booking + ${REWARDS.friendOfFriendBonus} chain bonus per friend-of-friend.</>}
            </p>
          </div>
        );
      })()}

      {/* About */}
      <div className="px-5 mt-7">
        <h2 className="text-heading-1 font-extrabold text-black">About</h2>
        {profile?.bio ? (
          <p className="text-body-sm text-b2 leading-relaxed mt-2">{profile.bio}</p>
        ) : (
          <p className="text-body-sm text-b3 leading-relaxed mt-2">No bio yet!</p>
        )}
      </div>

      {/* Social */}
      <div className="px-5 mt-7">
        <div className="flex items-center gap-2">
          <h2 className="text-heading-1 font-extrabold text-black">Social</h2>
          {profileIsConnector && (
            <span className="inline-flex items-center gap-1 bg-gl text-gd text-meta-sm font-extrabold px-2 py-0.5 rounded-pill">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" /></svg>
              Connector
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 mt-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border-2 border-gd">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none"/>
              </svg>
            </span>
            {igHandle ? (
              <span className="text-body font-extrabold text-black truncate">{igHandle}</span>
            ) : (
              <span className="text-body font-medium text-b3">Instagram</span>
            )}
          </div>
          {igHandle && igFollowers > 0 && (
            <span className="text-body-sm font-extrabold text-black whitespace-nowrap">
              {Number(igFollowers).toLocaleString()} followers
            </span>
          )}
        </div>
      </div>

      {/* Their Services — conditional: section is hidden entirely when
          the profile owns no listed services (e.g. a pure Connector who
          only spotlights others). "See all (N) →" toggle expands the
          list in place when more than 4 exist. */}
      {services.length > 0 && (
        <div className="px-5 mt-8">
          <h2 className="text-heading-1 font-extrabold text-black">{firstName}&apos;s Services</h2>
          <div className="mt-3 flex flex-col gap-4">
            {(showAllServices ? services : services.slice(0, 4)).map(svc => (
              <ServiceTile
                key={svc.id}
                svc={svc}
                recoSummary={svcRecoSummary[svc.id]}
                onOpen={() => navigate(`/service/${svc.id}`)}
              />
            ))}
          </div>
          {services.length > 4 && (
            <button
              type="button"
              onClick={() => setShowAllServices(v => !v)}
              className="mt-3 inline-flex items-center gap-1 text-body-sm text-gd font-extrabold hover:underline"
            >
              {showAllServices
                ? 'Show less'
                : `See all ${firstName}'s services (${services.length}) →`}
            </button>
          )}
        </div>
      )}

      {/* People who love {firstName} — recommendations RECEIVED on their
          services (the recommender + their note). Tarik 2026-06-16: this
          section is recos received, not the bookings-review table.
          QUARANTINED: the old `reviews` data source is no longer rendered. */}
      {recosReceived.length > 0 && (
        <div className="px-5 mt-8">
          <h2 className="text-heading-1 font-extrabold text-black">People who love {firstName}</h2>
          <p className="text-meta text-b3 font-medium mt-0.5">Friends who recommend their service</p>
          <div className="mt-3 flex flex-col gap-3">
            {(showAllReviews ? recosReceived : recosReceived.slice(0, 5)).map(r => (
              <div key={r.id} className="bg-white border border-bdr rounded-[14px] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AvatarLink
                      id={r.recommender?.id}
                      name={r.recommender?.name}
                      size={36}
                      clickable={!!r.recommender?.id}
                    />
                    <div className="min-w-0">
                      <p className="text-body font-extrabold text-black truncate">
                        {r.recommender?.name || 'A friend'}
                      </p>
                      {r.recommender?.is_connector && (
                        <span className="inline-flex items-center gap-0.5 text-meta-sm text-gd font-extrabold">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" /></svg>
                          Connector
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-meta-sm text-b3 font-medium whitespace-nowrap">
                    {fmtMonthYear(r.sent_at) ? `Reco'd ${fmtMonthYear(r.sent_at)}` : ''}
                  </p>
                </div>
                {r.message && (
                  <div className="mt-2 bg-bg5 rounded-[12px] p-3">
                    <p className="text-meta text-b2 leading-snug">{r.message}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          {recosReceived.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllReviews(v => !v)}
              className="mt-3 inline-flex items-center gap-1 text-body-sm text-gd font-extrabold hover:underline"
            >
              {showAllReviews
                ? 'Show less'
                : `See all recommendations (${recosReceived.length}) →`}
            </button>
          )}
        </div>
      )}

      {/* {firstName}'s Go-Tos — services they've recommended.
          CERGIO-GUARD (2026-05-30 v2): card layout rebuilt to match
          the Jennifer Leighton mockup. Dropped the redundant
          "Reco'd by {firstName}" row inside each card — we're already
          on their profile, so every entry here is implicitly by them.
          Card now is: owner avatar (linked) + owner name (linked) +
          role badge; Reco'd date pinned top-right; comment bubble
          below with the profile-owner's avatar inside (matches the
          tiny "reviewer" avatar on the mockup's gray quote box). */}
      {recoServices.length > 0 && (
        <div className="px-5 mt-8">
          <h2 className="text-heading-1 font-extrabold text-black">{firstName}&apos;s Go-Tos</h2>
          <p className="text-meta text-b3 font-medium mt-1">See their top-rated service providers</p>
          <div className="mt-4 flex flex-col gap-3">
            {(showAllGoTos ? recoServices : recoServices.slice(0, 6)).map(r => (
              <div
                key={r.id}
                onClick={() => navigate(`/service/${r.service.id}`)}
                className="cursor-pointer bg-white border border-bdr rounded-[16px] p-4 cg-tap"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Owner avatar — stop propagation so it opens the owner's profile, not the service */}
                    <span onClick={e => { e.stopPropagation(); if (r.owner?.id) navigate(`/u/${r.owner.id}`); }}>
                      <AvatarLink id={r.owner?.id} name={r.owner?.name} size={44} clickable={false} />
                    </span>
                    <div className="min-w-0">
                      <span
                        role="link"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); if (r.owner?.id) navigate(`/u/${r.owner.id}`); }}
                        onKeyDown={e => { if (e.key === 'Enter' && r.owner?.id) { e.stopPropagation(); navigate(`/u/${r.owner.id}`); } }}
                        className="text-body-lg font-extrabold text-black hover:underline truncate block cursor-pointer"
                      >
                        {r.owner?.name || r.service?.title || 'A provider'}
                      </span>
                      <p className="inline-flex items-center gap-1 text-meta text-gd font-extrabold mt-0.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
                          <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
                          <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                        </svg>
                        {r.service?.taxonomy_provider_type || r.service?.category || 'Service'}
                      </p>
                    </div>
                  </div>
                  <p className="text-meta-sm text-b3 font-medium whitespace-nowrap pt-1">
                    {fmtMonthYear(r.sent_at) ? `Reco'd ${fmtMonthYear(r.sent_at)}` : ''}
                  </p>
                </div>
                {r.message && (
                  <div className="w-full mt-3 bg-bg5 rounded-[14px] p-3 flex items-start gap-2.5">
                    <AvatarLink
                      id={profile?.id}
                      name={name}
                      size={28}
                      clickable={false}
                      className="ring-2 ring-white"
                    />
                    <p className="flex-1 text-meta text-b2 leading-snug pt-1">{r.message}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          {recoServices.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllGoTos(v => !v)}
              className="mt-3 inline-flex items-center gap-1 text-body-sm text-gd font-extrabold hover:underline"
            >
              {showAllGoTos
                ? 'Show less'
                : `See all of ${firstName}'s go-tos (${recoServices.length}) →`}
            </button>
          )}
        </div>
      )}

      {/* Empty state — no services + no recos authored. Surfaces gently
          rather than rendering a blank scroll area. */}
      {services.length === 0 && recoServices.length === 0 && recosReceived.length === 0 && (
        <div className="px-5 mt-8 mb-8">
          <div className="bg-white border border-bdr rounded-[14px] p-5 text-center">
            <p className="text-body font-extrabold text-black">{firstName} hasn&apos;t shared any go-tos yet.</p>
            <p className="text-meta text-b3 font-medium mt-1 leading-snug">
              Their recommendations + listed services will appear here.
            </p>
          </div>
        </div>
      )}
    </div>

    {/* CERGIO-GUARD (2026-06-13): Sticky request-context bar — shown when
        this profile was opened from the Inbox via ?reqId=. Lets the provider
        Accept / Counter / Decline without bouncing back to the Inbox. */}
    {reqCtx && respondingInline !== 'done' && (
      <div className="fixed bottom-0 inset-x-0 bg-white border-t-2 border-g/20 px-5 pt-3 pb-6 z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        {/* Request summary */}
        <p className="text-meta text-b3 font-medium mb-1">
          {firstName} needs a{' '}
          <span className="font-extrabold text-black">{reqCtx.service_type}</span>
          {reqCtx.location_text ? ` · ${reqCtx.location_text}` : ''}
        </p>

        {respondingInline === null && (
          <div className="flex gap-2 mt-2">
            {/* Accept */}
            <button
              type="button"
              onClick={async () => {
                if (!myServiceId) { showToast('You need a listed service to respond.'); return; }
                setRespondingInline('pending');
                const { error } = await respondToRequest(reqId, {
                  status: 'offered',
                  serviceId: myServiceId,
                  offeredPriceCents: null,
                  message: null,
                  waveN: null,
                });
                if (error) {
                  showToast('Could not send — try again.');
                  setRespondingInline(null);
                } else {
                  setRespondingInline('done');
                  showToast(`Accepted — ${firstName} will be notified.`);
                  setTimeout(() => navigate(-1), 1200);
                }
              }}
              className="flex-1 bg-g text-white rounded-pill py-2.5 text-meta font-extrabold cg-cta"
            >
              Accept
            </button>
            {/* Counter */}
            <button
              type="button"
              onClick={() => { setCounterOpenInline(v => !v); setCounterDraftInline(''); }}
              className="bg-white border border-bdr rounded-pill px-4 py-2.5 text-meta font-extrabold text-b2"
            >
              Counter
            </button>
            {/* Decline */}
            <button
              type="button"
              onClick={async () => {
                setRespondingInline('pending');
                const { error } = await respondToRequest(reqId, {
                  status: 'declined',
                  serviceId: myServiceId || null,
                  offeredPriceCents: null,
                  message: null,
                  waveN: null,
                });
                if (error) {
                  showToast('Could not decline — try again.');
                  setRespondingInline(null);
                } else {
                  setRespondingInline('done');
                  navigate(-1);
                }
              }}
              className="bg-white border border-bdr rounded-pill px-4 py-2.5 text-meta font-extrabold text-b3"
            >
              Decline
            </button>
          </div>
        )}

        {respondingInline === 'pending' && (
          <p className="text-body-sm text-b3 font-medium mt-2">Sending…</p>
        )}

        {counterOpenInline && respondingInline === null && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-body-sm font-extrabold text-b3">$</span>
            <input
              autoFocus
              inputMode="decimal"
              placeholder="Your price"
              value={counterDraftInline}
              onChange={e => setCounterDraftInline(e.target.value)}
              className="flex-1 border border-bdr rounded-[10px] px-3 py-2 text-body-sm font-medium text-black bg-white outline-none focus:border-g"
            />
            <button
              type="button"
              onClick={async () => {
                const dollars = parseFloat(counterDraftInline);
                if (!Number.isFinite(dollars) || dollars < 0) { showToast('Enter a valid price.'); return; }
                if (!myServiceId) { showToast('You need a listed service to respond.'); return; }
                setRespondingInline('pending');
                setCounterOpenInline(false);
                const { error } = await respondToRequest(reqId, {
                  status: 'countered',
                  serviceId: myServiceId,
                  offeredPriceCents: Math.round(dollars * 100),
                  message: null,
                  waveN: null,
                });
                if (error) {
                  showToast('Could not send counter — try again.');
                  setRespondingInline(null);
                } else {
                  setRespondingInline('done');
                  showToast(`Counter sent — ${firstName} will be notified.`);
                  setTimeout(() => navigate(-1), 1200);
                }
              }}
              className="bg-g text-white rounded-[10px] px-4 py-2 text-meta font-extrabold"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setCounterOpenInline(false)}
              className="text-b3 text-body-lg px-1"
            >
              ×
            </button>
          </div>
        )}
      </div>
    )}
    </>
  );
}
