// CERGIO-GUARD (2026-06-17, Tarik — SPEC-49c): the dedicated "all services"
// page for a profile, reached from the unified profile's "View all services"
// link (shown only when a profile has more than the 3 services rendered
// inline on /u/:profileId). Lists EVERY listed service the profile owns,
// reusing the same ServiceTile + reco-summary (friends/Connectors) as the
// profile. Read-only; tapping a tile opens its PDP. No fake data (SPEC-12).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { ServiceTile } from './PublicProfileScreen';

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
