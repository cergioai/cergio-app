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
        const cls = `w-9 h-9 rounded-full border-2 border-white text-white text-[12px] font-extrabold
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
        <div className="w-9 h-9 rounded-full border-2 border-white bg-gl text-gd text-[11px] font-extrabold
                        -ml-2.5 flex items-center justify-center shadow-sm">
          +{overflow}
        </div>
      )}
    </div>
  );
}

export function ServiceDetailScreen() {
  const navigate = useNavigate();
  const { serviceId } = useParams();
  const location = useLocation();
  const { handleBook, showToast } = useOutletContext();

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

  if (loading || !provider) {
    return (
      <div className="flex-1 flex flex-col bg-cream items-center justify-center pb-24">
        <p className="text-[14px] text-b3 font-medium">Loading service…</p>
      </div>
    );
  }

  const coverFallback = 'bg-gradient-to-br from-[#e8dcc8] via-[#b89870] to-[#604030]';
  const firstName = (ownerProfile?.display_name || provider.name).split(' ')[0];
  const selectedOffering = (offerings || []).find(o => o.id === selectedOfferingId) || offerings?.[0] || null;
  const selectedPrice = selectedOffering ? Math.round((selectedOffering.price_cents ?? 0) / 100) : provider.price;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-32">
      {/* Story-progress banner — mockup ref: dim image w/ tagline +
          7 progress dots up top + mute icon. Tap = back, for now (no
          actual stories engine yet — this is the UI shell). */}
      <div className={`relative h-[120px] overflow-hidden ${provider.coverUrl ? 'bg-bg5' : coverFallback}`}>
        {provider.coverUrl && (
          <img
            src={provider.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/45" />
        {/* Progress dots (7-segment ruler, all uniform — decorative shell) */}
        <div className="absolute top-3 left-4 right-4 flex items-center gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 h-[2.5px] bg-white/55 rounded-full" />
          ))}
        </div>
        {/* Mute (decorative — story engine TODO) */}
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="absolute top-7 left-3 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm
                     text-white text-[14px] flex items-center justify-center"
        >
          ×
        </button>
        <button
          aria-label="Mute"
          className="absolute top-7 right-3 w-8 h-8 rounded-full bg-black/45 backdrop-blur-sm
                     text-white text-[12px] flex items-center justify-center"
        >
          🔇
        </button>
        <p className="absolute bottom-3 left-4 right-4 text-white text-[12.5px] font-bold drop-shadow">
          Running all the errands you need
        </p>
      </div>

      {/* Big name + badges row — matches Jennifer Leighton mockup.
          CERGIO-GUARD (2026-05-30): the provider's name is a Link to
          their public profile (/u/{ownerId}) so users can audit who
          they're booking from. */}
      <div className="px-5 pt-5">
        {provider.ownerId ? (
          <Link
            to={`/u/${provider.ownerId}`}
            className="text-[28px] font-extrabold text-black leading-[1.05] hover:underline"
          >
            {ownerProfile?.display_name || provider.name}
          </Link>
        ) : (
          <h1 className="text-[28px] font-extrabold text-black leading-[1.05]">
            {ownerProfile?.display_name || provider.name}
          </h1>
        )}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-gd font-extrabold">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#3FA821" aria-hidden="true">
              <path d="M12 2l2.4 2.6 3.5-.5.6 3.5 3 1.8-1.6 3.2 1.6 3.2-3 1.8-.6 3.5-3.5-.5L12 22l-2.4-2.6-3.5.5-.6-3.5-3-1.8L4.1 11l-1.6-3.2 3-1.8.6-3.5 3.5.5L12 2z"/>
              <path d="M9.5 12.2l1.7 1.7 3.4-3.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            {provider.category}
          </span>
          {hasFreeOffering && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-gd font-extrabold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
              </svg>
              Free for Connectors
            </span>
          )}
        </div>
      </div>

      {/* Reco line — "Reco'd by N friends and E Connectors, including
          {LeadName}" with single lead-recommender avatar pinned right.
          The lead avatar + lead name are both Links to the recommender's
          public profile (/u/{id}). The bucket counts stay underlined to
          feel tappable (future "who recommended" sheet — TODO).
          CERGIO-GUARD (2026-05-30): copy switched from "Go-to service
          for…" to "Reco'd by…" per Tarik's vocabulary preference. */}
      {recoSummary && (
        <div className="mx-5 mt-4 pt-4 border-t border-bdr">
          <div className="flex items-center gap-3">
            <p className="flex-1 text-[13.5px] text-b2 leading-snug">
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
              {recoSummary.leadName && recoSummary.leadAvatar?.id ? (
                <>
                  , including{' '}
                  <Link
                    to={`/u/${recoSummary.leadAvatar.id}`}
                    className="text-gd font-extrabold underline"
                  >
                    {recoSummary.leadName}
                  </Link>
                </>
              ) : recoSummary.leadName ? (
                <>, including <span className="text-gd font-extrabold underline">{recoSummary.leadName}</span></>
              ) : null}
            </p>
            {recoSummary.leadAvatar && (
              recoSummary.leadAvatar.id ? (
                <Link
                  to={`/u/${recoSummary.leadAvatar.id}`}
                  aria-label={`View ${recoSummary.leadAvatar.name || 'profile'}`}
                  className={`w-12 h-12 rounded-full text-white text-[14px] font-extrabold
                              flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-sm
                              ${AV_GRADS[0]}`}
                >
                  {initialsOf(recoSummary.leadAvatar.name)}
                </Link>
              ) : (
                <div className={`w-12 h-12 rounded-full text-white text-[14px] font-extrabold
                                 flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow-sm
                                 ${AV_GRADS[0]}`}>
                  {initialsOf(recoSummary.leadAvatar.name)}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Book section title — uses owner's first name like "Book Jennifer" */}
      <div className="px-5 pt-5 pb-3 border-t border-bdr mt-5">
        <h2 className="text-[20px] font-extrabold text-black leading-tight">
          Book {firstName}
        </h2>
        <p className="text-[12.5px] text-b3 font-medium mt-1.5 flex items-center gap-1">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-b3 text-b3 text-[9px] font-bold">i</span>
          Select a service offering below to book
        </p>
      </div>

      {/* Offering cards — HORIZONTAL scroll per mockup (Apartment Clean
          full-width, Linen Re... peek). Selected card has green border
          and pale-green fill. */}
      <div className="pl-5 -mr-2 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 pr-5 snap-x snap-mandatory">
          {(offerings || []).map((o) => {
            const isSel = o.id === selectedOfferingId;
            const priceDollars = Math.round((o.price_cents ?? 0) / 100);
            const isFree = (o.price_cents ?? 0) === 0;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedOfferingId(o.id)}
                className={`snap-start text-left rounded-[18px] p-4 flex-shrink-0
                            w-[78%] min-h-[140px] transition-all
                            ${isSel
                              ? 'bg-gl border-2 border-g shadow-sm'
                              : 'bg-white border border-bdr'}`}
              >
                <p className="text-[18px] font-extrabold text-black leading-tight">
                  {o.name || 'Service offering'}
                </p>
                {isFree ? (
                  <p className="inline-flex items-center gap-1.5 text-[13px] text-gd font-extrabold mt-1.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.2" aria-hidden="true">
                      <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
                    </svg>
                    Free for Connectors
                  </p>
                ) : (
                  <p className="text-[15px] font-extrabold text-black mt-1.5">${priceDollars}</p>
                )}
                {o.description && (
                  <p className="text-[12.5px] text-b3 leading-snug mt-2">{o.description}</p>
                )}
              </button>
            );
          })}
          {(!offerings || offerings.length === 0) && (
            <div className="bg-bg5 rounded-[18px] p-4 text-center text-[12px] text-b3 font-medium w-[78%] flex-shrink-0">
              No offerings listed yet — book this provider to request a custom quote.
            </div>
          )}
        </div>
      </div>

      {/* "Don't see what you need?" cream callout — per mockup */}
      <div className="mx-5 mt-5 bg-gl rounded-[14px] p-3.5 text-center">
        <p className="text-[12.5px] text-b2 font-medium leading-snug">
          Don't see what you need?{' '}
          <button
            onClick={() => navigate('/home')}
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
          <h2 className="text-[20px] font-extrabold text-black mb-2">About the provider</h2>
          {ownerProfile?.bio && (
            <p className="text-[13px] text-b2 leading-relaxed">{ownerProfile.bio}</p>
          )}
          {(ownerProfile?.instagram_handle || ownerProfile?.tiktok_handle) && (
            <div className="flex items-center gap-3 mt-3">
              {ownerProfile?.instagram_handle && (
                <span className="text-[11.5px] text-b3 font-medium">IG @{ownerProfile.instagram_handle}</span>
              )}
              {ownerProfile?.tiktok_handle && (
                <span className="text-[11.5px] text-b3 font-medium">TikTok @{ownerProfile.tiktok_handle}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recommender blurbs — kept but moved BELOW About so the headline
          area stays clean per mockup. Hidden if no recommenders. */}
      {recommenders.length > 0 && (
        <div className="mx-5 mt-6">
          <h2 className="text-[17px] font-extrabold text-black mb-3">What people say</h2>
          <div className="flex flex-col gap-3">
            {recommenders.slice(0, 3).map((r, i) => {
              const avatarCls = `w-8 h-8 rounded-full text-white text-[11px] font-extrabold flex-shrink-0
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
                    <p className="text-[12px] text-b2 leading-snug">
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
          className="w-full bg-g text-white rounded-[24px] py-4 text-[17px] font-extrabold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          {`Request ${selectedOffering?.name || provider.name} ($${selectedPrice})`}
        </button>
        <p className="text-center text-[11.5px] text-b3 font-medium mt-2">You won't be charged yet</p>
      </div>
    </div>
  );
}
