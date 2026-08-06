// CERGIO-GUARD (2026-06-17, Tarik — SPEC-49c): the dedicated "all services"
// page for a profile, reached from the unified profile's "View all services"
// link (shown only when a profile has more than the 3 services rendered
// inline on /u/:profileId). Lists EVERY listed service the profile owns,
// reusing the same ServiceTile + reco-summary (friends/Connectors) as the
// profile. Read-only; tapping a tile opens its PDP. No fake data (SPEC-12).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { recoByline } from '../components/ui/reputation';

// Moved VERBATIM from PublicProfileScreen (redesign handoff PR 3, 2026-08-06):
// the profile now renders the v2 service cards; this page was ServiceTile's
// only other consumer, so the tile + its gradient fallbacks live here until
// this screen's own kit migration (STYLE_MIGRATION group 5).
const PHOTO_GRADIENTS = {
  'fv-jamie': 'from-[#e8dcc8] via-[#b89870] to-[#604030]',
  'fv-john':  'from-[#cad8e8] via-[#7088b0] to-[#2e4060]',
  'fv-steve': 'from-[#d8e8ca] via-[#88b070] to-[#406030]',
};

// One service-card row. Cover image or photo-class gradient fallback. Tap → PDP.
function ServiceTile({ svc, recoSummary, onOpen }) {
  const grad = PHOTO_GRADIENTS[svc.photo_class] || PHOTO_GRADIENTS['fv-jamie'];
  const price = svc.price_cents != null ? Math.round(svc.price_cents / 100) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-white border border-line rounded-[16px] overflow-hidden hover:border-g/40 cg-tap"
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
          <p className="text-body-sm text-b3 leading-relaxed mt-1.5 line-clamp-2">{svc.description}</p>
        )}
        {recoSummary && recoSummary.total > 0 && (
          <div className="mt-2.5 inline-flex items-center gap-1.5 bg-gl rounded-pill px-3 py-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3FA821" strokeWidth="2.4" aria-hidden="true">
              <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinejoin="round"/>
            </svg>
            <p className="text-meta-sm text-gd font-extrabold leading-none">
              {recoByline(recoSummary)}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}

export function PublicProfileServicesScreen() {
  const navigate = useNavigate();
  const { profileId } = useParams();
  const [name, setName] = useState('');
  const [services, setServices] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabaseReady || !profileId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);

      const { data: prof } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', profileId)
        .maybeSingle();
      if (cancelled) return;
      setName(prof?.display_name || 'Cergio user');

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
      const rows = (svcs || []).map(s => {
        const def = (s.offerings || []).find(o => o.is_default) || s.offerings?.[0];
        return { ...s, price_cents: def?.price_cents ?? null };
      });
      setServices(rows);

      // Per-service reco buckets (friends vs Connectors) — same shape the
      // ServiceTile pill expects on the profile.
      if (rows.length) {
        const ids = rows.map(s => s.id);
        const { data: recs } = await supabase
          .from('recommendations')
          .select('service_id, recommender_id')
          .in('service_id', ids);
        const recIds = [...new Set((recs || []).map(r => r.recommender_id).filter(Boolean))];
        const { data: profs } = recIds.length
          ? await supabase.from('profiles').select('id, cc_verified_at').in('id', recIds)
          : { data: [] };
        const cmap = Object.fromEntries((profs || []).map(p => [p.id, !!p.cc_verified_at]));
        const sum = {};
        for (const r of recs || []) {
          const k = r.service_id;
          if (!sum[k]) sum[k] = { total: 0, friends: 0, connectors: 0 };
          sum[k].total += 1;
          if (cmap[r.recommender_id]) sum[k].connectors += 1; else sum[k].friends += 1;
        }
        if (!cancelled) setSummary(sum);
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  const firstName = (name || '').split(' ')[0] || 'their';

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      <div className="px-5 pt-7 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
        >
          ←
        </button>
        <h1 className="text-display-2 font-extrabold text-black leading-none">{firstName}&apos;s Services</h1>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-body text-b3 font-medium">Loading…</p>
        </div>
      ) : services.length === 0 ? (
        <div className="px-5 mt-8">
          <p className="text-body-sm text-b3 font-medium">No services listed.</p>
        </div>
      ) : (
        <div className="px-5 mt-5 flex flex-col gap-4">
          {services.map(svc => (
            <ServiceTile
              key={svc.id}
              svc={svc}
              recoSummary={summary[svc.id]}
              onOpen={() => navigate(`/service/${svc.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
