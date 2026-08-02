// Data dashboard (SPEC-90) — /ops/data. Live, admin-gated: counts by SOURCE, city,
// status, growth + a filterable table + CSV download. Reads via the leads-dashboard
// edge function (service-role past RLS) — fixes the old "No rows" (RLS) regression.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { leadsDashboard } from '../lib/api';

// Services and Creators are two DIFFERENT CLASSES of data, not two filters on one pile:
// they live in different tables, label their origin in different columns (data_source vs
// discovered_via) and carry different fields. Keeping them visibly separate is the point.
// SPEC-210 — every dataset we hold, each downloadable live. The crawl queue matters as
// much as the leads: cost_usd lives on crawl_requests, so without it the dashboard cannot
// answer what a source cost or why it stopped.
const AUDIENCES = [
  { id: 'services', label: 'Services' },
  { id: 'creators', label: 'Creators' },
  { id: 'crawls', label: 'Crawl queue + spend' },
  { id: 'runs', label: 'Agent runs' },
];
const STATUSES = {
  services: ['', 'new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'],
  creators: ['', 'new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'],
  crawls: ['', 'new', 'crawling', 'delivered', 'failed', 'parked'],
  runs: [''],
};
const CITIES = [{ id: '', label: 'All' }, { id: 'NY', label: 'NYC' }, { id: 'FL', label: 'Miami' }];
const COLS_BY_AUDIENCE = {
  services: ['name', 'service_type', 'phone', 'owner_email', 'city', 'data_source', 'outreach_status', 'outreach_notes'],
  creators: ['ig_handle', 'display_name', 'category', 'followers', 'email', 'phone', 'city', 'is_business', 'discovered_via', 'outreach_status'],
  crawls: ['source', 'city', 'service_type', 'status', 'target_count', 'delivered_count', 'cost_usd', 'notes', 'updated_at'],
  runs: ['agent', 'status', 'rows_written', 'last_error', 'created_at'],
};

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const esc = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return keys.join(',') + '\n' + rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
}
function saveCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Stat({ label, value }) {
  return (<div className="rounded-xl bg-bg5 px-3 py-2"><div className="text-[11px] text-b3 font-bold uppercase tracking-wide">{label}</div><div className="text-lg font-extrabold text-black">{value ?? '—'}</div></div>);
}

export function DataExportScreen() {
  const [audience, setAudience] = useState('services');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [contactableOnly, setContactableOnly] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await leadsDashboard(audience, { city: city || null, source: source || null, status: status || null, contactableOnly });
    setBusy(false);
    if (error) { setErr(error.message || 'Load failed'); setData(null); return; }
    if (data?.error) { setErr(data.error); setData(null); return; }
    setData(data);
  }, [audience, city, source, status, contactableOnly]);

  useEffect(() => { load(); }, [load]);

  const sources = useMemo(() => Object.entries(data?.bySource || {}).sort((a, b) => b[1] - a[1]), [data]);

  // Download exactly what is on screen — the filters ARE the segment. Downloading "all
  // leads" and filtering in a spreadsheet is what made the old export useless.
  const download = () => {
    const rows = data?.rows || [];
    if (!rows.length) { setErr('No rows to download for this filter.'); return; }
    saveCsv(toCsv(rows), `Cergio ${audience} ${city || 'all'} ${source || 'all-sources'}${status ? ' ' + status : ''}${contactableOnly ? ' reachable' : ''}.csv`);
  };

  // "Download every source" — one file per source, so a segment arrives ready to work
  // rather than as one pile that has to be split in a spreadsheet.
  const downloadAllSources = async () => {
    const list = Object.keys(data?.bySource || {}).filter((s2) => (data.bySource[s2] || 0) > 0 && s2 !== '(other/unlabeled)');
    if (!list.length) { setErr('No sources with rows to download.'); return; }
    setBulk({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      const { data: d2, error: e2 } = await leadsDashboard(audience, { city: city || null, source: src, status: status || null, contactableOnly });
      if (!e2 && d2?.rows?.length) saveCsv(toCsv(d2.rows), `Cergio ${audience} ${src}${contactableOnly ? ' reachable' : ''}.csv`);
      setBulk({ done: i + 1, total: list.length });
    }
    setTimeout(() => setBulk(null), 2500);
  };

  const rows = data?.rows || [];
  const cols = COLS_BY_AUDIENCE[audience] || Object.keys(rows[0] || {}).slice(0, 8);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">Data dashboard</h1>
      <p className="text-meta-sm text-b3 mt-1">Live from the growth database. Pick a class and filters — the table and the CSV are that exact segment.</p>

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
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-black">
          {(STATUSES[audience] || ['']).map(st => <option key={st} value={st}>{st === '' ? 'All statuses' : st}</option>)}
        </select>
        {data?.isLeadTable && (
          <label className="flex items-center gap-1.5 rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-b3 cursor-pointer">
            <input type="checkbox" checked={contactableOnly} onChange={e => setContactableOnly(e.target.checked)} />
            Reachable only
          </label>
        )}
        <button onClick={load} className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-b3">↻ Refresh</button>
        <button onClick={download} className="rounded-xl bg-g px-4 py-2 text-meta-sm font-bold text-white">Download this view</button>
        <button onClick={downloadAllSources} disabled={!!bulk} className="rounded-xl bg-black px-4 py-2 text-meta-sm font-bold text-white disabled:opacity-50">
          {bulk ? `Exporting ${bulk.done}/${bulk.total}…` : 'Download every source'}
        </button>
      </div>

      {busy && <div className="mt-4 text-b3">Loading…</div>}
      {err && <div className="mt-4 text-red-600 text-meta-sm">{err}</div>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat label={data.label || 'Total'} value={data.total?.toLocaleString()} />
            <Stat label="NYC" value={data.byCity?.NYC?.toLocaleString()} />
            <Stat label="Miami" value={data.byCity?.Miami?.toLocaleString()} />
            <Stat label="With phone" value={data.withPhone?.toLocaleString()} />
            <Stat label="With email" value={data.withEmail?.toLocaleString()} />
            <Stat label="New 24h" value={data.growth?.last1d?.toLocaleString()} />
          </div>

          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-bg5 p-3">
              <div className="text-meta-sm font-bold text-black mb-2">By source · contactable %</div>
              {/* A lead with no phone and no email is not a lead (SPEC-192). A raw count
                  per source flatters a source that produces volume and no contacts, which
                  is exactly what we were paying for. The % is the number worth reading. */}
              {sources.map(([s, n]) => {
                const c = data?.contactBySource?.[s];
                const pct = c ? c.pct : null;
                const tone = pct == null ? 'text-b3' : pct >= 80 ? 'text-g' : pct >= 40 ? 'text-black' : 'text-red-600';
                return (
                  <div key={s} className="flex justify-between items-baseline text-meta-sm py-0.5">
                    <button className={`text-left ${source === s ? 'text-g font-bold' : 'text-b3'}`} onClick={() => setSource(s)}>{s}</button>
                    <span className="flex gap-2 items-baseline">
                      <span className={`text-[11px] font-bold ${tone}`}>{pct == null ? '—' : `${pct}% reachable`}</span>
                      <span className="font-bold text-black">{n.toLocaleString()}</span>
                    </span>
                  </div>
                );
              })}
              {audience === 'creators' && (
                <div className="mt-2 text-[11px] text-b3 leading-snug">
                  ig-creator-marketplace reads 0 until <b>IG_USER_ID</b> + <b>IG_MARKETPLACE_TOKEN</b>
                  {' '}are set — that needs the pending Meta permission, not a code change.
                </div>
              )}
            </div>
            <div className="rounded-xl border border-bg5 p-3">
              <div className="text-meta-sm font-bold text-black mb-2">By status</div>
              {Object.entries(data.byStatus || {}).map(([s, n]) => (
                <div key={s} className="flex justify-between text-meta-sm py-0.5"><span className="text-b3">{s}</span><span className="font-bold text-black">{n.toLocaleString()}</span></div>
              ))}
              <div className="mt-2 text-[11px] text-b3">Growth · 7d {data.growth?.last7d?.toLocaleString()} · 14d {data.growth?.last14d?.toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-bg5 overflow-x-auto -mx-4 sm:mx-0">
            {/* Say what the filter really holds. A silent cap reads as a small market —
                the same shape as the audit that reported 0 rows for every source. */}
            <div className="px-3 py-2 text-meta-sm font-bold text-black">
              Rows — {rows.length.toLocaleString()} loaded
              {data.filteredTotal > rows.length && (
                <span className="text-red-600"> of {data.filteredTotal.toLocaleString()} matching (capped at {data.rowCap.toLocaleString()} — narrow the filters or use “Download every source”)</span>
              )}
            </div>
            <table className="w-full text-[12px] table-fixed">
              <thead className="bg-bg5 text-b3"><tr>{cols.map(c => <th key={c} className="text-left px-2 py-1 font-bold">{c}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-t border-bg5">{cols.map(c => <td key={c} className="px-2 py-1 text-black align-top break-words max-w-[220px]">{String(r[c] ?? '')}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {rows.length > 200 && <div className="px-3 py-2 text-[11px] text-b3">Showing first 200 on screen — the download contains all {rows.length.toLocaleString()}.</div>}
          </div>
        </>
      )}
    </div>
  );
}
