// CERGIO-GUARD (2026-05-29, PDP v2 2026-08-06): Consumer PDP — the service
// page you click through to from a profile.
//
// Route: /service/:serviceId
//   Preferred entry: ResultsScreen passes the full provider object +
//   recommenders array via location.state so we render instantly without
//   a re-fetch. Cold deep links fall back to fetching by id.
//
// REDESIGN HANDOFF PR 4 (founder 2026-08-05, `design_handoff_profile_booking/
// Service PDP.dc.html` + PATCHES.md §3 — SPEC-49i). Markup rebuilt to the
// design's three price states; every pinned behavior kept:
//   • Standard — price + duration per offering.
//   • Free — "Free for Local Creators" headline under the name; offerings
//     read free with a check in place of the price. GATED ON THE VIEWER
//     (viewer's cc_verified_at): a creator sees free, everyone else sees the
//     price — and can still request it free (the provider decides).
//   • Discounted — price stays, struck-through original beside it, green
//     "N% off" pill. THE DISCOUNT IS SERVICE-WIDE (services.discount_pct,
//     one rate for every offering) — src/lib/servicePricing.js is the ONE
//     place the three states resolve.
// "Leave a go-to review" is REMOVED (PATCHES §4): it was a nav shortcut to
// /inbox; the actual composer lives in the post-booking rate+post flow
// (MarkBookingPostedModal), so nothing became unreachable.
// What STANDS: recommendersRaw fast path + cold fallback (#38), liveOffer
// CTA (#134/SPEC-135), FW-7 reply-offer booking, targeted custom quote
// (#136), no standalone recommend modal (SPEC-53), reputational streams +
// real story-ruler (SPEC-49g), SPEC-154 outbound IG links on reco rows,
// per-record SEO meta (SPEC-61).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation, useOutletContext, Link } from 'react-router-dom';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { supabase, supabaseReady } from '../lib/supabase';
import { RequestQuoteSheet } from '../components/ui/RequestQuoteSheet';
import { getInboxPartyCounts, getMyNetworkIds, getMutualConnections, listServiceMedia } from '../lib/api';
import { serviceMediaPublicUrl } from '../lib/storage';
import { priceForViewer, money } from '../lib/servicePricing';
import { Avatar } from '../components/ui/Avatar';
import { FacetBadge } from '../components/ui/FacetBadge';
import { Card } from '../components/ui/Card';
import { SectionTitle } from '../components/ui/SectionTitle';
import { SeeAllLink } from '../components/ui/SeeAllLink';
import { TrustStream, SocialReachLine, ConnectorChip, MutualBadge, mutualNamesText } from '../components/ui/reputation';

// Stacked avatar circles — up to maxVisible faces, then a "+N" chip. Kept as
// the shared stack primitive (#38); rebuilt on the kit Avatar (initials on
// mint for null avatar_url — no gradient hexes).
function AvatarStack({ recommenders, maxVisible = 4 }) {
  if (!recommenders?.length) return null;
  const visible = recommenders.slice(0, maxVisible);
  const overflow = Math.max(0, recommenders.length - maxVisible);
  return (
    <div className="flex items-center">
      {visible.map((r, i) => {
        const inner = <Avatar url={r.avatar_url} name={r.name} size={36} />;
        const cls = `rounded-full ring-2 ring-white ${i > 0 ? '-ml-2.5' : ''}`;
        if (r.id) {
          return (
            <Link
              key={r.id || i}
              to={`/u/${r.id}`}
              aria-label={`View ${r.name || 'profile'}`}
              className={cls}
              onClick={(e) => e.stopPropagation()}
            >
              {inner}
            </Link>
          );
        }
        return <span key={i} className={cls}>{inner}</span>;
      })}
      {overflow > 0 && (
        <span className="w-9 h-9 rounded-full ring-2 ring-white bg-gl text-gd text-meta-sm font-extrabold
                         -ml-2.5 inline-flex items-center justify-center">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// Review card — the design's 213px horizontal card (Card r=12): 40px real
// avatar, name, Local Creator shield when verified, comment with "show more",
// quiet time-ago.
function ReviewCard({ review, fmtAgo }) {
  const [expanded, setExpanded] = useState(false);
  const comment = review.comment || '';
  const longThreshold = 140;
  const isLong = comment.length > longThreshold;
  const visible = isLong && !expanded
    ? comment.slice(0, longThreshold).trimEnd() + '…'
    : comment;
  const reviewer = review.reviewer;
  return (
    <Card r={12} className="w-[213px] flex-shrink-0 snap-start p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {reviewer?.id ? (
          <Link to={`/u/${reviewer.id}`} aria-label={`View ${reviewer.name}`} className="shrink-0">
            <Avatar url={reviewer.avatar_url} name={reviewer.name} size={40} />
          </Link>
        ) : (
          <Avatar name={reviewer?.name} size={40} />
        )}
        <div className="min-w-0 flex flex-col gap-0.5">
          {reviewer?.id ? (
            <Link to={`/u/${reviewer.id}`} className="text-body font-semibold text-black hover:underline truncate block">
              {reviewer?.name || 'A customer'}
            </Link>
          ) : (
            <p className="text-body font-semibold text-black truncate">{reviewer?.name || 'A customer'}</p>
          )}
          {reviewer?.is_connector && <FacetBadge kind="creator" />}
        </div>
      </div>
      <p className="text-body text-b3 leading-snug">
        {visible}
        {isLong && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-1 font-semibold text-black hover:underline"
          >
            {expanded ? 'show less' : 'show more'}
          </button>
        )}
      </p>
      <p className="text-meta-sm text-b3 font-medium tracking-[.02em]">{fmtAgo(review.booked_at)}</p>
    </Card>
  );
}

export function ServiceDetailScreen() {
  const navigate = useNavigate();
  const { serviceId } = useParams();
  const location = useLocation();
  const { handleBook, showToast, defaultAddress } = useOutletContext();
  const [requestSheetOpen, setRequestSheetOpen] = useState(false);

  // Prefer state passed from ResultsScreen (fast path). Cold-deep-link
  // fallback re-fetches the row + its recommenders.
  const seeded = location.state?.provider || null;
  // FW-7 (founder verbatim): "When viewing a reply to book, and seeing
  // profile of the service, need to showcase the booking button with the
  // price (from the counter).. not the generic request to book on profile".
  // When the visit comes from a reply/counter card, the navigation state
  // carries the offer: the primary CTA becomes "Book · $X" wired to the SAME
  // preConfirmed handleBook the reply card uses (SPEC-47b), at the SAME price
  // the card showed (SPEC-211: price SEEN = price CHARGED).
  const replyOffer = location.state?.responseId != null
    ? {
        offerCents: location.state.offerCents ?? null,
        requestId:  location.state.requestId ?? null,
        responseId: location.state.responseId,
      }
    : null;
  const [provider, setProvider] = useState(seeded);
  const [recommenders, setRecommenders] = useState(
    location.state?.provider?.recommendersRaw || []
  );
  // Multi-offering support — each card carries its own price + description.
  const [offerings, setOfferings] = useState(
    location.state?.provider?.offerings ||
    (location.state?.provider?.offeringId
      ? [{
          id:           location.state.provider.offeringId,
          name:         location.state.provider.name,
          price_cents:  location.state.provider.priceCents,
          is_default:   true,
        }]
      : [])
  );
  // Provider profile (the human behind the service).
  const [ownerProfile, setOwnerProfile] = useState(null);
  // SPEC-135: a live offer/counter this provider already sent to the VIEWER.
  // Drives the bottom CTA — "Accept counter-offer ($X)" instead of "Request ($Y)".
  const [liveOffer, setLiveOffer] = useState(null);
  const [selectedOfferingId, setSelectedOfferingId] = useState(
    location.state?.provider?.offeringId || null
  );
  const [loading, setLoading] = useState(!seeded);
  // Reviews come from bookings → reviews join (rater_id = reviewer).
  const [reviews, setReviews] = useState([]);
  // FW-18: real gallery rows (photos + videos) from service_media. Images
  // join the hero's story pager; videos render in the media strip below.
  const [galleryMedia, setGalleryMedia] = useState([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [showAllReviews, setShowAllReviews] = useState(false);
  // Reputational streams (SPEC-49g).
  const [ownerCounts, setOwnerCounts] = useState(null);
  // PDP v2 (PATCHES §3): the service-level pricing flags + the VIEWER's own
  // Local-Creator status — the two inputs priceForViewer gates on. The viewer
  // flag reads the viewer's OWN profile row (cc_verified_at), the same
  // pattern ResultsScreen already uses — one source of truth, not a second.
  const [serviceFlags, setServiceFlags] = useState({ free_for_connectors: false, discount_pct: null });
  const [viewerIsConnector, setViewerIsConnector] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!supabaseReady) return;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || cancelled) return;
      const { data: prof } = await supabase
        .from('profiles').select('cc_verified_at').eq('id', uid).maybeSingle();
      if (!cancelled) setViewerIsConnector(!!prof?.cc_verified_at);
    })();
    return () => { cancelled = true; };
  }, []);

  // SPEC-135: does this provider have an outstanding quote for me on any of my
  // open requests? If so the primary action is to ACCEPT it, not to request again.
  useEffect(() => {
    let cancelled = false;
    if (!supabaseReady || !provider?.ownerId) { setLiveOffer(null); return; }
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) return;
        const { data: myReqs } = await supabase
          .from('requests').select('id').eq('requester_id', uid).eq('status', 'pending').limit(50);
        const ids = (myReqs || []).map(r => r.id);
        if (!ids.length) return;
        const { data: offers } = await supabase
          .from('request_responses')
          .select('id, request_id, status, offered_price_cents, service_id, responded_at')
          .eq('responder_id', provider.ownerId)
          .in('request_id', ids)
          .in('status', ['offered', 'countered'])
          .order('responded_at', { ascending: false })
          .limit(1);
        if (!cancelled) setLiveOffer(offers && offers.length ? offers[0] : null);
      } catch (_e) { /* CTA falls back to the default request label */ }
    })();
    return () => { cancelled = true; };
  }, [provider?.ownerId]);
  const [ownerMutuals, setOwnerMutuals] = useState(null); // { count, names[] }
  const [recommenderCounts, setRecommenderCounts] = useState({});
  // recommenderId → { count, names[] } — friends-in-common between the VIEWER
  // and each recommender (the SAME signal the profile uses).
  const [recommenderMutuals, setRecommenderMutuals] = useState({});
  // The actual provider type (e.g. "Hair Stylist") — never the vague category.
  const [serviceType, setServiceType] = useState(
    location.state?.provider?.taxonomy_provider_type || location.state?.provider?.category || null
  );

  // FW-18: fetch the ordered gallery. UUID-guarded so old mock ids never hit
  // the uuid column. Public read — signed-out viewers see the gallery too.
  useEffect(() => {
    if (!serviceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId)) {
      setGalleryMedia([]);
      return;
    }
    let cancelled = false;
    listServiceMedia(serviceId).then(({ data }) => { if (!cancelled) setGalleryMedia(data || []); });
    return () => { cancelled = true; };
  }, [serviceId]);

  useEffect(() => {
    if (!supabaseReady || !serviceId) return;
    let cancelled = false;
    (async () => {
      // Always fetch the service row: even on the seeded fast path the pricing
      // flags (free_for_connectors / discount_pct — PR 1 migrations) and the
      // full offerings catalog are needed, and location.state carries neither.
      {
        const { data: svc } = await supabase
          .from('services')
          .select(`
            id, title, headline, category, taxonomy_provider_type, description, location_text, photo_class,
            cover_url, owner_id, rating_count, free_for_connectors, discount_pct,
            offerings ( id, name, description, kind, price_cents, duration_minutes, is_default )
          `)
          .eq('id', serviceId)
          .single();
        if (cancelled) return;
        if (!svc) { setLoading(false); return; }
        const offs = svc.offerings || [];
        const def  = offs.find(o => o.is_default) || offs[0];
        // Real provider type (not the vague category) for the identity line.
        setServiceType(svc.taxonomy_provider_type || svc.category || null);
        setServiceFlags({
          free_for_connectors: !!svc.free_for_connectors,
          discount_pct: svc.discount_pct ?? null,
        });
        if (!seeded) {
          setProvider({
            id:         svc.id,
            ownerId:    svc.owner_id,
            offeringId: def?.id || null,
            priceCents: def?.price_cents ?? 0,
            name:       svc.title || 'Service',
            headline:     svc.headline || null,   // FW-23
            serviceTitle: svc.title || null,      // FW-23: the badge line
            category:   svc.category || 'Service',
            bio:        svc.description || '',
            price:      Math.round((def?.price_cents ?? 0) / 100),
            coverUrl:   svc.cover_url || null,
            photoClass: null, // FW-20: the PDP renders real media or the neutral surface, never fv-*
            location_text: svc.location_text || null,
          });
        }
        if (offs.length) {
          setOfferings(offs);
          if (!selectedOfferingId) setSelectedOfferingId(def?.id || null);
        }
        // Owner profile lookup — for the provider identity block.
        if (svc.owner_id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('id, display_name, bio, cc_verified_at, avatar_url, instagram_handle, tiktok_handle')
            .eq('id', svc.owner_id)
            .maybeSingle();
          if (!cancelled) setOwnerProfile(prof || null);
        }
      }
      if (cancelled) return;

      // Hydrate recommenders. CERGIO-GUARD (2026-05-29): recommendations
      // uses `sent_at`, not `created_at`.
      const { data: recs } = await supabase
        .from('recommendations')
        .select('id, recommender_id, message, sent_at')
        .eq('service_id', serviceId)
        .order('sent_at', { ascending: false });
      if (cancelled) return;
      if (recs?.length) {
        const ids = [...new Set(recs.map(r => r.recommender_id).filter(Boolean))];
        // Recommender profiles + viewer network (mutuals) + social reach in one
        // pass (SPEC-49g). instagram_handle (SPEC-154): without it the reco row
        // has no route to the actual post. avatar_url (2026-08-06, PR 4 —
        // closing the PR 1 deferral): the rows now render the real face.
        const [{ data: profs }, netRes, { data: rc }] = await Promise.all([
          supabase.from('profiles').select('id, display_name, cc_verified_at, instagram_handle, avatar_url').in('id', ids),
          getMyNetworkIds(),
          getInboxPartyCounts(ids),
        ]);
        if (cancelled) return;
        const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
        const netSet = new Set(netRes?.data || []);
        setRecommenderCounts(rc || {});
        setRecommenders(recs.map(r => ({
          id:           r.recommender_id,
          name:         profMap[r.recommender_id]?.display_name || 'A friend',
          message:      r.message,
          created_at:   r.sent_at,
          is_connector: !!profMap[r.recommender_id]?.cc_verified_at,
          ig:           profMap[r.recommender_id]?.instagram_handle || null,
          avatar_url:   profMap[r.recommender_id]?.avatar_url || null,
          isMutual:     netSet.has(r.recommender_id),
        })));
        // Friends-in-common with the viewer for the displayed recommenders
        // (top 3) — the SAME signal the profile uses. Bounded to what's shown.
        const top = recs.slice(0, 3).map(r => r.recommender_id).filter(Boolean);
        const mres = await Promise.all(top.map(id => getMutualConnections(id)));
        if (cancelled) return;
        const mmap = {};
        top.forEach((id, i) => {
          const m = mres[i]?.data;
          mmap[id] = { count: m?.count || 0, names: (m?.sample || []).map(x => x.name).filter(Boolean) };
        });
        setRecommenderMutuals(mmap);
      } else {
        setRecommenders([]);
        setRecommenderCounts({});
        setRecommenderMutuals({});
      }

      // Hydrate review rows: reviews ← bookings join, reviewer via rater_id.
      const { data: bkgs } = await supabase
        .from('bookings')
        .select('id, service_id, created_at')
        .eq('service_id', serviceId);
      const bkgMap = Object.fromEntries((bkgs || []).map(b => [b.id, b]));
      const bkgIds = (bkgs || []).map(b => b.id);
      const { data: revs } = bkgIds.length
        ? await supabase
            .from('reviews')
            .select('id, booking_id, rater_id, stars, comment, created_at')
            .in('booking_id', bkgIds)
            .order('created_at', { ascending: false })
            .limit(12)
        : { data: [] };
      const raterIds = [...new Set((revs || []).map(r => r.rater_id).filter(Boolean))];
      const { data: raterProfs } = raterIds.length
        ? await supabase.from('profiles').select('id, display_name, cc_verified_at, avatar_url').in('id', raterIds)
        : { data: [] };
      const raterMap = Object.fromEntries((raterProfs || []).map(p => [p.id, p]));
      const shapedReviews = (revs || []).map(r => {
        const bk = bkgMap[r.booking_id];
        const reviewer = raterMap[r.rater_id];
        return {
          id: r.id,
          stars: r.stars,
          comment: (r.comment || '').trim(),
          booked_at: bk?.created_at || r.created_at,
          reviewer: reviewer
            ? { id: reviewer.id, name: reviewer.display_name, avatar_url: reviewer.avatar_url || null, is_connector: !!reviewer.cc_verified_at }
            : null,
        };
      }).filter(r => r.comment); // only render rows with a comment
      if (!cancelled) setReviews(shapedReviews);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [seeded, serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Provider's headline trust stream (SPEC-49g).
  useEffect(() => {
    const oid = ownerProfile?.id || provider?.ownerId || null;
    if (!oid) { setOwnerCounts(null); setOwnerMutuals(null); return; }
    let cancelled = false;
    getInboxPartyCounts([oid]).then(({ data }) => {
      if (!cancelled) setOwnerCounts((data || {})[oid] || null);
    });
    // Mutual friends WITH THE VIEWER — named (SPEC-49g).
    getMutualConnections(oid).then(({ data: m }) => {
      if (!cancelled) setOwnerMutuals({ count: m?.count || 0, names: (m?.sample || []).map(x => x.name).filter(Boolean) });
    });
    return () => { cancelled = true; };
  }, [ownerProfile?.id, provider?.ownerId]);

  // Bucketed reco summary — drives the green go-to line:
  //   "Go-to service for 15 users, 4 friends and 30 Local Creators,
  //    including Jennifer Connery"
  const recoSummary = useMemo(() => {
    const total = recommenders.length;
    if (total === 0) return null;
    const friends    = recommenders.filter(r => !r.is_connector);
    const experts    = recommenders.filter(r =>  r.is_connector);
    const lead       = friends[0] || experts[0] || null;
    return {
      total,
      friends:    friends.length,
      experts:    experts.length,
      leadName:   lead?.name || null,
      leadAvatar: lead,
    };
  }, [recommenders]);

  // Legacy free-barter detection — a $0 offering is a Connector-perk listing
  // even before the service-level flag existed (pre-PR-1 rows).
  const hasFreeOffering = useMemo(
    () => (offerings || []).some(o => (o.price_cents ?? 0) === 0),
    [offerings]
  );

  // CERGIO-GUARD (2026-05-30): for any FREE offering, render the comparable
  // paid price struck through next to the free label — Tarik: "for free for
  // connectors... show the official price but crossed out and show free
  // instead". Priority: highest paid sibling on the SAME service, else a
  // category fallback.
  const COMPARABLE_FALLBACK_CENTS = {
    Cleaning:           16000,
    Driving:             8000,
    Childcare:           7500,
    'Personal Driver':   8000,
    'House Cleaner':    16000,
    Babysitter:          7500,
    Plumbing:           18000,
    Electrician:        18000,
    Handyman:           12000,
    'Personal Trainer': 10000,
    Hairstylist:         9000,
    Photography:        25000,
    'Dog Walker':        4000,
    Gardener:            8500,
    Mover:              15000,
  };
  const comparablePaidCents = useMemo(() => {
    const paid = (offerings || []).filter(o => (o.price_cents ?? 0) > 0);
    if (paid.length > 0) {
      return Math.max(...paid.map(o => o.price_cents));
    }
    const key = provider?.taxonomy_provider_type || provider?.category || '';
    return COMPARABLE_FALLBACK_CENTS[key] || null;
  }, [offerings, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // SEO (SPEC-61): per-record meta for the service PDP.
  useDocumentMeta({
    title: provider ? `${ownerProfile?.display_name || provider.name || provider.category || 'Service'}` : 'Service',
    description: ownerProfile?.bio
      || (provider ? `${provider.category || 'Service'}${provider.location_text ? ' · ' + provider.location_text : ''} on Cergio` : ''),
    image: provider?.coverUrl || null,
    ready: !!provider,
    path: serviceId ? `/service/${serviceId}` : undefined,
  });

  if (loading || !provider) {
    return (
      <div className="flex-1 flex flex-col bg-paper items-center justify-center pb-24">
        <p className="text-body text-b3 font-medium">Loading service…</p>
      </div>
    );
  }

  const firstName = (ownerProfile?.display_name || provider.name).split(' ')[0];
  // Real hero images only — drives the story ruler (no fake multi-page hint).
  // FW-18: gallery images join the cover in the pager; videos stay in the
  // media strip below (a silent autoplaying hero video would lie about sound).
  const galleryImageUrls = galleryMedia
    .filter(m => m.kind === 'image')
    .map(m => serviceMediaPublicUrl(m.storage_path))
    .filter(Boolean);
  const galleryVideos = galleryMedia.filter(m => m.kind === 'video');
  const heroImages = [provider.coverUrl, ...galleryImageUrls].filter(Boolean);
  const heroImage = heroImages[Math.min(heroIdx, Math.max(heroImages.length - 1, 0))] || null;
  // The provider type to show (e.g. "Hair Stylist"), never the vague category.
  const displayType = serviceType || provider.taxonomy_provider_type || provider.category;
  const selectedOffering = (offerings || []).find(o => o.id === selectedOfferingId) || offerings?.[0] || null;
  const selectedPricing = selectedOffering ? priceForViewer(serviceFlags, selectedOffering, viewerIsConnector) : null;
  const selectedPrice = selectedOffering ? Math.round((selectedOffering.price_cents ?? 0) / 100) : provider.price;
  // The perk headline shows for the service-level flag OR a legacy $0 offering.
  const perkActive = serviceFlags.free_for_connectors || hasFreeOffering;
  const discountPct = Number(serviceFlags.discount_pct) || 0;

  const heroBtn = 'w-8 h-8 rounded-full bg-white text-b2 shadow-card flex items-center justify-center';

  return (
    <div className="flex-1 flex flex-col bg-paper overflow-y-auto pb-32">
      {/* Hero — the design's 395px cover: white control circles (back /
          heart / pin / share), mute bottom-left, story ruler only when there
          is actually more than one image (SPEC-12/49g — never a fake "more
          to scroll" hint). */}
      <div className={`relative h-[395px] overflow-hidden ${heroImage ? 'bg-bg5' : 'bg-b2'}`}>
        {heroImage && (
          <img
            src={heroImage}
            alt=""
            loading="lazy"
            // FW-18: tapping the IMAGE (not the overlay buttons — they sit
            // above it, so their clicks never reach here) advances the story
            // pager when there is more than one real image (SPEC-12/49g).
            onClick={() => { if (heroImages.length > 1) setHeroIdx(i => (i + 1) % heroImages.length); }}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <div className="absolute inset-x-0 top-0 h-[103px] bg-gradient-to-b from-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[100px] bg-gradient-to-t from-black/40 to-transparent" />

        {/* Back (top-left) */}
        <button onClick={() => navigate(-1)} aria-label="Back" className={`absolute top-4 left-4 ${heroBtn}`}>
          <svg width="8" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Top-right control trio: heart · pin · share (white circles) */}
        <div className="absolute top-4 right-4 flex items-center gap-2.5">
          <button aria-label="Save" className={heroBtn}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          {provider.location_text && (
            <button
              aria-label="Location"
              onClick={() => showToast(`Serves ${provider.location_text}`)}
              className={heroBtn}
            >
              <svg width="13" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </button>
          )}
          <button
            aria-label="Share"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.share) {
                navigator.share({ title: provider.name, url: window.location.href }).catch(() => {});
              } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href).then(() => showToast('Link copied')).catch(() => {});
              }
            }}
            className={heroBtn}
          >
            <svg width="13" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>
          </button>
        </div>

        {/* Volume (bottom-left) — story-engine shell */}
        <button aria-label="Mute" className="absolute bottom-7 left-4 w-[30px] h-[30px] rounded-full bg-black/70 text-white flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <line x1="23" y1="9" x2="17" y2="15"/>
            <line x1="17" y1="9" x2="23" y2="15"/>
          </svg>
        </button>

        {/* Story-progress ruler — ONE segment per ACTUAL image. */}
        {heroImages.length > 1 && (
          <div className="absolute bottom-3 left-5 right-5 flex items-center gap-1">
            {heroImages.map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-[3px] rounded-full ${i === heroIdx ? 'bg-white' : 'bg-white/40'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* FW-18: videos from the provider's gallery. Real rows only — the
          strip doesn't render at all when there are none. */}
      {galleryVideos.length > 0 && (
        <div className="px-5 pt-4">
          <SectionTitle size="pdp">Video</SectionTitle>
          <div className="flex gap-2 overflow-x-auto pt-2 pb-1">
            {galleryVideos.map(v => (
              <video
                key={v.id}
                src={serviceMediaPublicUrl(v.storage_path)}
                controls
                playsInline
                preload="metadata"
                className="h-[180px] rounded-[18px] bg-bg5 flex-shrink-0"
              />
            ))}
          </div>
        </div>
      )}

      {/* Identity — name (Link to the owner's profile), full facet list,
          perk headline when the service is free for Local Creators. */}
      <div className="px-5 pt-7 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {/* FW-23 (founder): the Airbnb-style headline LEADS when the
              provider wrote one; the auto "Babysitter in New York" title
              survives as a formatted badge below and the human gets an
              explicit "by {name}" credit. Without a headline the block
              renders exactly as before. */}
          {provider.headline ? (
            <h1 className="text-[26px] leading-[1.3] font-semibold text-black">
              {provider.headline}
            </h1>
          ) : provider.ownerId ? (
            <Link
              to={`/u/${provider.ownerId}`}
              className="text-[26px] leading-[1.3] font-semibold text-black hover:underline"
            >
              {ownerProfile?.display_name || provider.name}
            </Link>
          ) : (
            <h1 className="text-[26px] leading-[1.3] font-semibold text-black">
              {ownerProfile?.display_name || provider.name}
            </h1>
          )}
          <div className="flex items-center justify-start gap-2.5 flex-wrap">
            {ownerProfile?.cc_verified_at && <FacetBadge kind="creator" />}
            {provider.headline && (provider.serviceTitle || provider.name) && (
              <FacetBadge>{provider.serviceTitle || provider.name}</FacetBadge>
            )}
            {displayType && <FacetBadge>{displayType}</FacetBadge>}
          </div>
          {provider.headline && (ownerProfile?.display_name || provider.ownerName) && (
            provider.ownerId ? (
              <Link to={`/u/${provider.ownerId}`} className="text-body text-b3 font-medium hover:underline">
                by <span className="font-extrabold text-black">{ownerProfile?.display_name || provider.ownerName}</span>
              </Link>
            ) : (
              <p className="text-body text-b3 font-medium">
                by <span className="font-extrabold text-black">{ownerProfile?.display_name || provider.ownerName}</span>
              </p>
            )
          )}
          {perkActive && (
            <div className="flex flex-col gap-0.5 mt-1.5">
              <span className="inline-flex items-center gap-1.5 text-gd">
                <svg width="15" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
                  <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
                </svg>
                <span className="text-[15px] leading-snug font-bold">Free for Local Creators</span>
              </span>
              <span className="text-meta text-b3">
                {viewerIsConnector
                  ? 'You qualify — offerings below show free.'
                  : `Local Creators see it free. You can still request it free — ${firstName} accepts or declines.`}
              </span>
            </div>
          )}
        </div>

        {/* Reputational stream — the headline trust signal (SPEC-49g). Real
            numbers only; collapses silently. */}
        <TrustStream counts={ownerCounts} recoKind="received" />
        <SocialReachLine counts={ownerCounts} includeNetwork={false} className="!mt-0 !text-body-sm !text-b2" />
        {ownerMutuals && ownerMutuals.count > 0 && (
          <p className="text-meta-sm text-gd font-extrabold">{mutualNamesText(ownerMutuals.names, ownerMutuals.count)}</p>
        )}

        {/* Go-to line — green trust sentence + the lead recommender's real
            avatar (46px), the whole row one unmistakable Link (2026-05-30 v3:
            nested links did not read as tappable). */}
        {recoSummary && (() => {
          const leadId = recoSummary.leadAvatar?.id || null;
          const inner = (
            <div className="flex items-center justify-between gap-3 py-3">
              <p className="flex-1 text-meta font-semibold text-g leading-snug">
                Go-to service for {recoSummary.total} {recoSummary.total === 1 ? 'user' : 'users'}
                {recoSummary.friends > 0 && <>, {recoSummary.friends} {recoSummary.friends === 1 ? 'friend' : 'friends'}</>}
                {recoSummary.experts > 0 && <> and {recoSummary.experts} Local {recoSummary.experts === 1 ? 'Creator' : 'Creators'}</>}
                {recoSummary.leadName && <>, including {recoSummary.leadName}</>}
              </p>
              <Avatar url={recoSummary.leadAvatar?.avatar_url} name={recoSummary.leadName} size={46} />
            </div>
          );
          return (
            <div className="border-t border-b border-bdr">
              {leadId ? (
                <Link
                  to={`/u/${leadId}`}
                  aria-label={`View ${recoSummary.leadName || 'recommender'}'s profile`}
                  className="block hover:bg-gl/40 active:bg-gl/60 transition-colors"
                >
                  {inner}
                </Link>
              ) : inner}
            </div>
          );
        })()}
      </div>

      {/* Book {First} — offering picker. Info sub reflects the price state. */}
      <div className="px-5 pt-6 pb-4">
        <SectionTitle size="pdp">Book {firstName}</SectionTitle>
        <p className="text-meta text-b3 font-medium mt-2 flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-b3 text-b3 text-caps font-extrabold">i</span>
          {perkActive && viewerIsConnector
            ? 'Free on every offering while your Local Creator status is active'
            : discountPct > 0
            ? `${discountPct}% off applies across the whole service`
            : 'Select a service offering below to book'}
        </p>
      </div>

      {/* Offering cards — 260px horizontal scroll. The THREE price states
          resolve in ONE place (priceForViewer, PATCHES §3): viewer-gated
          free, service-wide discount, plain. Legacy $0 offerings read free
          with the comparable price struck through (founder 2026-05-30). */}
      <div className="pl-5 -mr-2 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 pr-5 snap-x snap-mandatory items-stretch">
          {(offerings || []).map((o) => {
            const isSel = o.id === selectedOfferingId;
            const legacyFree = (o.price_cents ?? 0) === 0;
            const pricing = priceForViewer(serviceFlags, o, viewerIsConnector);
            const isFree = pricing.free || legacyFree;
            const unit = o.kind === 'hourly' ? 'hour' : 'session';
            return (
              <Card
                key={o.id}
                r={18}
                selected={isSel}
                className="snap-start text-left w-[260px] flex-shrink-0 p-5 cursor-pointer transition-all"
                onClick={() => setSelectedOfferingId(o.id)}
              >
                <div className="flex flex-col gap-0.5">
                  <p className="text-body-lg font-semibold text-b2 leading-snug">
                    {o.name || 'Service offering'}
                  </p>
                  <p className="flex items-center gap-1.5 flex-wrap leading-snug">
                    {isFree ? (
                      <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-g">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        <span className="text-body text-g font-medium">Free for Local Creators</span>
                        {legacyFree && comparablePaidCents != null && (
                          <span className="text-body-sm text-b3 font-medium line-through">{money(comparablePaidCents)}</span>
                        )}
                        {pricing.free && !legacyFree && (
                          <span className="text-body-sm text-b3 font-medium line-through">{money(o.price_cents)}</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-body text-g font-medium">{pricing.label}/{unit}</span>
                        {pricing.wasLabel && (
                          <span className="text-body-sm text-b3 font-medium line-through">{pricing.wasLabel}</span>
                        )}
                      </>
                    )}
                    {o.duration_minutes && o.kind !== 'hourly' && (
                      <span className="text-body text-b3 font-medium">{o.duration_minutes} mins</span>
                    )}
                  </p>
                </div>
                {o.description && (
                  <p className="text-body text-b2 leading-snug mt-3">{o.description}</p>
                )}
                {pricing.pill && !isFree && (
                  <span className="inline-flex items-center gap-1 mt-3.5 bg-g text-white rounded-pill px-2.5 py-1 text-meta font-semibold">
                    <svg width="10" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    </svg>
                    {pricing.pill}
                  </span>
                )}
              </Card>
            );
          })}
          {(!offerings || offerings.length === 0) && (
            <div className="bg-bg5 rounded-[16px] p-4 text-center text-meta text-b3 font-medium w-[78%] flex-shrink-0 border border-line">
              No offerings listed yet — book this provider to request a custom quote.
            </div>
          )}
        </div>
      </div>

      {/* Custom-quote mint panel — targeted to THIS provider (SPEC-136/137). */}
      <div className="mx-5 mt-4">
        <button
          onClick={() => navigate('/home', {
            state: { prefill: `I need ${displayType || 'a service'} from ${firstName}: `, providerId: provider.ownerId || null },
          })}
          className="w-full bg-gl rounded-[10px] px-3 py-4 text-center text-body text-g font-medium hover:bg-gl/70 transition-colors"
        >
          Don&apos;t see what you need? Submit a request for a custom quote.
        </button>
      </div>

      {/* About the provider — bio + See Instagram. */}
      {(ownerProfile?.bio || provider.bio || ownerProfile?.instagram_handle) && (
        <div className="px-5 pt-8 flex flex-col gap-4">
          <SectionTitle size="pdp">About the provider</SectionTitle>
          {(ownerProfile?.bio || provider.bio) && (
            <p className="text-body text-b2 leading-snug">{ownerProfile?.bio || provider.bio}</p>
          )}
          {ownerProfile?.instagram_handle && (
            <a href={`https://instagram.com/${String(ownerProfile.instagram_handle).replace(/^@/, '')}`} target="_blank" rel="noreferrer"
              className="inline-block text-body-sm text-gd font-extrabold underline underline-offset-2 hover:opacity-80 -mt-1">See Instagram</a>
          )}
          <div className="h-px bg-bdr" />
        </div>
      )}

      {/* Go-to reviews — the design's 213px horizontal cards. Real rows from
          the bookings → reviews join; real reviewer avatars. */}
      {reviews.length > 0 && (() => {
        const fmtAgo = (iso) => {
          if (!iso) return '';
          const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
          if (sec < 86400)         return 'today';
          if (sec < 86400 * 7)     return `${Math.floor(sec / 86400)}d ago`;
          if (sec < 86400 * 30)    return `${Math.floor(sec / (86400 * 7))}w ago`;
          if (sec < 86400 * 365)   return `${Math.floor(sec / (86400 * 30))}mo ago`;
          return `${Math.floor(sec / (86400 * 365))}y ago`;
        };
        const shown = showAllReviews ? reviews : reviews.slice(0, 5);
        return (
          <div className="pt-8">
            <div className="px-5 flex items-center gap-2">
              <span className="text-g text-body-lg" aria-hidden="true">★</span>
              <SectionTitle size="pdp">{reviews.length} go-to {reviews.length === 1 ? 'review' : 'reviews'}</SectionTitle>
            </div>
            <div className="pl-5 mt-4 -mr-2 overflow-x-auto overflow-y-hidden">
              <div className="flex gap-3 pr-5 snap-x items-stretch">
                {shown.map((r) => (
                  <ReviewCard key={r.id} review={r} fmtAgo={fmtAgo} />
                ))}
              </div>
            </div>
            {reviews.length > 5 && (
              <div className="px-5 mt-3">
                <SeeAllLink
                  label={showAllReviews ? 'Show fewer' : 'See all go-to reviews'}
                  onClick={() => setShowAllReviews(v => !v)}
                />
              </div>
            )}
            {/* "Leave a go-to review" REMOVED (redesign PR 4, PATCHES §4):
                reviews are post-booking only — the composer lives in the
                rate+post flow after bookings.completed_at, not on the PDP. */}
          </div>
        );
      })()}

      {/* What people say — the recommendation rows (SPEC-49g badges + reach,
          SPEC-154 outbound IG links). Real recommender avatars via the kit. */}
      {recommenders.length > 0 && (
        <div className="px-5 pt-8">
          <SectionTitle size="pdp">What people say</SectionTitle>
          <div className="flex flex-col gap-6 mt-4">
            {recommenders.slice(0, 3).map((r) => {
              const rc = r.id ? recommenderCounts[r.id] : null;
              const rm = r.id ? recommenderMutuals[r.id] : null;
              return (
                <div key={r.id} className="flex gap-3">
                  {r.id ? (
                    <Link to={`/u/${r.id}`} aria-label={`View ${r.name || 'profile'}`} className="shrink-0">
                      <Avatar url={r.avatar_url} name={r.name} size={40} />
                    </Link>
                  ) : (
                    <Avatar name={r.name} size={40} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.id ? (
                        <Link to={`/u/${r.id}`} className="text-body font-extrabold text-black hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        <span className="text-body font-extrabold text-black">{r.name}</span>
                      )}
                      {(r.isMutual || (rm && rm.count > 0)) && <MutualBadge />}
                      {r.is_connector && <ConnectorChip />}
                    </div>
                    {rm && rm.count > 0 && (
                      <p className="text-meta-sm text-gd font-extrabold mt-0.5">{mutualNamesText(rm.names, rm.count)}</p>
                    )}
                    <SocialReachLine counts={rc} />
                    <p className="text-body-lg text-b2 leading-relaxed mt-2">{r.message}</p>
                    {/* SPEC-154 (Tarik live): the row must link OUT to the
                        recommender's actual Instagram — the reach numbers
                        beside the quote are unverifiable without it. */}
                    {r.ig && (
                      <a
                        href={`https://instagram.com/${String(r.ig).replace(/^@/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 text-body-sm text-gd font-extrabold underline underline-offset-2 hover:opacity-80"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
                        </svg>
                        See @{String(r.ig).replace(/^@/, '')} on Instagram
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sticky request bar — selected offering + its viewer-priced label,
          then the CTA. Reply/counter context wins (FW-7), then a live offer
          (SPEC-135), then the plain request. */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-white shadow-up px-5 pt-3.5 pb-6 z-10 flex flex-col gap-2">
        {selectedOffering && !replyOffer && !liveOffer && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-body font-semibold text-black truncate">{selectedOffering.name || provider.name}</span>
            <span className="text-body-sm text-g font-medium whitespace-nowrap">
              {selectedPricing?.free || (selectedOffering.price_cents ?? 0) === 0
                ? 'Free for Local Creators'
                : `${selectedPricing?.label ?? money(selectedOffering.price_cents)}${selectedPricing?.wasLabel ? ` (was ${selectedPricing.wasLabel})` : ''}`}
            </span>
          </div>
        )}
        <button
          onClick={() => {
            // FW-7: arrived from a reply/counter card — book straight off that
            // reply at its offered/countered price via the SAME preConfirmed
            // handleBook the reply card uses.
            if (replyOffer) {
              handleBook({
                id:           provider.id,
                ownerId:      provider.ownerId,
                name:         ownerProfile?.display_name || provider.name,
                title:        provider.name,
                offeringId:   null,
                price:        Math.round((replyOffer.offerCents || 0) / 100),
                priceCents:   replyOffer.offerCents || 0,
                isFree:       !replyOffer.offerCents,
                preConfirmed: true,
              });
              return;
            }
            // SPEC-135: with a live quote, the CTA ACCEPTS it — routing to the
            // request where the offer sits — instead of opening a fresh request.
            if (liveOffer?.request_id) { navigate(`/results?req=${liveOffer.request_id}`); return; }
            handleBook(selectedOffering
              ? { ...provider, offeringId: selectedOffering.id, priceCents: selectedOffering.price_cents, price: selectedPrice }
              : provider);
          }}
          className="w-full h-[50px] bg-g text-white rounded-[10px] text-[15px] font-bold
                     hover:bg-gd active:scale-[.98] transition-all"
        >
          {/* SPEC-135: a live offer/counter changes the action; FW-7 reply
              context wins over everything. */}
          {replyOffer
            ? (replyOffer.offerCents
                ? `Book · $${Math.round(replyOffer.offerCents / 100)}`
                : 'Book a free time →')
            : liveOffer
            ? (liveOffer.status === 'countered'
                ? `Accept counter-offer ($${Math.round((liveOffer.offered_price_cents || 0) / 100)})`
                : `Accept & book ($${Math.round((liveOffer.offered_price_cents || 0) / 100)})`)
            : `Request ${firstName}`}
        </button>
        <p className="text-center text-meta-sm text-b3 font-medium">You won&apos;t be charged yet</p>
      </div>

      {/* Request modal — mounted at the PDP root so its scrim covers the
          fixed CTA. */}
      {requestSheetOpen && (
        <RequestQuoteSheet
          service={{
            id:                     provider.id,
            ownerId:                provider.ownerId,
            name:                   provider.name,
            category:               provider.category,
            taxonomy_provider_type: displayType || provider.category, // real provider type
            location_text:          provider.location_text || null,
            lat:                    provider.lat || null,
            lng:                    provider.lng || null,
          }}
          providerName={ownerProfile?.display_name || provider.name}
          defaultLocation={defaultAddress
            ? { formatted_address: defaultAddress.formatted_address, lat: defaultAddress.lat, lng: defaultAddress.lng }
            : null}
          notifySafe={false}
          showToast={showToast}
          onClose={() => setRequestSheetOpen(false)}
          onSent={() => { /* Sent toast handled inside sheet */ }}
        />
      )}

    </div>
  );
}
