// SPEC-70 — Public soft-launch landing: the founding free-barter directory.
//
// Route: /free  (PUBLIC — viewable signed-out for virality; actions route into
// the normal flows, which gate sign-in naturally.)
//
// Two browsable tabs:
//   • Free services — services offering a FREE option (a $0 offering) in exchange
//     for an IG/TikTok spotlight. Tap → PDP (/service/:id) to request.
//   • Creators for spotlights — Connector profiles (have an IG/TikTok handle)
//     willing to spotlight a service for free. Tap → profile (/u/:id) to connect.
//
// This is where opted-in founding members become visible + reachable, closing
// the soft-launch loop (outreach → opt-in → claim/list → discoverable here →
// direct request). No fake data (SPEC-12): every row is a real DB row; empty
// tabs show an honest empty state.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { compactN } from '../components/ui/reputation';

const PHOTO_GRADS = ['from-[#e8dcc8] via-[#b89870] to-[#604030]', 'from-[#cad8e8] via-[#7088b0] to-[#2e4060]', 'from-[#d8e8ca] via-[#88b070] to-[#406030]'];
function gradFor(id) {
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PHOTO_GRADS[Math.abs(h) % PHOTO_GRADS.length];
}
function initials(n) { return (n || '?').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase(); }

export function FreeBarterLandingScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('services'); // 'services' | 'creators'
  const [services, setServices] = useState(null);
  const [creators, setCreators] = useState(null);

  // Free services — listed services with at least one $0 offering.
  useEffect(() => {
    if (!supabaseReady) { setServices([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('services')
        .select(`id, title, category, taxonomy_provider_type, description, photo_class, cover_url, city, owner_id,
                 offerings ( price_cents, is_default )`)
        .eq('status', 'listed')
        .limit(120);
      if (cancelled) return;
      const free = (data || []).filter(s => (s.offerings || []).some(o => (o.price_cents ?? 0) === 0));
      // Owner names for the sub-line.
      const ownerIds = [...new Set(free.map(s => s.owner_id).filter(Boolean))];
      const { data: owners } = ownerIds.length
        ? await supabase.from('profiles').select('id, display_name').in('id', ownerIds)
        : { data: [] };
      const nameById = Object.fromEntries((owners || []).map(p => [p.id, p.display_name]));
      if (!cancelled) setServices(free.map(s => ({ ...s, ownerName: nameById[s.owner_id] || null })));
    })();
    return () => { cancelled = true; };
  }, []);

  // Creators — profiles with an IG / TikTok handle (the spotlight pool), biggest reach first.
  useEffect(() => {
    if (!supabaseReady) { setCreators([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, headline, instagram_handle, instagram_followers, tiktok_handle, tiktok_followers, cc_verified_at')
        .or('instagram_handle.not.is.null,tiktok_handle.not.is.null')
        .limit(120);
      if (cancelled) return;
      const rows = (data || []).sort((a, b) =>
        ((b.instagram_followers || 0) + (b.tiktok_followers || 0)) - ((a.instagram_followers || 0) + (a.tiktok_followers || 0)));
      setCreators(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      {/* Hero */}
      <div className="px-5 pt-9 pb-1">
        <p className="text-meta-sm font-extrabold text-gd uppercase tracking-wide">Cergio · Founding launch</p>
        <h1 className="text-display-2 font-extrabold text-black leading-[1.1] mt-1">Free services ↔ free spotlights</h1>
        <p className="text-body text-b2 leading-relaxed mt-2">
          Local businesses offer a service free; creators spotlight them to their followers on Instagram &amp; TikTok.
          Browse the founding group below and connect directly.
        </p>
      </div>

      {/* Tabs */}
      <div className="px-5 mt-4 flex gap-2">
        {[['services', 'Free services'], ['creators', 'Creators for spotlights']].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-pill py-2 text-body-sm font-extrabold transition-colors
              ${tab === k ? 'bg-g text-white' : 'bg-white border border-line text-b2 hover:border-g/40'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Free services */}
      {tab === 'services' && (
        <div className="px-5 mt-5">
          {services === null ? (
            <p className="text-body text-b3 mt-6">Loading…</p>
          ) : services.length === 0 ? (
            <EmptyState text="No free services listed yet — the founding businesses are coming online now. Check back soon." />
          ) : (
            <div className="flex flex-col gap-4">
              {services.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/service/${s.id}`)}
                  className="w-full text-left bg-white border border-line rounded-[16px] overflow-hidden hover:border-g/40 cg-tap"
                >
                  <div className={`relative h-[140px] bg-gradient-to-br ${gradFor(s.id)}`}>
                    {s.cover_url && <img src={s.cover_url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
                    <span className="absolute top-3 left-3 bg-g text-white text-meta-sm font-extrabold px-2.5 py-1 rounded-pill">Free for a spotlight</span>
                  </div>
                  <div className="p-4">
                    <p className="text-body-lg font-extrabold text-black truncate">{s.title || 'Service'}</p>
                    <p className="text-body-sm text-b3 mt-0.5 truncate">
                      {s.taxonomy_provider_type || s.category || 'Service'}{s.ownerName ? ` · ${s.ownerName}` : ''}{s.city ? ` · ${s.city}` : ''}
                    </p>
                    {s.description && <p className="text-body-sm text-b3 leading-relaxed mt-1.5 line-clamp-2">{s.description}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Creators */}
      {tab === 'creators' && (
        <div className="px-5 mt-5">
          {creators === null ? (
            <p className="text-body text-b3 mt-6">Loading…</p>
          ) : creators.length === 0 ? (
            <EmptyState text="No creators listed yet — founding creators are joining now. Check back soon." />
          ) : (
            <div className="flex flex-col">
              {creators.map(c => {
                const ig = c.instagram_followers || 0, tt = c.tiktok_followers || 0;
                const reach = [];
                if (ig > 0) reach.push(`${compactN(ig)} IG`);
                if (tt > 0) reach.push(`${compactN(tt)} TikTok`);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate(`/u/${c.id}`)}
                    className="w-full py-4 flex items-center gap-3 text-left border-b border-line hover:bg-bg5/30 transition-colors"
                  >
                    <span className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradFor(c.id)} text-white font-extrabold flex items-center justify-center flex-shrink-0`}>
                      {initials(c.display_name || c.instagram_handle || c.tiktok_handle)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-body-lg font-extrabold text-black truncate flex items-center gap-1.5">
                        {c.display_name || `@${c.instagram_handle || c.tiktok_handle}`}
                        {c.cc_verified_at && (
                          <span className="inline-flex items-center gap-0.5 bg-g text-white text-meta-sm font-extrabold px-2 py-0.5 rounded-pill leading-none">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" /></svg>Connector
                          </span>
                        )}
                      </p>
                      {c.headline && <p className="text-body-sm text-b3 truncate mt-0.5">{c.headline}</p>}
                      {reach.length > 0 && <p className="text-body-sm text-gd font-extrabold mt-0.5">{reach.join(' · ')}</p>}
                    </div>
                    <svg width="9" height="15" viewBox="0 0 11 18" fill="none" className="flex-shrink-0 text-black/50"><path d="M1.5 1.5L9 9l-7.5 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer CTA — join the founding group */}
      <div className="px-5 mt-8">
        <div className="bg-white border border-line rounded-[16px] p-5 text-center">
          <p className="text-body-lg font-extrabold text-black">Want in on the founding group?</p>
          <p className="text-body-sm text-b3 leading-relaxed mt-1">
            List your service free-for-a-spotlight, or join as a creator and get free local services.
          </p>
          <button
            type="button"
            onClick={() => navigate('/auth?src=soft_launch')}
            className="mt-4 bg-g text-white rounded-[24px] py-3 px-6 text-body-sm font-extrabold cg-cta"
          >
            Claim your founding spot →
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="mt-6 bg-white border border-line rounded-[16px] p-6 text-center">
      <p className="text-body text-b3 leading-relaxed">{text}</p>
    </div>
  );
}
