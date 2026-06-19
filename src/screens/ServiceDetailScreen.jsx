// CERGIO-GUARD (2026-05-29): Consumer PDP — the "Jennifer Leighton"
// view in the Figma reference. Before this screen existed, tapping a
// ProviderCard jumped straight to /booking with no intermediate detail.
// That skipped the trust step entirely — no provider bio, no avatar
// stack of who recommended them, no offerings breakdown.
//
// Route: /service/:serviceId
//   Preferred entry: ResultsScreen passes the full provider object +
//   recommenders array via location.state so we render instantly without
//   a re-fetch. If the user lands here cold (deep link, refresh), we
//   fall back to listServices({ provider_type: null }) and look up the
//   service by id — slower but works.
//
// Layout (matches the design):
//   • Header: back + share
//   • Cover image (or gradient fallback)
//   • Title row: provider name + category + price
//   • Recommended-by avatar stack with names + count
//   • Recommender blurbs (italic quote per row)
//   • About the provider — bio prose
//   • Book CTA — fixed-bottom, same handleBook flow as ProviderCard

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation, useOutletContext, Link } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { RequestQuoteSheet } from '../components/ui/RequestQuoteSheet';

function initialsOf(name) {
  if (!name) return '?';
  return name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase();
}

// Stacked avatar circles — up to maxVisible faces, then a "+N" chip.
// Brand-friendly gradient pool reused across the app.
const AV_GRADS = [
  'bg-gradient-to-br from-[#8A6FD6] to-[#4F3DB0]',
  'bg-gradient-to-br from-[#F5A65E] to-[#C76A18]',
  'bg-gradient-to-br from-[#EE5586] to-[#A52454]',
  'bg-gradient-to-br from-[#5BC404] to-[#2F6E00]',
  'bg-gradient-to-br from-[#4478AA] to-[#2A5070]',
];

// CERGIO-GUARD (2026-05-30): every avatar in this stack is a Link to
// the recommender's public profile (/u/{id}). Tarik's spec:
// "make all the avatars profiles etc on the profile of services
// (recommenders avatars)" clickable.
function AvatarStack({ recommenders, maxVisible = 4 }) {
  if (!recommenders?.length) return null;
  const visible = recommenders.slice(0, maxVisible);
  const overflow = Math.max(0, recommenders.length - maxVisible);
  return (
    <div className="flex items-center">
      {visible.map((r, i) => {
        const cls = `w-9 h-9 rounded-full border-2 border-white text-white text-meta font-extrabold
                     ${AV_GRADS[i % AV_GRADS.length]} ${i > 0 ? '-ml-2.5' : ''}
                     flex items-center justify-center shadow-sm`;
        if (r.id) {
          return (
            <Link
              key={r.id || i}
              to={`/u/${r.id}`}
              aria-label={`View ${r.name || 'profile'}`}
              className={cls}
              onClick={(e) => e.stopPropagation()}
            >
              {initialsOf(r.name)}
            </Link>
          );
        }
        return (
          <div key={i} className={cls}>{initialsOf(r.name)}</div>
        );
      })}
      {overflow > 0 && (
        <div className="w-9 h-9 rounded-full border-2 border-white bg-gl text-gd text-meta-sm font-extrabold
                        -ml-2.5 flex items-center justify-center shadow-sm">
          +{overflow}
        </div>
      )}
    </div>
  );
}

// CERGIO-GUARD (2026-05-31 — Phase 3b): review row matching the
// Jennifer Leighton mockup. Reviewer avatar + name + Connector chip
// (when verified) + comment with "show more" toggle + time ago
// pinned right. Avatar + name link to the reviewer's public profile.
function ReviewCard({ review, avatarColor, fmtAgo }) {
  const [expanded, setExpanded] = useState(false);
  const comment = review.comment || '';
  const longThreshold = 140;
  const isLong = comment.length > longThreshold;
  const visible = isLong && !expanded
    ? comment.slice(0, longThreshold).trimEnd() + '…'
    : comment;
  const reviewer = review.reviewer;
  const initials = reviewer?.name
    ? reviewer.name.split(' ').map(s => s[0] || '').slice(0, 2).join('').toUpperCase()
    : '?';
  const avatarCls = `w-9 h-9 rounded-full text-white text-meta font-extrabold flex-shrink-0
                     flex items-center justify-center ${avatarColor}`;
  return (
    <div className="bg-white border border-line rounded-[14px] p-3.5">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {reviewer?.id ? (
            <Link to={`/u/${reviewer.id}`} aria-label={`View ${reviewer.name}`} className={avatarCls}>
              {initials}
            </Link>
          ) : (
            <div className={avatarCls}>{initials}</div>
          )}
          <div className="min-w-0">
            {reviewer?.id ? (
              <Link to={`/u/${reviewer.id}`} className="text-body-sm font-extrabold text-black hover:underline truncate block">
                {reviewer?.name || 'A customer'}
              </Link>
            ) : (
              <p className="text-body-sm font-extrabold text-black truncate">
                {reviewer?.name || 'A customer'}
              </p>
            )}
            {reviewer?.is_connector && (
              <p className="text-meta-sm text-gd font-extrabold inline-flex items-center gap-1 mt-0.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4">
                  <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
                </svg>
                Connector
              </p>
            )}
          </div>
        </div>
        <p className="text-meta-sm text-b3 font-medium whitespace-nowrap pt-1">
          {fmtAgo(review.booked_at)}
        </p>
      </div>
      {visible && (
        <p className="text-body-sm text-b2 leading-snug mt-1">
          {visible}
          {isLong && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="ml-1 text-meta-sm font-extrabold text-gd hover:underline"
            >
              {expanded ? 'show less' : 'show more'}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

export function ServiceDetailScreen() {
  const navigate = useNavigate();
  const { serviceId } = useParams();
  const location = useLocation();
  const { handleBook, showToast, defaultAddress, auth } = useOutletContext();
  const [requestSheetOpen, setRequestSheetOpen] = useState(false);

  // Prefer state passed from ResultsScreen (fast path). Cold-deep-link
  // fallback re-fetches the row + its recommenders.
  const seeded = location.state?.provider || null;
  const [provider, setProvider] = useState(seeded);
  const [recommenders, setRecommenders] = useState(
    location.state?.provider?.recommendersRaw || []
  );
  // Multi-offering support — Figma PDP shows selectable cards
  // (Apartment Clean / Linen Clean, etc.). Each card carries its own
  // price + description. We render ALL offerings, not just the default.
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
  // Provider profile (the human behind the service). Owner_id → profiles
  // join. Renders the avatar + name + role pill + Connector badge at
  // the top of the PDP like the Jennifer Leighton reference.
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [selectedOfferingId, setSelectedOfferingId] = useState(
    location.state?.provider?.offeringId || null
  );
  const [loading, setLoading] = useState(!seeded);
  // CERGIO-GUARD (2026-05-31 — Phase 3b): reviews rendered as
  // their own section below About-the-provider per the Jennifer
  // Leighton mockup. Reviews come from bookings → reviews join
  // (reviews.rater_id = reviewer; reviews.booking_id → service_id).
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    if (!supabaseReady || !serviceId) return;
    let cancelled = false;
    (async () => {
      // Always fetch the full offerings list — the location.state may
      // only carry the default offering's data, but the PDP needs the
      // whole catalog.
      if (!seeded || !offerings?.length || offerings.length === 1) {
        const { data: svc } = await supabase
          .from('services')
          .select(`
            id, title, category, description, location_text, photo_class,
            cover_url, owner_id, rating_count,
            offerings ( id, name, description, kind, price_cents, duration_minutes, is_default )
          `)
          .eq('id', serviceId)
          .single();
        if (cancelled) return;
        if (!svc) { setLoading(false); return; }
        const offs = svc.offerings || [];
        const def  = offs.find(o => o.is_default) || offs[0];
        if (!seeded) {
          setProvider({
            id:         svc.id,
            ownerId:    svc.owner_id,
            offeringId: def?.id || null,
            priceCents: def?.price_cents ?? 0,
            name:       svc.title || 'Service',
            category:   svc.category || 'Service',
            bio:        svc.description || '',
            price:      Math.round((def?.price_cents ?? 0) / 100),
            coverUrl:   svc.cover_url || null,
            photoClass: svc.photo_class || 'fv-jamie',
          });
        }
        if (offs.length) {
          setOfferings(offs);
          if (!selectedOfferingId) setSelectedOfferingId(def?.id || null);
        }
        // Owner profile lookup — for the provider info block.
        if (svc.owner_id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('id, display_name, bio, cc_verified_at, instagram_handle, tiktok_handle')
            .eq('id', svc.owner_id)
            .maybeSingle();
          if (!cancelled) setOwnerProfile(prof || null);
        }
      } else if (provider?.ownerId && !ownerProfile) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, display_name, bio, cc_verified_at, instagram_handle, tiktok_handle')
          .eq('id', provider.ownerId)
          .maybeSingle();
        if (!cancelled) setOwnerProfile(prof || null);
      }

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
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, display_name, cc_verified_at')
          .in('id', ids);
        const profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
        setRecommenders(recs.map(r => ({
          id:           r.recommender_id,
          name:         profMap[r.recommender_id]?.display_name || 'A friend',
          message:      r.message,
          created_at:   r.sent_at,
          is_connector: !!profMap[r.recommender_id]?.cc_verified_at,
        })));
      } else {
        setRecommenders([]);
      }

      // CERGIO-GUARD (2026-05-31 — Phase 3b): hydrate review rows.
      // reviews ← bookings (consumer + service) join. Reviewer profile
      // resolved via rater_id. Mirrors PublicProfileScreen's logic.
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
        ? await supabase.from('profiles').select('id, display_name, cc_verified_at').in('id', raterIds)
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
            ? { id: reviewer.id, name: reviewer.display_name, is_connector: !!reviewer.cc_verified_at }
            : null,
        };
      }).filter(r => r.comment); // only render rows with a comment
      if (!cancelled) setReviews(shapedReviews);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [seeded, serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bucketed reco summary — Jennifer Leighton mockup format:
  //   "Reco'd by 4 friends and 30 Connectors, including Jennifer Connery"
  // - total     = total recommenders (headline number, used in
  //               friend/Connector-less fallback)
  // - friends   = !is_connector
  // - experts   = is_connector (rendered as "Connector(s)" in copy)
  // - lead name = first friend (preferred) or first Connector
  // Returns a structured object so the render can style the numbers as
  // underlined chips per the mockup.
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

  // Free-for-GOATs detection — any offering at $0 means this service is
  // a Connector-perk listing and we surface the green pill alongside
  // the Housekeeper badge.
  const hasFreeOffering = useMemo(
    () => (offerings || []).some(o => (o.price_cents ?? 0) === 0),
    [offerings]
  );

  // CERGIO-GUARD (2026-05-30): for any FREE offering on this service,
  // we render the "comparable paid price" struck through next to a
  // big FREE label — Tarik: "for free for connectors... show the
  // official price but crossed out and show free instead". Reference
  // price priority:
  //   1. Highest-priced sibling paid offering on the SAME service
  //      (this captures "the same provider's normal rate").
  //   2. Category-based fallback (median market rate per provider
  //      type) when this service only lists the free perk.
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
    'Massage Therapist':12000,
    Photography:        25000,
    'Personal Chef':    15000,
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
  }, [offerings, provider]);

  if (loading || !provider) {
    return (
      <div className="flex-1 flex flex-col bg-cream items-center justify-center pb-24">
        <p className="text-body text-b3 font-medium">Loading service…</p>
      </div>
    );
  }

  const coverFallback = 'bg-gradient-to-br from-[#e8dcc8] via-[#b89870] to-[#604030]';
  const firstName = (ownerProfile?.display_name || provider.name).split(' ')[0];
  const selectedOffering = (offerings || []).find(o => o.id === selectedOfferingId) || offerings?.[0] || null;
  const selectedPrice = selectedOffering ? Math.round((selectedOffering.price_cents ?? 0) / 100) : provider.price;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-32">
      {/* Hero cover — Jennifer Leighton mockup, pixel pass:
          CERGIO-GUARD (2026-05-30 v3): 280 → 360 to match the mockup
          aspect, story-progress ruler moved from TOP → BOTTOM (5
          segments, not 7), volume icon moved BOTTOM-LEFT, top-right
          now carries the three-control row (heart / Connector badge /
          share) in matching dark-translucent circles. Caption text
          sits just above the ruler. */}
      <div className={`relative h-[360px] overflow-hidden ${provider.coverUrl ? 'bg-bg5' : coverFallback}`}>
        {provider.coverUrl && (
          <img
            src={provider.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        {/* lighter scrim — mockup is brighter than v2 */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/35" />

        {/* Back arrow (top-left) — back to previous screen */}
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="absolute top-4 left-3 w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm
                     text-white flex items-center justify-center"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Top-right control trio: heart, Connector badge, share */}
        <div className="absolute top-4 right-3 flex items-center gap-2">
          <button
            aria-label="Save"
            className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm text-white flex items-center justify-center"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button
            aria-label="Connector badge"
            className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm text-white flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"/>
            </svg>
          </button>
          <button
            aria-label="Share"
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.share) {
                navigator.share({ title: provider.name, url: window.location.href }).catch(() => {});
              }
            }}
            className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm text-white flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
            </svg>
          </button>
        </div>

        {/* Volume (bottom-left) — decorative story-engine shell */}
        <button
          aria-label="Mute"
          className="absolute bottom-7 left-3 w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm
                     text-white flex items-center justify-center"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <line x1="23" y1="9" x2="17" y2="15"/>
            <line x1="17" y1="9" x2="23" y2="15"/>
          </svg>
        </button>

        {/* Caption — sits just above the ruler */}
        <p className="absolute bottom-7 left-16 right-5 text-white text-meta font-extrabold drop-shadow">
          Running all the errands you need
        </p>

        {/* Story-progress ruler at BOTTOM (5 segments). First segment
            full white indicates "leading" position. */}
        <div className="absolute bottom-2 left-4 right-4 flex items-center gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-[2.5px] rounded-full ${i === 0 ? 'bg-white' : 'bg-white/55'}`}
            />
          ))}
        </div>
      </div>

      {/* Big name + badges row — matches Jennifer Leighton mockup.
          CERGIO-GUARD (2026-05-30): the provider's name is a Link to
          their public profile (/u/{ownerId}) so users can audit who
          they're booking from. */}
      <div className="px-5 pt-5">
        {provider.ownerId ? (
          <Link
            to={`/u/${provider.ownerId}`}
            className="text-display-2 font-extrabold text-black leading-[1.05] hover:underline"
          >
            {ownerProfile?.display_name || provider.name}
          </Link>
        ) : (
          <h1 className="text-display-2 font-extrabold text-black leading-[1.05]">
            {ownerProfile?.display_name || provider.name}
          </h1>
        )}
        {/* CERGIO-GUARD (2026-05-30): explicit justify-start so the
            badges row stays anchored left even when only one badge
            renders (Tarik: "left allign free for connector"). */}
        <div className="flex items-center justify-start gap-3 mt-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-body-sm text-gd font-extrabold">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
              <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
              <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            {provider.category}
          </span>
          {hasFreeOffering && (
            <span className="inline-flex items-center gap-1.5 text-body-sm text-gd font-extrabold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
              </svg>
              Free for Connectors
            </span>
          )}
        </div>
      </div>

      {/* Recommend button REMOVED (Tarik 2026-06-17, SPEC-54): a recommendation
          can only be made AFTER booking & completing the service — it happens in
          the rate + post flow (MarkBookingPostedModal), not from the service
          page. The only no-booking reco is the invite-reco that onboards a new
          provider (RecommendServiceFormScreen). */}

      {/* Reco line — "Reco'd by N friends and E Connectors, including
          {LeadName}" with single lead-recommender avatar pinned right.
          CERGIO-GUARD (2026-05-30 v3): the ENTIRE row is a single Link
          to the lead recommender's public profile. Earlier shipped a
          nested-Link version (one Link for the avatar + another for the
          lead name + spans for the counts) — Tarik still reported
          "not clickable", so the visual nesting wasn't reading as
          tappable. One outer Link + hover background change is
          unmistakable. Bucket counts stay underlined to hint at the
          (future) "all recommenders" sheet. */}
      {recoSummary && (() => {
        const leadId = recoSummary.leadAvatar?.id || null;
        const inner = (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-body-sm text-b2 leading-snug">
              Reco&apos;d by{' '}
              {recoSummary.friends > 0 && (
                <span className="text-gd font-extrabold underline">
                  {recoSummary.friends} {recoSummary.friends === 1 ? 'friend' : 'friends'}
                </span>
              )}
              {recoSummary.friends > 0 && recoSummary.experts > 0 && <> and </>}
              {recoSummary.experts > 0 && (
                <span className="text-gd font-extrabold underline">
                  {recoSummary.experts} {recoSummary.experts === 1 ? 'Connector' : 'Connectors'}
                </span>
              )}
              {recoSummary.friends === 0 && recoSummary.experts === 0 && (
                <span className="text-gd font-extrabold underline">
                  {recoSummary.total} {recoSummary.total === 1 ? 'person' : 'people'}
                </span>
              )}
              {recoSummary.leadName && (
                <>, including <span className="text-gd font-extrabold underline">{recoSummary.leadName}</span></>
              )}
              {leadId && (
                <span className="text-b3 text-meta font-medium"> ›</span>
              )}
            </p>
            {recoSummary.leadAvatar && (
              <div className={`w-12 h-12 rounded-full text-white text-body font-extrabold
                               flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-sm
                               ${AV_GRADS[0]}`}>
                {initialsOf(recoSummary.leadAvatar.name)}
              </div>
            )}
          </div>
        );
        if (leadId) {
          return (
            <Link
              to={`/u/${leadId}`}
              aria-label={`View ${recoSummary.leadName || 'recommender'}'s profile`}
              className="block mx-5 mt-4 pt-4 px-3 pb-3 -mx-2 rounded-[14px] border-t border-line
                         hover:bg-gl/40 active:bg-gl/60 transition-colors"
            >
              {inner}
            </Link>
          );
        }
        return (
          <div className="mx-5 mt-4 pt-4 border-t border-line">
            {inner}
          </div>
        );
      })()}

      {/* Book section title — uses owner's first name like "Book Jennifer".
          CERGIO-GUARD (2026-05-30): heading 20 → 22, divider switched
          from bdr → line (cream-tinted hairline) per the mockup. */}
      <div className="px-5 pt-6 pb-3 border-t border-line mt-6">
        <h2 className="text-heading-1 font-extrabold text-black leading-tight">
          Book {firstName}
        </h2>
        <p className="text-meta text-b3 font-medium mt-1.5 flex items-center gap-1">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-b3 text-b3 text-[9px] font-extrabold">i</span>
          Select a service offering below to book
        </p>
      </div>

      {/* Offering cards — HORIZONTAL scroll per mockup. White bg with
          ultra-thin `border-line` outline; selected card gains a 1.5px
          green ring (no shadow, no fill swap) — keeps the surface
          weight consistent. Price formatted as
          "$150/session • 120 mins" (price in vivid green, duration in
          b3), per the Cut and Color mockup card. Discount surfaces as
          a vivid green pill at the bottom-left of the card. */}
      <div className="pl-5 -mr-2 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 pr-5 snap-x snap-mandatory">
          {(offerings || []).map((o) => {
            const isSel = o.id === selectedOfferingId;
            const priceDollars = Math.round((o.price_cents ?? 0) / 100);
            const isFree = (o.price_cents ?? 0) === 0;
            const unitLabel =
              o.kind === 'hourly' ? 'hour'
              : (o.duration_minutes ? `${o.duration_minutes} mins` : 'session');
            const discountPct = typeof o.discount_percent === 'number'
              ? Math.round(o.discount_percent)
              : null;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedOfferingId(o.id)}
                className={`snap-start text-left rounded-[16px] p-4 flex-shrink-0
                            w-[78%] min-h-[150px] transition-all border
                            ${isSel
                              ? 'border-g/70 bg-gl/40'
                              : 'border-line bg-white'}`}
              >
                <p className="text-heading-2 font-extrabold text-black leading-tight">
                  {o.name || 'Service offering'}
                </p>
                {isFree ? (
                  // CERGIO-GUARD (2026-05-30 v2): show the comparable
                  // paid price struck through next to a big FREE label
                  // — Tarik: "for free for connectors... show the
                  // official price but crossed out and show free
                  // instead". Reference price comes from the
                  // comparablePaidCents memo above (max sibling paid
                  // offering on this service, or category fallback).
                  // Layout is left-anchored (justify-start +
                  // self-start) so it lines up under the offering
                  // name.
                  <div className="mt-1.5 flex items-center justify-start gap-2 self-start text-left flex-wrap">
                    {comparablePaidCents != null && (
                      <span className="text-body-lg text-b3 font-medium line-through">
                        ${Math.round(comparablePaidCents / 100)}
                      </span>
                    )}
                    <span className="text-heading-2 text-g font-extrabold leading-none">FREE</span>
                    <span className="inline-flex items-center gap-1 text-meta-sm text-gd font-extrabold">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4" aria-hidden="true">
                        <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
                      </svg>
                      for Connectors
                    </span>
                  </div>
                ) : (
                  <p className="mt-1.5 leading-tight">
                    <span className="text-body-lg text-g font-extrabold">
                      ${priceDollars}/{o.kind === 'hourly' ? 'hour' : 'session'}
                    </span>
                    {o.duration_minutes && o.kind !== 'hourly' && (
                      <span className="text-body-sm text-b3 font-medium"> · {o.duration_minutes} mins</span>
                    )}
                  </p>
                )}
                {o.description && (
                  <p className="text-meta text-b3 leading-snug mt-2">{o.description}</p>
                )}
                {discountPct && discountPct > 0 && (
                  <span className="inline-flex items-center gap-1 mt-3 bg-g text-white rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    </svg>
                    {discountPct}% off
                  </span>
                )}
                {/* Unit hint absorbed into the price line above; kept */}
                {(!o.duration_minutes && !isFree) && (
                  <p className="text-meta-sm text-b3 mt-1.5">{unitLabel}</p>
                )}
              </button>
            );
          })}
          {(!offerings || offerings.length === 0) && (
            <div className="bg-bg5 rounded-[16px] p-4 text-center text-meta text-b3 font-medium w-[78%] flex-shrink-0 border border-line">
              No offerings listed yet — book this provider to request a custom quote.
            </div>
          )}
        </div>
      </div>

      {/* "Don't see what you need?" cream callout.
          CERGIO-GUARD (2026-06-19, Tarik): "Submit a request" now opens the
          homepage-style FREE-FORM (chat) entry — not the structured quote sheet.
          The user describes their need in plain language like on Home. We carry
          the provider's name as a starting hint so the free-form is pre-seeded. */}
      <div className="mx-5 mt-5 bg-gl rounded-[14px] p-3.5 text-center">
        <p className="text-meta text-b2 font-medium leading-snug">
          Don&apos;t see what you need?{' '}
          <button
            onClick={() => navigate('/home', {
              state: { prefill: `I need ${provider.category || 'a service'} from ${firstName}: `, providerId: provider.ownerId || null },
            })}
            className="text-gd font-extrabold underline"
          >
            Submit a request for a custom quote.
          </button>
        </p>
      </div>

      {/* About the provider — owner's own bio (mockup shows this below
          the offering cards, before the sticky CTA). */}
      {(ownerProfile?.bio || ownerProfile?.instagram_handle || ownerProfile?.tiktok_handle) && (
        <div className="mx-5 mt-6">
          <h2 className="text-heading-1 font-extrabold text-black mb-2">About the provider</h2>
          {ownerProfile?.bio && (
            <p className="text-body-sm text-b2 leading-relaxed">{ownerProfile.bio}</p>
          )}
          {(ownerProfile?.instagram_handle || ownerProfile?.tiktok_handle) && (
            <div className="flex items-center gap-3 mt-3">
              {ownerProfile?.instagram_handle && (
                <span className="text-meta-sm text-b3 font-medium">IG @{ownerProfile.instagram_handle}</span>
              )}
              {ownerProfile?.tiktok_handle && (
                <span className="text-meta-sm text-b3 font-medium">TikTok @{ownerProfile.tiktok_handle}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* CERGIO-GUARD (2026-05-31 — Phase 3b): "★ N go-to reviews"
          section per Jennifer Leighton mockup. Real review rows
          fetched via bookings → reviews join above. Each card shows
          reviewer avatar (Link to /u/{id}), name + Connector chip,
          "show more" toggle when the comment is long, time ago. */}
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
        return (
          <div className="mx-5 mt-7">
            <h2 className="text-heading-1 font-extrabold text-black flex items-center gap-2">
              <span className="text-g">★</span>
              {reviews.length} go-to {reviews.length === 1 ? 'review' : 'reviews'}
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              {reviews.slice(0, 5).map((r, i) => (
                <ReviewCard key={r.id} review={r} avatarColor={AV_GRADS[i % AV_GRADS.length]} fmtAgo={fmtAgo} />
              ))}
            </div>
            {/* "Leave a go-to review" outline pill — white background,
                thin black border, sits ABOVE the sticky Request CTA per
                the mockup. Tap navigates to the booking history so the
                user can pick a completed booking to review (review
                creation is gated on a real booking). */}
            <button
              onClick={() => navigate('/inbox')}
              className="mt-4 w-full bg-white border border-b2 text-black rounded-pill py-3 text-body font-extrabold
                         hover:bg-bg5/30 active:scale-[.99] transition-all"
            >
              Leave a go-to review
            </button>
          </div>
        );
      })()}

      {/* Recommender blurbs — kept but moved BELOW About so the headline
          area stays clean per mockup. Hidden if no recommenders. */}
      {recommenders.length > 0 && (
        <div className="mx-5 mt-6">
          <h2 className="text-heading-2 font-extrabold text-black mb-3">What people say</h2>
          <div className="flex flex-col gap-3">
            {recommenders.slice(0, 3).map((r, i) => {
              const avatarCls = `w-8 h-8 rounded-full text-white text-meta-sm font-extrabold flex-shrink-0
                                 flex items-center justify-center ${AV_GRADS[i % AV_GRADS.length]}`;
              return (
                <div key={r.id} className="flex gap-2.5">
                  {r.id ? (
                    <Link to={`/u/${r.id}`} aria-label={`View ${r.name || 'profile'}`} className={avatarCls}>
                      {initialsOf(r.name)}
                    </Link>
                  ) : (
                    <div className={avatarCls}>{initialsOf(r.name)}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-meta text-b2 leading-snug">
                      {r.id ? (
                        <Link to={`/u/${r.id}`} className="font-extrabold text-black underline">
                          {r.name}{r.is_connector ? ' · Connector' : ''}:
                        </Link>
                      ) : (
                        <span className="font-extrabold text-black">{r.name}{r.is_connector ? ' · Connector' : ''}:</span>
                      )}{' '}
                      <span className="italic">&quot;{r.message}&quot;</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fixed-bottom CTA — "Request {OfferingName} ($X)" per mockup,
          with "You won't be charged yet" microcopy. */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-cream border-t border-bdr px-5 pt-3 pb-5 z-10">
        <button
          onClick={() => {
            handleBook(selectedOffering
              ? { ...provider, offeringId: selectedOffering.id, priceCents: selectedOffering.price_cents, price: selectedPrice }
              : provider);
          }}
          className="w-full bg-g text-white rounded-[24px] py-4 text-heading-2 font-extrabold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          {`Request ${selectedOffering?.name || provider.name} ($${selectedPrice})`}
        </button>
        <p className="text-center text-meta-sm text-b3 font-medium mt-2">You won&apos;t be charged yet</p>
      </div>

      {/* CERGIO-GUARD (2026-05-30): the request modal. Mounted at the
          PDP root so its scrim covers the entire screen + the fixed
          Book CTA. Opens when the "Submit a request" callout link is
          tapped. */}
      {requestSheetOpen && (
        <RequestQuoteSheet
          service={{
            id:                     provider.id,
            ownerId:                provider.ownerId,
            name:                   provider.name,
            category:               provider.category,
            taxonomy_provider_type: provider.category, // best available signal
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
