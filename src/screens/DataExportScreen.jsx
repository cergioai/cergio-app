// Data export dashboard (SPEC-85) — /ops/data
//
// Live, admin-gated page to download crawled leads city-by-city, split Services vs
// Creators, as CSV. Pick audience + city → Download. Uses the same admin/RLS scope
// as the rest of /ops. Client-side CSV build + Blob download (no backend needed).
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { exportLeads, getOutreachFilterOptions } from '../lib/api';

const AUDIENCES = [
  { id: 'services', label: 'Services' },
  { id: 'creators', label: 'Creators' },
];

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = keys.join(',');
  const body = rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
  return head + '\n' + body;
}

export function DataExportScreen() {
  const ctx = useOutletContext?.() || {};
  const showToast = ctx.showToast || (() => {});
  const [audience, setAudience] = useState('services');
  const [city, setCity] = useState('');
  const [options, setOptions] = useState({ cities: [] });
  const [busy, setBusy] = useState(false);
  const [lastCount, setLastCount] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    getOutreachFilterOptions(audience).then(({ data }) => {
      if (alive && data) setOptions({ cities: data.cities || [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, [audience]);

  const filters = useMemo(() => (city.trim() ? { city: city.trim() } : {}), [city]);

  const download = useCallback(async () => {
    setBusy(true); setErr(null); setLastCount(null);
    const { data, error } = await exportLeads(audience, filters);
    setBusy(false);
    if (error) { setErr(error.message || 'Export failed'); return; }
    if (!data.length) { setErr('No rows match that city/audience.'); return; }
    const csv = toCsv(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cityPart = city.trim() ? city.trim().replace(/[^\w -]/g, '') : 'All Cities';
    a.href = url;
    a.download = `Cergio ${cityPart} ${audience === 'services' ? 'Services' : 'Creators'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLastCount(data.length);
    showToast(`Downloaded ${data.length} rows`);
  }, [audience, filters, city]);

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">Data export</h1>
      <p className="text-meta-sm text-b3 mt-1 leading-snug">
        Download crawled leads city-by-city, split Services vs Creators. Pick an audience and city, then Download CSV.
      </p>

      <div className="mt-4 flex gap-2">
        {AUDIENCES.map(a => (
          <button key={a.id} onClick={() => setAudience(a.id)}
            className={`flex-1 rounded-xl py-2 text-meta-sm font-bold ${audience === a.id ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b3 mb-1.5">City</label>
        <input list="cg-export-cities" value={city} onChange={e => setCity(e.target.value)}
          placeholder="e.g. New York — leave blank for all cities"
          className="w-full bg-bg5 rounded-xl px-4 py-3 text-body outline-none focus:ring-2 focus:ring-g/30" />
        <datalist id="cg-export-cities">{options.cities.map(c => <option key={c} value={c} />)}</datalist>
      </div>

      <button onClick={download} disabled={busy}
        className="mt-4 w-full rounded-xl py-3 bg-g text-white font-extrabold disabled:opacity-50">
        {busy ? 'Preparing…' : `Download ${audience === 'services' ? 'Services' : 'Creators'} CSV`}
      </button>

      {lastCount != null && <p className="mt-3 text-meta-sm text-black">✓ {lastCount} rows downloaded.</p>}
      {err && <p className="mt-3 text-meta-sm text-danger">{err}</p>}

      <p className="mt-6 text-[11px] text-b3 leading-snug">
        Exports every column for the matched rows (name, contact, category/service, city, followers, outreach_status, etc.).
        Admin-only. Downloads happen entirely in your browser.
      </p>
    </div>
  );
}

export default DataExportScreen;
