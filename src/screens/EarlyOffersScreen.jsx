// Early offers (SPEC-95) — /early. Browse founding members who opted in:
// services offering a free service, creators offering a free IG spotlight.
// Request directly instead of searching. Public; no contact data exposed.
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { earlyOffers } from '../lib/api';

function Avatar({ name = '', ig }) {
  const initials = name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#8fbf9f] to-[#3f7d54] flex items-center justify-center text-white font-extrabold text-meta-sm shrink-0">
      {ig ? initials : initials}
    </div>
  );
}
export function EarlyOffersScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('services');
  const [city, setCity] = useState('');
  const [d, setD] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await earlyOffers({ city: city || null });
    setBusy(false);
    if (error || data?.error) { setErr(error?.message || data?.error); return; }
    setD(data);
  }, [city]);
  useEffect(() => { load(); }, [load]);

  const services = d?.services || [];
  const creators = d?.creators || [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">Founding offers</h1>
      <p className="text-meta-sm text-b3 mt-1 leading-snug">
        Early members offering something free to get started — browse and request directly.
        Services offer a <b>free service</b>; creators offer a <b>free IG spotlight</b>.
      </p>

      <div className="mt-4 flex gap-2 items-center flex-wrap">
        <button onClick={() => setTab('services')}
          className={`rounded-xl px-4 py-2 text-meta-sm font-bold ${tab === 'services' ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>
          Free services{d ? ` (${d.counts.services})` : ''}
        </button>
        <button onClick={() => setTab('creators')}
          className={`rounded-xl px-4 py-2 text-meta-sm font-bold ${tab === 'creators' ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>
          Free spotlights{d ? ` (${d.counts.creators})` : ''}
        </button>
        <select value={city} onChange={e => setCity(e.target.value)}
          className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-black">
          <option value="">All cities</option>
          {(d?.cities || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {busy && <div className="mt-4 text-b3">Loading…</div>}
      {err && <div className="mt-4 text-red-600 text-meta-sm">{err}</div>}

      {d && tab === 'services' && (
        services.length === 0
          ? <p className="mt-6 text-meta text-b3">No founding services yet in this area — they're being invited now.</p>
          : <div className="mt-4 space-y-2">
              {services.map(s => (
                <div key={s.id} className="bg-bg4 rounded-[18px] p-3.5 flex items-start gap-3">
                  <Avatar name={s.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-extrabold text-black truncate">{s.name}</p>
                    <p className="text-meta-sm text-gd font-extrabold">{s.service_type}</p>
                    <p className="text-meta-sm text-b3">{[s.city, s.state].filter(Boolean).join(', ')}</p>
                    <span className="inline-block mt-1 bg-gl text-gd rounded-pill px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">Offering 1 free service</span>
                  </div>
                  <button onClick={() => navigate(`/request?type=${encodeURIComponent(s.service_type || '')}&to=${encodeURIComponent(s.name || '')}`)}
                    className="rounded-xl bg-g px-3 py-2 text-meta-sm font-bold text-white shrink-0">Request</button>
                </div>))}
            </div>
      )}

      {d && tab === 'creators' && (
        creators.length === 0
          ? <p className="mt-6 text-meta text-b3">No founding creators yet in this area — they're being invited now.</p>
          : <div className="mt-4 space-y-2">
              {creators.map(c => (
                <div key={c.id} className="bg-bg4 rounded-[18px] p-3.5 flex items-start gap-3">
                  <Avatar name={c.name || c.handle} ig />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-extrabold text-black truncate">{c.name || `@${c.handle}`}</p>
                    {c.handle && (
                      <a href={`https://instagram.com/${String(c.handle).replace(/^@/, '')}`} target="_blank" rel="noreferrer"
                        className="text-meta-sm font-extrabold text-gd hover:underline">@{String(c.handle).replace(/^@/, '')} ↗</a>
                    )}
                    <p className="text-meta-sm text-b3">
                      {[c.category, c.followers ? `${Number(c.followers).toLocaleString()} followers` : null, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                    </p>
                    <span className="inline-block mt-1 bg-gl text-gd rounded-pill px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">Offering a free IG spotlight</span>
                  </div>
                  <button onClick={() => navigate(`/spotlight/request?creator=${encodeURIComponent(c.handle || '')}`)}
                    className="rounded-xl bg-g px-3 py-2 text-meta-sm font-bold text-white shrink-0">Request</button>
                </div>))}
            </div>
      )}
    </div>
  );
}
