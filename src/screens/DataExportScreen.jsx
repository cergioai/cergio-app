// Data dashboard — /ops/data. Live, admin-gated. Reads leads-dashboard (service role,
// past RLS) against the GROWTH database.
//
// SPEC-223 — rewritten for legibility after the founder said "filters not respecting
// view... formats are not legible... numbers run into each other". Three real defects,
// not styling taste:
//   1. Switching class KEPT the previous class's filters. Picking "parked" on the crawl
//      queue and then clicking Services sent status=parked against leads_services, which
//      has no such status, so it returned nothing and looked like broken data.
//   2. Source options came from the UNFILTERED source list, so a source with zero rows
//      under the current city was still offered and could only ever return empty.
//   3. Counts sat in a tight grid with proportional digits, so 21552 and 15796 ran into
//      each other and could not be read at a glance.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { leadsDashboard } from '../lib/api';

// Four DIFFERENT CLASSES of data, not four filters on one pile: different tables,
// different origin columns (data_source vs discovered_via vs source), different fields.
const AUDIENCES = [
  { id: 'services', label: 'Services' },
  { id: 'creators', label: 'Creators' },
  { id: 'crawls', label: 'Crawl queue' },
  { id: 'runs', label: 'Agent runs' },
];
const STATUSES = {
  services: ['new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'],
  creators: ['new', 'pending_review', 'queued', 'opted_in', 'do_not_contact'],
  crawls: ['new', 'crawling', 'delivered', 'failed', 'parked'],
  runs: [],
};
const CITIES = [{ id: '', label: 'All' }, { id: 'NY', label: 'NYC' }, { id: 'FL', label: 'Miami' }];
const COLS = {
  services: ['name', 'service_type', 'phone', 'owner_email', 'city', 'data_source', 'outreach_status'],
  creators: ['ig_handle', 'display_name', 'category', 'followers', 'email', 'city', 'is_business', 'discovered_via'],
  crawls: ['source', 'city', 'service_type', 'status', 'target_count', 'delivered_count', 'cost_usd', 'updated_at'],
  runs: ['agent', 'status', 'rows_written', 'last_error', 'created_at'],
};
const NOTE_COL = { services: 'outreach_notes', crawls: 'notes' };

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const esc = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return keys.join(',') + '\n' + rows.map((r) => keys.map((k) => esc(r[k])).join(',')).join('\n');
}
function saveCsv(csv, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}
const n = (v) => (v == null ? '—' : Number(v).toLocaleString());

// tabular-nums so digits line up in a column and 21,552 beside 15,796 stays readable.
function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-bg5 px-3 py-2.5">
      <div className="text-[10px] text-b3 font-bold uppercase tracking-wider leading-tight">{label}</div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums leading-none ${tone || 'text-black'}`}>{value}</div>
    </div>
  );
}
function Pill({ on, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${on ? 'bg-black text-white' : 'bg-bg5 text-b3'}`}>
      {children}
    </button>
  );
}

export function DataExportScreen() {
  const [audience, setAudience] = useState('services');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [reachableOnly, setReachableOnly] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [bulk, setBulk] = useState(null);

  // DEFECT 1. Every filter below the class is scoped TO that class. Carrying them across
  // sent nonsense to the server and returned an empty view that read as broken data.
  const pickAudience = (id) => { setAudience(id); setSource(''); setStatus(''); setReachableOnly(false); };

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data: d, error } = await leadsDashboard(audience, {
      city: city || null, source: source || null, status: status || null, contactableOnly: reachableOnly,
    });
    setBusy(false);
    if (error) { setErr(error.message || 'Load failed'); setData(null); return; }
    if (d?.error) { setErr(d.error); setData(null); return; }
    setData(d);
  }, [audience, city, source, status, reachableOnly]);
  useEffect(() => { load(); }, [load]);

  // DEFECT 2. Only offer sources that actually have rows. An option that can only ever
  // return nothing is a trap, not a filter.
  const sources = useMemo(
    () => Object.entries(data?.bySource || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    [data],
  );
  const rows = data?.rows || [];
  const cols = COLS[audience] || Object.keys(rows[0] || {}).slice(0, 8);
  const noteCol = NOTE_COL[audience];
  const isLead = data?.isLeadTable;
  const filtered = !!(city || source || status || reachableOnly);

  const download = () => {
    if (!rows.length) { setErr('Nothing to download for this filter.'); return; }
    saveCsv(toCsv(rows), `Cergio ${audience}${city ? ' ' + city : ''}${source ? ' ' + source : ''}${status ? ' ' + status : ''}${reachableOnly ? ' reachable' : ''}.csv`);
  };
  const downloadEach = async () => {
    const list = sources.map(([s]) => s).filter((s) => s !== '(other/unlabeled)');
    if (!list.length) { setErr('No sources with rows.'); return; }
    setBulk({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      const { data: d2, error } = await leadsDashboard(audience, { city: city || null, source: list[i], status: status || null, contactableOnly: reachableOnly });
      if (!error && d2?.rows?.length) saveCsv(toCsv(d2.rows), `Cergio ${audience} ${list[i]}.csv`);
      setBulk({ done: i + 1, total: list.length });
    }
    setTimeout(() => setBulk(null), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-extrabold text-black">Data</h1>
      <p className="text-[13px] text-b3 mt-1">Live from the growth database. What you filter is what downloads.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {AUDIENCES.map((a) => <Pill key={a.id} on={audience === a.id} onClick={() => pickAudience(a.id)}>{a.label}</Pill>)}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] text-b3 font-bold uppercase tracking-wider mb-1.5">City</div>
          <div className="flex gap-1.5">
            {CITIES.map((c) => <Pill key={c.id} on={city === c.id} onClick={() => setCity(c.id)}>{c.label}</Pill>)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-b3 font-bold uppercase tracking-wider mb-1.5">Source</div>
          <select value={source} onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black">
            <option value="">All sources</option>
            {sources.map(([s, v]) => <option key={s} value={s}>{s} ({v.toLocaleString()})</option>)}
          </select>
        </div>
        <div>
          <div className="text-[10px] text-b3 font-bold uppercase tracking-wider mb-1.5">Status</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!STATUSES[audience]?.length}
            className="w-full rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-black disabled:opacity-40">
            <option value="">All statuses</option>
            {(STATUSES[audience] || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 items-center">
        {isLead && <Pill on={reachableOnly} onClick={() => setReachableOnly((v) => !v)}>Reachable only</Pill>}
        {filtered && (
          <button onClick={() => { setCity(''); setSource(''); setStatus(''); setReachableOnly(false); }}
            className="text-[13px] font-bold text-b3 underline">Clear</button>
        )}
        <div className="flex-1" />
        <button onClick={load} className="rounded-xl bg-bg5 px-3 py-2 text-[13px] font-bold text-b3">↻</button>
        <button onClick={download} className="rounded-xl bg-g px-4 py-2 text-[13px] font-bold text-white">Download view</button>
        <button onClick={downloadEach} disabled={!!bulk}
          className="rounded-xl bg-black px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
          {bulk ? `${bulk.done}/${bulk.total}…` : 'Download each source'}
        </button>
      </div>

      {busy && <div className="mt-4 text-[13px] text-b3">Loading…</div>}
      {err && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-600">{err}</div>}

      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label={audience === 'crawls' ? 'Jobs' : audience === 'runs' ? 'Runs' : 'Leads'} value={n(data.total)} />
            {isLead && <Stat label="With phone" value={n(data.withPhone)} />}
            {isLead && <Stat label="With email" value={n(data.withEmail)} />}
            <Stat label="New 24h" value={n(data.growth?.last1d)} />
          </div>

          {!!sources.length && (
            <div className="mt-4 rounded-xl border border-bg5 divide-y divide-bg5">
              <div className="px-3 py-2 text-[10px] text-b3 font-bold uppercase tracking-wider">By source · tap to filter</div>
              {sources.map(([s, v]) => {
                const c = data.contactBySource?.[s];
                const tone = !c ? 'text-b3' : c.pct >= 80 ? 'text-g' : c.pct >= 40 ? 'text-black' : 'text-red-600';
                return (
                  <button key={s} onClick={() => setSource(source === s ? '' : s)}
                    className={`w-full flex items-baseline gap-3 px-3 py-2.5 text-left ${source === s ? 'bg-bg5' : ''}`}>
                    <span className="flex-1 text-[13px] font-bold text-black truncate">{s}</span>
                    {c && <span className={`text-[11px] font-bold tabular-nums ${tone}`}>{c.pct}%</span>}
                    <span className="w-20 text-right text-[13px] font-extrabold text-black tabular-nums">{v.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 text-[13px] font-bold text-black tabular-nums">
            {rows.length.toLocaleString()} rows
            {data.filteredTotal > rows.length && <span className="text-red-600"> of {data.filteredTotal.toLocaleString()} (capped)</span>}
          </div>

          {/* CARDS. Any 7-10 column table clips its last column on a narrow screen; a card
              wraps and stays legible at every width. */}
          <div className="mt-2 space-y-2">
            {rows.slice(0, 100).map((r, i) => (
              <div key={i} className="rounded-xl border border-bg5 p-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2.5">
                  {cols.map((c) => (
                    <div key={c} className="min-w-0">
                      <div className="text-[10px] text-b3 font-bold uppercase tracking-wider leading-tight">{c.replace(/_/g, ' ')}</div>
                      <div className="text-[13px] text-black break-words leading-snug">{String(r[c] ?? '—')}</div>
                    </div>
                  ))}
                </div>
                {noteCol && r[noteCol] && (
                  <div className="mt-2.5 pt-2.5 border-t border-bg5 text-[11px] text-b3 break-words leading-snug">{String(r[noteCol])}</div>
                )}
              </div>
            ))}
            {rows.length > 100 && <div className="text-[11px] text-b3">Showing 100 — the download has all {rows.length.toLocaleString()}.</div>}
            {!rows.length && !busy && <div className="rounded-xl border border-bg5 px-3 py-4 text-[13px] text-b3">No rows for this filter.</div>}
          </div>
        </>
      )}
    </div>
  );
}
