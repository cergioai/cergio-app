// Data dashboard (SPEC-90) — /ops/data. Live, admin-gated: counts by SOURCE, city,
// status, growth + a filterable table + CSV download. Reads via the leads-dashboard
// edge function (service-role past RLS) — fixes the old "No rows" (RLS) regression.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { leadsDashboard } from '../lib/api';

const AUDIENCES = [{ id: 'services', label: 'Services' }, { id: 'creators', label: 'Creators' }];
const CITIES = [{ id: '', label: 'All' }, { id: 'NY', label: 'NYC' }, { id: 'FL', label: 'Miami' }];

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const esc = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return keys.join(',') + '\n' + rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
}
function Stat({ label, value }) {
  return (<div className="rounded-xl bg-bg5 px-3 py-2"><div className="text-[11px] text-b3 font-bold uppercase tracking-wide">{label}</div><div className="text-lg font-extrabold text-black">{value ?? '—'}</div></div>);
}

export function DataExportScreen() {
  const [audience, setAudience] = useState('services');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await leadsDashboard(audience, { city: city || null, source: source || null });
    setBusy(false);
    if (error) { setErr(error.message || 'Load failed'); setData(null); return; }
    if (data?.error) { setErr(data.error); setData(null); return; }
    setData(data);
  }, [audience, city, source]);

  useEffect(() => { load(); }, [load]);

  const sources = useMemo(() => Object.entries(data?.bySource || {}).sort((a, b) => b[1] - a[1]), [data]);

  const download = () => {
    const rows = data?.rows || [];
    if (!rows.length) { setErr('No rows to download for this filter.'); return; }
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Cergio ${audience} ${city || 'all'} ${source || 'all-sources'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const rows = data?.rows || [];
  const cols = audience === 'creators'
    ? ['ig_handle', 'display_name', 'category', 'followers', 'email', 'phone', 'city']
    : ['name', 'service_type', 'phone', 'owner_email', 'city', 'data_source', 'outreach_notes'];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">Data dashboard</h1>
      <p className="text-meta-sm text-b3 mt-1">Live counts by source, city, and status — pick filters, review, download.</p>

      <div className="mt-4 flex flex-wrap gap-2 items-center">
        {AUDIENCES.map(a => (
          <button key={a.id} onClick={() => { setAudience(a.id); setSource(''); }}
            className={`rounded-xl px-4 py-2 text-meta-sm font-bold ${audience === a.id ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>{a.label}</button>
        ))}
        <span className="mx-1 text-b3">·</span>
        {CITIES.map(c => (
          <button key={c.id} onClick={() => setCity(c.id)}
            className={`rounded-xl px-3 py-2 text-meta-sm font-bold ${city === c.id ? 'bg-black text-white' : 'bg-bg5 text-b3'}`}>{c.label}</button>
        ))}
        <select value={source} onChange={e => setSource(e.target.value)} className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-black">
          <option value="">All sources</option>
          {sources.map(([s]) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-b3">↻ Refresh</button>
        <button onClick={download} className="rounded-xl bg-g px-4 py-2 text-meta-sm font-bold text-white">Download CSV</button>
      </div>

      {busy && <div className="mt-4 text-b3">Loading…</div>}
      {err && <div className="mt-4 text-red-600 text-meta-sm">{err}</div>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat label="Total" value={data.total?.toLocaleString()} />
            <Stat label="NYC" value={data.byCity?.NYC?.toLocaleString()} />
            <Stat label="Miami" value={data.byCity?.Miami?.toLocaleString()} />
            <Stat label="With phone" value={data.withPhone?.toLocaleString()} />
            <Stat label="With email" value={data.withEmail?.toLocaleString()} />
            <Stat label="New 24h" value={data.growth?.last1d?.toLocaleString()} />
          </div>

          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-bg5 p-3">
              <div className="text-meta-sm font-bold text-black mb-2">By source</div>
              {sources.map(([s, n]) => (
                <div key={s} className="flex justify-between text-meta-sm py-0.5">
                  <button className={`text-left ${source === s ? 'text-g font-bold' : 'text-b3'}`} onClick={() => setSource(s)}>{s}</button>
                  <span className="font-bold text-black">{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-bg5 p-3">
              <div className="text-meta-sm font-bold text-black mb-2">By status</div>
              {Object.entries(data.byStatus || {}).map(([s, n]) => (
                <div key={s} className="flex justify-between text-meta-sm py-0.5"><span className="text-b3">{s}</span><span className="font-bold text-black">{n.toLocaleString()}</span></div>
              ))}
              <div className="mt-2 text-[11px] text-b3">Growth · 7d {data.growth?.last7d?.toLocaleString()} · 14d {data.growth?.last14d?.toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-bg5 overflow-auto">
            <div className="px-3 py-2 text-meta-sm font-bold text-black">Rows ({rows.length}{rows.length >= 2000 ? '+ capped' : ''})</div>
            <table className="w-full text-[12px]">
              <thead className="bg-bg5 text-b3"><tr>{cols.map(c => <th key={c} className="text-left px-2 py-1 font-bold">{c}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-t border-bg5">{cols.map(c => <td key={c} className="px-2 py-1 text-black truncate max-w-[180px]">{String(r[c] ?? '')}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {rows.length > 200 && <div className="px-3 py-2 text-[11px] text-b3">Showing first 200 — download CSV for all {rows.length}.</div>}
          </div>
        </>
      )}
    </div>
  );
}
