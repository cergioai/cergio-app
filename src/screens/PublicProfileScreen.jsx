// CERGIO-GUARD (2026-05-30, IA v2 2026-08-06): Public profile view for any
// Cergio user.
//
// Route: /u/:profileId
//
// REDESIGN HANDOFF PR 3 (founder 2026-08-05, `design_handoff_profile_booking/
// Profile IA v2.dc.html` + README "Profile element order (v2)" — SPEC-49h).
// This is the ONE screen where the IA changes (STYLE_MIGRATION: "the one
// exception already agreed"). The three profile shapes (Local Creator with
// services / service-provider-only / Local-Creator-only) are THIS one
// component with empty sections omitted — never three components.
//
// Element order (v2, founder's IA doc — sections with no data don't render):
//   1. Name
//   2. Local Creator badge (+ one FacetBadge per service facet)
//   3. Followers on Cergio (named mutuals) · recos made
//   4. IG handle · follower count
//   5. Creator line (creators only)
//   6. Service facet + recos received (named) + blurb — one per service
//   7. IG Spotlights (received / made)
//   8. {First}'s Services — facet, reco count, cover, title, price,
//      lead reco quote + DATE (every reco carries a date)
//   9. Services Recommended by {First} (renamed from "Go-Tos")
//
// The DATA layer is unchanged from the SPEC-49 build (same selects, same
// summaries, same trust math). What stands from the 49 family: recos-made
// count may exceed the displayed list (SPEC-49d), no services-consumed
// section, mutuals are NAMED, no fake data (SPEC-12), spotlight tiles are
// real post links (SPEC-49e), /u/:id/services after 3 services (SPEC-49c).
// Share (copy-link) joins the top bar; Follow stays (it wasn't in the
// design's removals — Request/Message/Recommend were).

import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { followProfile, unfollowProfile, amIFollowing, respondToRequest, getInboxPartyCounts, getMyNetworkIds, getConnectorSpotlights, getMutualConnections } from '../lib/api';
import { Avatar } from '../components/ui/Avatar';
import { FacetBadge } from '../components/ui/FacetBadge';
import { QuoteBubble } from '../components/ui/QuoteBubble';
import { Card } from '../components/ui/Card';
import { SectionTitle } from '../components/ui/SectionTitle';
import { SeeAllLink } from '../components/ui/SeeAllLink';
import { IgPostTile } from '../components/ui/IgPostTile';
import { recoByline, SocialReachLine, firstNameOf } from '../components/ui/reputation';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

// "Reco'd 14 Mar 2024" — every recommendation carries a date (v2 rule).
function fmtRecoDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// "Jane, Sam + 3 friends" — the named-mutuals fragment (first names first,
// remainder as a count). Empty string when there's nothing real to say.
function namedIncl(names, count) {
  const first = (names || []).map(firstNameOf).filter(Boolean);
  const n = Number(count) || first.length;
  if (!n) return '';
  if (!first.length) return `${n} ${n === 1 ? 'friend' : 'friends'}`;
  const shown = first.slice(0, 2);
  const extra = n - shown.length;
  if (extra > 0) return `${shown.join(', ')} + ${extra} ${extra === 1 ? 'friend' : 'friends'}`;
  return shown.join(' and ');
}

// "17 recos received incl Jane, Sam + 3 friends (and 2 Local Creators)" —
// the per-service trust line (v2 element 6). Names the VIEWER's mutuals
// first; null when the service has no recos (section line collapses).
function recosReceivedLine(summary) {
  if (!summary || !summary.total) return null;
  let line = `${summary.total} ${summary.total === 1 ? 'reco' : 'recos'} received`;
  const mutuals = Number(summary.mutuals) || 0;
  if (mutuals > 0) {
    line += mutuals === 1 && summary.mutualNames?.[0]
      ? ` incl your friend ${summary.mutualNames[0]}`
      : ` incl ${namedIncl(summary.mutualNames, mutuals)}`;
  }
  const conns = Number(summary.connectors) || 0;
  if (conns > 0) line += ` (and ${conns} Local ${conns === 1 ? 'Creator' : 'Creators'})`;
  return line;
}

function IgGlyph({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
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
  const viewerId = auth?.user?.id || null;
  const showToast = outlet.showToast || ((m) => { /* eslint-disable-next-line no-console */ console.log('[toast]', m); });

  const [profile, setProfile] = useState(null);
  // Follow state — null = unknown, true/false = known.
  const [following, setFollowing] = useState(null);
  const [followPending, setFollowPending] = useState(false);
  // Share copy-link feedback (v2: Share stays, as a copy-link).
  const [copied, setCopied] = useState(false);
  // Request-context bar state (when ?reqId= is set).
  const [reqCtx, setReqCtx] = useState(null);
  const [respondingInline, setRespondingInline] = useState(null); // null | 'pending' | 'done'
  const [counterOpenInline, setCounterOpenInline] = useState(false);
  const [counterDraftInline, setCounterDraftInline] = useState('');
  // Party-signal counts — SAME source as the request previews
  // (getInboxPartyCounts) so a profile is judged with identical data (SPEC-49).
  const [counts, setCounts] = useState(null);
  // Names of the viewer's mutual friends with this profile — the followers
  // line NAMES them ("incl Jane, Sam + 3 friends") instead of a bare count.
  const [mutualNames, setMutualNames] = useState([]);
  // Recommendations RECEIVED on this profile's services (flat aggregate —
  // feeds the empty state; the lead quotes render per service).
  const [recosReceived, setRecosReceived] = useState([]);
  // svcId → [{ id, recommender, isMutual, message, sent_at }] — recommendations
  // grouped per service, mutuals-with-viewer first. The FIRST row is the
  // service card's lead quote (v2: "the lead reco quote now sits on the
  // service it praises").
  const [recosByService, setRecosByService] = useState({});
  const [services, setServices] = useState([]);
  // Spotlights this profile has POSTED on IG/TikTok (their Connector track
  // record — free barters with a confirmed post). Real post links only.
  const [spotlights, setSpotlights] = useState([]);
  // Honest counts for the "7 IG Spotlights · 5 received / 2 made" heading:
  // made = posted free-barter bookings they were the consumer on;
  // received = posted free-barter bookings on services they own.
  const [spotCounts, setSpotCounts] = useState({ made: 0, received: 0 });
  // svcId → { total, friends, connectors, mutuals, mutualNames[], viewerRecommended }
  const [svcRecoSummary, setSvcRecoSummary] = useState({});
  // Go-To serviceId → reco summary across ALL recommenders (trust byline on
  // each recommended-service card — SPEC-49g).
  const [goToSummary, setGoToSummary] = useState({});
  // Go-To ownerId → social counts (IG/network) — reputational reach on the
  // recommended-service card (SPEC-49g).
  const [goToOwnerCounts, setGoToOwnerCounts] = useState({});
  // Recommendations this profile has authored, joined to services + owners.
  const [recoServices, setRecoServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Services Recommended by — two rows inline, "See all N" expands in place.
  const [showAllGoTos, setShowAllGoTos] = useState(false);
  const INLINE_SERVICES = 3;
  const INLINE_GOTOS = 2;

  // CERGIO-GUARD (2026-06-03): probe whether the signed-in viewer
  // already follows this profile.
  useEffect(() => {
    if (!auth?.isSignedIn || !profileId) { setFollowing(null); return; }
    let cancelled = false;
    amIFollowing(profileId).then(({ data }) => {
      if (!cancelled) setFollowing(!!data);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn, profileId]);

  // Lead party-signal counts (mutual · network · recos · IG/TikTok · connector).
  useEffect(() => {
    if (!profileId) { setCounts(null); return; }
    let cancelled = false;
    getInboxPartyCounts([profileId]).then(({ data }) => {
      if (!cancelled) setCounts((data || {})[profileId] || null);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  // Mutual-friend NAMES (sample) with this profile — for the named followers line.
  useEffect(() => {
    if (!profileId) { setMutualNames([]); return; }
    let cancelled = false;
    getMutualConnections(profileId).then(({ data: m }) => {
      if (!cancelled) setMutualNames((m?.sample || []).map(x => x.name).filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [profileId]);

  // Spotlights this profile has posted (Connector track record) — same source
  // as the interim /inbound accept screen (Tarik 2026-06-18, SPEC-49e).
  useEffect(() => {
    if (!profileId) { setSpotlights([]); return; }
    let cancelled = false;
    getConnectorSpotlights(profileId).then(({ data }) => {
      if (!cancelled) setSpotlights(data || []);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  // QUARANTINED (2026-06-14): the old ?reqId= sticky Accept/Counter/Decline
  // bar is RETIRED — the canonical response surface is now /inbound/:reqId
  // (RequestFromConnectorScreen, SPEC-48). The Inbox no longer links here with
  // ?reqId, so we never hydrate reqCtx; the bar below can never render. Kept
  // the dead branch only to avoid touching the response logic.
  useEffect(() => { setReqCtx(null); }, [reqId]);

  useEffect(() => {
    if (!supabaseReady || !profileId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);

      // Profile + Connector flag + IG/TikTok handles.
      // CERGIO-GUARD (2026-05-30): SELECT trimmed to columns that actually
      // exist on profiles — a rejected column silently nulls the whole row
      // ("blank profile page" bug). avatar_url EXISTS as of migration
      // 20260805120000_profile_avatars.sql (applied 2026-08-06, PR 1).
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id, display_name, headline, bio, cc_verified_at, avatar_url, instagram_handle, instagram_followers, tiktok_handle, tiktok_followers, follower_count')
        .eq('id', profileId)
        .maybeSingle();
      if (cancelled) return;
      if (profErr) {
        // eslint-disable-next-line no-console
        console.warn('[PublicProfile] profile fetch error:', profErr);
      }
      if (!prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof);

      // Viewer's network ids (both directions) — flags mutuals on BOTH the
      // per-service recos AND the recommended services. Signed-out → empty set.
      const netRes = await getMyNetworkIds();
      if (cancelled) return;
      const netSet = new Set(netRes?.data || []);

      // Spotlights MADE count (honest heading number — the tile fetch above is
      // capped at 6, so count separately).
      const { count: spotMadeCount } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('consumer_id', profileId)
        .eq('is_free_for_rainmaker', true)
        .not('post_url', 'is', null);
      let spotReceivedCount = 0;

      // Services they own.
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
        return { ...s, price_cents: def?.price_cents ?? null, offering_name: def?.name || null };
      });
      setServices(svcRows);

      // For each service: reco summary (named mutuals, Connectors) + the
      // grouped rows whose first entry is the card's lead quote.
      if (svcRows.length) {
        const svcIds = svcRows.map(s => s.id);

        // Spotlights RECEIVED on their services (posted free barters).
        const { count: rcvCount } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .in('service_id', svcIds)
          .eq('is_free_for_rainmaker', true)
          .not('post_url', 'is', null);
        spotReceivedCount = rcvCount || 0;

        const { data: ownerRecs } = await supabase
          .from('recommendations')
          .select('id, service_id, recommender_id, message, sent_at')
          .in('service_id', svcIds)
          .order('sent_at', { ascending: false });
        const recRows = ownerRecs || [];
        const recIds = [...new Set(recRows.map(r => r.recommender_id).filter(Boolean))];
        const { data: recProfs } = recIds.length
          ? await supabase.from('profiles').select('id, display_name, cc_verified_at, avatar_url').in('id', recIds)
          : { data: [] };
        const profMap = Object.fromEntries((recProfs || []).map(p => [p.id, p]));
        const svcTitleMap = Object.fromEntries(svcRows.map(s => [s.id, s.title]));

        // Group recommendations RECEIVED per service. Within each service,
        // surface mutuals-with-viewer first, then Connectors, then everyone
        // else (recRows already sorted by sent_at desc — Array.sort is stable).
        const byService = {};
        const summary = {};
        for (const r of recRows) {
          const k = r.service_id;
          const rp = profMap[r.recommender_id];
          const isConnector = !!rp?.cc_verified_at;
          const isMutual = !!(rp && netSet.has(rp.id));
          if (!summary[k]) summary[k] = { total: 0, friends: 0, connectors: 0, mutuals: 0, mutualNames: [], viewerRecommended: false };
          summary[k].total += 1;
          if (isConnector) summary[k].connectors += 1; else summary[k].friends += 1;
          if (isMutual) { summary[k].mutuals += 1; if (rp?.display_name) summary[k].mutualNames.push(rp.display_name); }
          if (viewerId && r.recommender_id === viewerId) summary[k].viewerRecommended = true;
          (byService[k] ||= []).push({
            id: r.id,
            message: r.message || '',
            sent_at: r.sent_at,
            serviceTitle: svcTitleMap[k] || '',
            isMutual,
            recommender: rp ? { id: rp.id, name: rp.display_name, avatar_url: rp.avatar_url || null, is_connector: isConnector } : null,
          });
        }
        for (const k of Object.keys(byService)) {
          byService[k].sort((a, b) => {
            const rank = (x) => (x.isMutual ? 0 : x.recommender?.is_connector ? 1 : 2);
            return rank(a) - rank(b);
          });
          // Lead name for the count-fallback byline ("…including Jane").
          const arr = byService[k];
          const lead = arr.find(x => x.recommender?.is_connector) || arr[0];
          if (summary[k]) summary[k].leadName = lead?.recommender?.name || null;
        }
        if (!cancelled) { setSvcRecoSummary(summary); setRecosByService(byService); }

        // Flat aggregate — stable data handle + the empty-state signal.
        const shapedReceived = recRows.map(r => {
          const rp = profMap[r.recommender_id];
          return {
            id: r.id,
            message: r.message || '',
            sent_at: r.sent_at,
            serviceTitle: svcTitleMap[r.service_id] || '',
            isMutual: !!(rp && netSet.has(rp.id)),
            recommender: rp ? { id: rp.id, name: rp.display_name, is_connector: !!rp.cc_verified_at } : null,
          };
        });
        if (!cancelled) setRecosReceived(shapedReceived);
      } else {
        setSvcRecoSummary({});
        setRecosReceived([]);
        setRecosByService({});
      }
      if (!cancelled) setSpotCounts({ made: spotMadeCount || 0, received: spotReceivedCount });

      // Services Recommended by {name} — recommendations they authored.
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

      // Owner profiles for the recommended services (identity + avatar).
      const ownerIds = [...new Set((recoSvcs || []).map(s => s.owner_id).filter(Boolean))];
      const { data: ownerProfs } = ownerIds.length
        ? await supabase.from('profiles').select('id, display_name, cc_verified_at, avatar_url').in('id', ownerIds)
        : { data: [] };
      const ownerProfMap = Object.fromEntries((ownerProfs || []).map(p => [p.id, p]));

      // Owner social reach for the recommended cards (SPEC-49g).
      if (ownerIds.length) {
        const { data: ocounts } = await getInboxPartyCounts(ownerIds);
        if (!cancelled) setGoToOwnerCounts(ocounts || {});
      } else if (!cancelled) {
        setGoToOwnerCounts({});
      }

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
            // Mutual = the VIEWER is connected to the recommended provider
            // (owner in the viewer's network) — Tarik 2026-06-18.
            isMutual: !!(owner && netSet.has(owner.id)),
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
            owner: owner ? { id: owner.id, name: owner.display_name, avatar_url: owner.avatar_url || null, is_connector: !!owner.cc_verified_at } : null,
          };
        })
        .filter(Boolean);
      if (!cancelled) setRecoServices(shapedRecos);

      // Trust byline data (SPEC-49g): for each recommended service, how many
      // people reco it — naming the viewer's own connections first.
      if (recoSvcIds.length) {
        const { data: goToRecs } = await supabase
          .from('recommendations')
          .select('id, service_id, recommender_id')
          .in('service_id', recoSvcIds);
        const gRows = goToRecs || [];
        const gRecIds = [...new Set(gRows.map(r => r.recommender_id).filter(Boolean))];
        const { data: gProfs } = gRecIds.length
          ? await supabase.from('profiles').select('id, display_name, cc_verified_at').in('id', gRecIds)
          : { data: [] };
        const gProfMap = Object.fromEntries((gProfs || []).map(p => [p.id, p]));
        const gSummary = {};
        for (const r of gRows) {
          const k = r.service_id;
          const rp = gProfMap[r.recommender_id];
          const isConnector = !!rp?.cc_verified_at;
          const isMutual = !!(rp && netSet.has(rp.id));
          if (!gSummary[k]) gSummary[k] = { total: 0, friends: 0, connectors: 0, mutuals: 0, mutualNames: [], viewerRecommended: false, _leadC: null, _leadA: null };
          gSummary[k].total += 1;
          if (isConnector) gSummary[k].connectors += 1; else gSummary[k].friends += 1;
          if (isMutual) { gSummary[k].mutuals += 1; if (rp?.display_name) gSummary[k].mutualNames.push(rp.display_name); }
          if (viewerId && r.recommender_id === viewerId) gSummary[k].viewerRecommended = true;
          const nm = rp?.display_name;
          if (nm) { if (isConnector && !gSummary[k]._leadC) gSummary[k]._leadC = nm; if (!gSummary[k]._leadA) gSummary[k]._leadA = nm; }
        }
        for (const k of Object.keys(gSummary)) gSummary[k].leadName = gSummary[k]._leadC || gSummary[k]._leadA;
        if (!cancelled) setGoToSummary(gSummary);
      } else if (!cancelled) {
        setGoToSummary({});
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profileId, viewerId]);

  // Distinct service facets for the badge row — one FacetBadge per role.
  const facets = useMemo(() => {
    return [...new Set(services.map(s => s.taxonomy_provider_type || s.category).filter(Boolean))];
  }, [services]);

  const igHandle = profile?.instagram_handle || null;

  // SEO (SPEC-61): per-record meta so Google + share previews use the person's
  // real name/headline. Hook called before the loading/notFound early returns.
  useDocumentMeta({
    title: profile?.display_name || 'Profile',
    description: profile?.headline || profile?.bio || (profile?.display_name ? `${profile.display_name} on Cergio` : ''),
    ready: !!profile,
    path: profileId ? `/u/${profileId}` : undefined,
  });

  // Skeleton shell — keeps the close button + cream background visible even
  // while data is in-flight, so the user always has a way out (2026-05-30
  // blank-page guard).
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
  const netCount = Number(counts?.networkCount) || 0;
  const recosMade = Number(counts?.recosMade) || 0;
  const mutualCount = Number(counts?.mutualCount) || 0;
  const igFollowers = Number(profile?.instagram_followers) || 0;
  const spotTotal = Math.max(spotCounts.made, spotlights.length) + spotCounts.received;
  const spotMadeShown = Math.max(spotCounts.made, spotlights.length);

  const onShare = async () => {
    const url = `${window.location.origin}/u/${profileId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      showToast('Link copied');
      setTimeout(() => setCopied(false), 2400);
    } catch {
      showToast(url);
    }
  };

  return (
    <>
    <div className={`flex-1 flex flex-col bg-cream overflow-y-auto ${reqCtx && respondingInline !== 'done' ? 'pb-36' : 'pb-24'}`}>
      {/* Sticky top bar — × close left; Share (copy-link) + Follow right.
          v2: Request/Message/Recommend are gone (Request lives on the
          per-service PDP); Share stays as a copy-link. Follow is retained —
          it's the canonical add-to-graph behavior (2026-06-03) and was not
          in the design's removals. */}
      <div className="sticky top-0 z-10 bg-cream px-5 pt-4 pb-2.5 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-white border-2 border-bdr text-b2 text-body-lg flex items-center justify-center"
        >
          ×
        </button>
        <div className="flex items-center gap-2">
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
                  else { setFollowing(false); showToast(`Unfollowed ${firstName}`); }
                } else {
                  const { error } = await followProfile(profileId);
                  if (error) showToast('Could not follow — try again.');
                  else { setFollowing(true); showToast(`Now following ${firstName}`); }
                }
                setFollowPending(false);
              }}
              className={`rounded-pill px-3.5 py-2 text-meta font-extrabold transition-colors disabled:opacity-60
                          ${following
                            ? 'bg-white border border-line text-b2 hover:border-g/40'
                            : 'bg-g text-white cg-cta'}`}
            >
              {followPending ? '…' : following ? 'Following' : 'Follow'}
            </button>
          )}
          <button
            type="button"
            onClick={onShare}
            className="bg-white border border-line rounded-pill px-3.5 py-2 text-meta font-extrabold text-b2 inline-flex items-center gap-1.5 hover:border-g hover:text-gd"
          >
            <ShareIcon />
            {copied ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      <div className="px-5 pt-2 flex flex-col gap-8">

        {/* 1–5 · Identity: name, badges, followers (named) · recos made,
            IG handle · follower count, creator line. */}
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-5">
            <Avatar url={profile?.avatar_url} name={name} size={50} />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <h1 className="text-[26px] leading-[1.3] font-bold text-black">{name}</h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {isConnector && <FacetBadge kind="creator" />}
                {facets.map(f => <FacetBadge key={f}>{f}</FacetBadge>)}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {(netCount > 0 || recosMade > 0) && (
              <p className="text-body text-b3">
                {netCount > 0 && (
                  <>
                    <span className="font-extrabold text-black">{netCount}</span>
                    {' '}followers on Cergio
                    {mutualCount > 0 && namedIncl(mutualNames, mutualCount) && (
                      <> incl <span className="font-bold text-gd">{namedIncl(mutualNames, mutualCount)}</span></>
                    )}
                  </>
                )}
                {netCount > 0 && recosMade > 0 && ' · '}
                {recosMade > 0 && (
                  <><span className="font-extrabold text-black">{recosMade}</span> recos made</>
                )}
              </p>
            )}
            {igHandle && (
              <a
                href={`https://instagram.com/${String(igHandle).replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-gd"
              >
                <IgGlyph />
                <span className="text-body text-b2">{String(igHandle).replace(/^@/, '')}</span>
                <span className="flex-1" />
                {igFollowers > 0 && (
                  <span className="text-body text-b2 whitespace-nowrap">{igFollowers.toLocaleString()} followers</span>
                )}
              </a>
            )}
            {isConnector && (profile?.headline || profile?.bio) && (
              <p className="text-body text-b3 mt-0.5">{profile?.headline || profile?.bio}</p>
            )}
          </div>
        </div>

        {/* 6 · Per-service facet blocks: title + "recos received incl …"
            (named) + blurb — one per service. */}
        {services.length > 0 && (
          <div className="flex flex-col gap-5">
            {services.map(svc => {
              const line = recosReceivedLine(svcRecoSummary[svc.id]);
              return (
                <div key={svc.id} className="flex flex-col gap-1">
                  <SectionTitle>{svc.taxonomy_provider_type || svc.category || svc.title}</SectionTitle>
                  {line && <p className="text-body-sm font-semibold text-gd">{line}</p>}
                  {svc.description && <p className="text-body text-b3">{svc.description}</p>}
                </div>
              );
            })}
          </div>
        )}

        {/* 7 · IG Spotlights (received / made) — honest counts; the tiles are
            the posted track record (real post links, SPEC-49e). */}
        {(spotTotal > 0) && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <SectionTitle>{spotTotal} IG Spotlights</SectionTitle>
              <span className="text-body text-b3">
                {[
                  spotCounts.received > 0 ? `${spotCounts.received} received` : null,
                  spotMadeShown > 0 ? `${spotMadeShown} made` : null,
                ].filter(Boolean).join(' / ')}
              </span>
            </div>
            {spotlights.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {spotlights.slice(0, 9).map(s => (
                  <div key={s.id} className="w-[76px]">
                    <IgPostTile url={s.post_url} aspect="4 / 5" label={`Spotlight: ${s.title}`} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 8 · {First}'s Services — facet + reco count, cover, offering title +
            price, lead reco quote + DATE. No pager dots: one cover image is one
            image (no fake multi-page hint — SPEC-12/49g). */}
        {services.length > 0 && (
          <section className="flex flex-col gap-3.5">
            <SectionTitle>{firstName}&apos;s Services</SectionTitle>
            {services.slice(0, INLINE_SERVICES).map(svc => {
              const summary = svcRecoSummary[svc.id];
              const lead = (recosByService[svc.id] || [])[0];
              const price = svc.price_cents != null ? Math.round(svc.price_cents / 100) : null;
              return (
                <Card
                  key={svc.id}
                  r={18}
                  className="overflow-hidden cursor-pointer cg-tap"
                  onClick={() => navigate(`/service/${svc.id}`)}
                >
                  <div className="px-4 pt-4 pb-3 flex items-baseline gap-2">
                    <span className="text-body-lg font-bold text-black">
                      {svc.taxonomy_provider_type || svc.category || svc.title}
                    </span>
                    {summary?.total > 0 && (
                      <span className="text-meta font-semibold text-gd">
                        {summary.total} {summary.total === 1 ? 'reco' : 'recos'} received
                      </span>
                    )}
                  </div>
                  <div className="relative h-[199px] bg-bdr">
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
                                     w-[51px] h-[51px] rounded-full bg-black/25 flex items-center justify-center text-white text-body-lg pl-1">
                      ▶
                    </span>
                  </div>
                  <div className="px-4 pt-3.5 pb-5 flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-body-lg font-semibold text-b2 truncate">{svc.offering_name || svc.title}</span>
                      {price != null && (
                        <span className="text-heading-2 font-semibold text-b2">{price === 0 ? 'Free' : `$${price}`}</span>
                      )}
                    </div>
                    {lead?.message && (
                      <QuoteBubble
                        author={lead.recommender?.name}
                        avatarUrl={lead.recommender?.avatar_url}
                        date={`Reco'd ${fmtRecoDate(lead.sent_at)}`}
                      >
                        <span className="font-bold text-black">{lead.recommender?.name || 'A friend'}</span>
                        {lead.isMutual && <span className="font-semibold text-gd"> your friend</span>}
                        {' said '}&ldquo;{lead.message}&rdquo;
                      </QuoteBubble>
                    )}
                  </div>
                </Card>
              );
            })}
            {services.length > INLINE_SERVICES && (
              <SeeAllLink
                label={`View all ${firstName}'s services`}
                count={services.length}
                to={`/u/${profileId}/services`}
              />
            )}
          </section>
        )}

        {/* 9 · Services Recommended by {First} (renamed from "Go-Tos").
            Trust-first byline (recoByline names the viewer's connections
            first) + owner reach + the dated reco. SPEC-49d stands: recos-made
            COUNT above may exceed these rows (unclaimed providers are counted,
            never displayed). */}
        {recoServices.length > 0 && (
          <section className="flex flex-col gap-3.5 pb-2">
            <SectionTitle sub={`${recoServices.length} ${recoServices.length === 1 ? 'service' : 'services'}`}>
              Services Recommended by {firstName}
            </SectionTitle>
            <div className="flex flex-col gap-3.5">
              {(showAllGoTos ? recoServices : recoServices.slice(0, INLINE_GOTOS)).map(r => (
                <Card
                  key={r.id}
                  r={8}
                  className="p-4 cursor-pointer cg-tap"
                  onClick={() => navigate(`/service/${r.service.id}`)}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {r.owner?.id ? (
                        <Link
                          to={`/u/${r.owner.id}`}
                          onClick={e => e.stopPropagation()}
                          aria-label={`View ${r.owner.name || 'profile'}`}
                          className="shrink-0"
                        >
                          <Avatar url={r.owner.avatar_url} name={r.owner.name} size={50} />
                        </Link>
                      ) : (
                        <Avatar name={r.service?.title} size={50} />
                      )}
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-body text-black leading-tight truncate">
                          {r.owner?.name || r.service?.title || 'A provider'}
                        </span>
                        <FacetBadge>{r.service?.taxonomy_provider_type || r.service?.category || 'Service'}</FacetBadge>
                        {(() => {
                          const byline = recoByline(goToSummary[r.service?.id]);
                          return byline ? (
                            <p className="text-meta font-semibold text-gd">{byline}</p>
                          ) : r.isMutual ? (
                            <p className="text-meta font-semibold text-gd">In your network</p>
                          ) : null;
                        })()}
                        <SocialReachLine counts={r.owner?.id ? goToOwnerCounts[r.owner.id] : null} className="!mt-0" />
                      </div>
                    </div>
                    <span className="text-meta-sm text-b3 font-medium whitespace-nowrap pt-0.5">
                      {fmtRecoDate(r.sent_at) ? `Reco'd ${fmtRecoDate(r.sent_at)}` : ''}
                    </span>
                  </div>
                  {r.message && (
                    <div className="mt-2.5 bg-soft rounded-[10px] p-4 flex items-start gap-2.5">
                      <Avatar url={profile?.avatar_url} name={name} size={30} />
                      <p className="text-body text-b2 leading-snug">{r.message}</p>
                    </div>
                  )}
                </Card>
              ))}
            </div>
            {recoServices.length > INLINE_GOTOS && (
              <SeeAllLink
                label={showAllGoTos ? 'Show fewer' : `See all ${recoServices.length}`}
                onClick={() => setShowAllGoTos(v => !v)}
              />
            )}
          </section>
        )}

        {/* Empty state — no services + no recos authored. Surfaces gently
            rather than rendering a blank scroll area. */}
        {services.length === 0 && recoServices.length === 0 && recosReceived.length === 0 && spotlights.length === 0 && (
          <Card r={12} className="p-5 text-center">
            <p className="text-body-lg font-extrabold text-black">{firstName} hasn&apos;t shared any go-tos yet.</p>
            <p className="text-body-sm text-b3 font-medium mt-1.5 leading-relaxed">
              Their recommendations + listed services will appear here.
            </p>
          </Card>
        )}
      </div>
    </div>

    {/* CERGIO-GUARD (2026-06-13): Sticky request-context bar — shown when
        this profile was opened from the Inbox via ?reqId=. QUARANTINED
        (2026-06-14): reqCtx is never hydrated, so this never renders; kept
        to preserve the response logic. */}
    {reqCtx && respondingInline !== 'done' && (
      <div className="fixed bottom-0 inset-x-0 bg-white border-t-2 border-g/20 px-5 pt-3 pb-6 z-20 shadow-up">
        <p className="text-meta text-b3 font-medium mb-1">
          {firstName} needs a{' '}
          <span className="font-extrabold text-black">{reqCtx.service_type}</span>
          {reqCtx.location_text ? ` · ${reqCtx.location_text}` : ''}
        </p>

        {respondingInline === null && (
          <div className="flex gap-2 mt-2">
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
            <button
              type="button"
              onClick={() => { setCounterOpenInline(v => !v); setCounterDraftInline(''); }}
              className="bg-white border border-bdr rounded-pill px-4 py-2.5 text-meta font-extrabold text-b2"
            >
              Counter
            </button>
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
