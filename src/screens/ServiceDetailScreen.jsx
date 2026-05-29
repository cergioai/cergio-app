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
import { useNavigate, useParams, useLocation, useOutletContext } from 'react-router-dom';
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

function AvatarStack({ recommenders, maxVisible = 4 }) {
  if (!recommenders?.length) return null;
  const visible = recommenders.slice(0, maxVisible);
  const overflow = Math.max(0, recommenders.length - maxVisible);
  return (
    <div className="flex items-center">
      {visible.map((r, i) => (
        <div
          key={r.id || i}
          className={`w-9 h-9 rounded-full border-2 border-white text-white text-[12px] font-extrabold
                      ${AV_GRADS[i % AV_GRADS.length]} ${i > 0 ? '-ml-2.5' : ''}
                      flex items-center justify-center shadow-sm`}
        >
          {initialsOf(r.name)}
        </div>
      ))}
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
  const [loading, setLoading] = useState(!seeded);

  useEffect(() => {
    if (seeded || !supabaseReady || !serviceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: svc } = await supabase
        .from('services')
        .select(`
          id, title, category, description, location_text, photo_class,
          cover_url, owner_id, rating_count,
          offerings ( id, name, kind, price_cents, duration_minutes, is_default )
        `)
        .eq('id', serviceId)
        .single();
      if (cancelled) return;
      if (!svc) { setLoading(false); return; }
      const offering = svc.offerings?.find(o => o.is_default) || svc.offerings?.[0];
      setProvider({
        id:         svc.id,
        ownerId:    svc.owner_id,
        offeringId: offering?.id || null,
        priceCents: offering?.price_cents ?? 0,
        name:       svc.title || 'Service',
        category:   svc.category || 'Service',
        bio:        svc.description || '',
        price:      Math.round((offering?.price_cents ?? 0) / 100),
        coverUrl:   svc.cover_url || null,
        photoClass: svc.photo_class || 'fv-jamie',
      });
      // Hydrate recommenders the same way listServices does.
      const { data: recs } = await supabase
        .from('recommendations')
        .select('id, recommender_id, message, created_at')
        .eq('service_id', serviceId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (recs?.length) {
        const ids = [...new Set(recs.map(r => r.recommender_id).filter(Boolean))];
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', ids);
        const map = Object.fromEntries((profs || []).map(p => [p.id, p.display_name]));
        setRecommenders(recs.map(r => ({
          id:         r.recommender_id,
          name:       map[r.recommender_id] || 'A friend',
          message:    r.message,
          created_at: r.created_at,
        })));
      } else {
        setRecommenders([]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [seeded, serviceId]);

  const recoSummary = useMemo(() => {
    const total = recommenders.length;
    if (total === 0) return null;
    const names = recommenders.slice(0, 2).map(r => r.name).filter(Boolean);
    const others = total - names.length;
    if (others <= 0) return `Recommended by ${names.join(' and ')}`;
    return `Recommended by ${names.join(', ')} and ${others} more`;
  }, [recommenders]);

  if (loading || !provider) {
    return (
      <div className="flex-1 flex flex-col bg-cream items-center justify-center pb-24">
        <p className="text-[14px] text-b3 font-medium">Loading service…</p>
      </div>
    );
  }

  const coverFallback = 'bg-gradient-to-br from-[#e8dcc8] via-[#b89870] to-[#604030]';

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-32">
      {/* Header */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-white border border-bdr flex items-center justify-center text-black text-[18px]"
        >
          ←
        </button>
        <button
          onClick={async () => {
            const url = typeof window !== 'undefined' ? window.location.href : '';
            try {
              if (navigator.share) {
                await navigator.share({ title: provider.name, text: `${provider.name} on Cergio`, url });
                return;
              }
            } catch { return; }
            try {
              await navigator.clipboard.writeText(url);
              showToast?.('Link copied');
            } catch { showToast?.('Share unavailable'); }
          }}
          aria-label="Share"
          className="w-9 h-9 rounded-full bg-white border border-bdr flex items-center justify-center text-black"
        >
          🔗
        </button>
      </div>

      {/* Cover */}
      <div className={`mx-5 h-[200px] rounded-[18px] overflow-hidden relative ${provider.coverUrl ? 'bg-bg5' : coverFallback}`}>
        {provider.coverUrl && (
          <img
            src={provider.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/20" />
      </div>

      {/* Title row */}
      <div className="px-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] font-extrabold text-black leading-tight">{provider.name}</h1>
            <p className="text-[13px] text-b3 font-medium mt-0.5">{provider.category}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[20px] font-extrabold text-black leading-none">${provider.price}</p>
            <p className="text-[11px] text-b3 font-medium mt-1">per job</p>
          </div>
        </div>
      </div>

      {/* Recommended by — avatar stack */}
      {recommenders.length > 0 ? (
        <div className="mx-5 mt-5 bg-white rounded-[18px] border border-bdr p-4">
          <div className="flex items-center gap-3 mb-3">
            <AvatarStack recommenders={recommenders} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-extrabold text-black leading-tight">{recoSummary}</p>
              <p className="text-[11px] text-b3 mt-0.5">{recommenders.length} recommendation{recommenders.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          {/* Top 3 blurbs as italic quote rows */}
          <div className="flex flex-col gap-2.5">
            {recommenders.slice(0, 3).map((r) => (
              <div key={r.id} className="flex gap-2.5">
                <div className={`w-7 h-7 rounded-full text-white text-[10px] font-extrabold flex-shrink-0
                                 flex items-center justify-center
                                 ${AV_GRADS[(recommenders.indexOf(r)) % AV_GRADS.length]}`}>
                  {initialsOf(r.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-b2 leading-snug">
                    <span className="font-extrabold text-black">{r.name}:</span>{' '}
                    <span className="italic">"{r.message}"</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-5 mt-5 bg-bg5 rounded-[18px] p-4 text-center">
          <p className="text-[12px] text-b3 font-medium leading-snug">
            No mutual friends yet — be the first to try and recommend.
          </p>
        </div>
      )}

      {/* About */}
      {provider.bio && (
        <div className="mx-5 mt-5">
          <h2 className="text-[15px] font-extrabold text-black mb-2">About this service</h2>
          <p className="text-[13px] text-b2 leading-relaxed">{provider.bio}</p>
        </div>
      )}

      {/* Fixed-bottom Book CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-cream border-t border-bdr px-5 pt-3 pb-5 z-10">
        <button
          onClick={() => handleBook(provider)}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[16px] font-extrabold
                     hover:opacity-90 active:scale-[.98] transition-all"
        >
          Book {provider.name.split(' ')[0]} · ${provider.price} ↗
        </button>
      </div>
    </div>
  );
}
