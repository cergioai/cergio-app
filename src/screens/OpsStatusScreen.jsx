// Ops STATUS console (SPEC-94) — /ops/status. ONE page: QA tests/bugs, agents on-off,
// crawls per source, product/social-graph density. Everything proven by DATA.
import { useEffect, useState, useCallback } from 'react';
import { opsConsole } from '../lib/api';

const TABS = [
  { id: 'live', label: 'Services' },
  { id: 'creators', label: 'Creator sources' },
  { id: 'qa', label: 'QA & Bugs' },
  { id: 'agents', label: 'Agents' },
  { id: 'crawls', label: 'Crawls' },
  { id: 'product', label: 'Product data' },
];
function csvOf(rows) {
  if (!rows || !rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return keys.join(',') + '\n' + rows.map(r => keys.map(k => esc(r[k])).join(',')).join('\n');
}
function dl(name, rows) {
  const blob = new Blob([csvOf(rows)], { type: 'text/csv;charset=utf-8;' });
  const u = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = u; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function Bar({ n, target }) {
  const pct = Math.min(100, Math.round((100 * (n || 0)) / (target || 1)));
  return (<div className="mt-1 h-2 rounded-full bg-bg5 overflow-hidden"><div className="h-full bg-g" style={{ width: `${pct}%` }} /></div>);
}
function Stat({ label, value, bad }) {
  return (<div className="rounded-xl bg-bg5 px-3 py-2">
    <div className="text-[11px] text-b3 font-bold uppercase tracking-wide">{label}</div>
    <div className={`text-lg font-extrabold ${bad ? 'text-red-600' : 'text-black'}`}>{value ?? '—'}</div>
  </div>);
}
export function OpsStatusScreen() {
  const [tab, setTab] = useState('live');
  // SPEC-227: CITY is the DMA (NYC / Miami). LOCATION is the neighbourhood inside it.
  // The dropdown used to list Bronx, Astoria, Bayside under a "City" label — those are
  // locations, which is exactly why it read as wrong.
  const [city, setCity] = useState('');       // '' = both DMAs
  const [location, setLocation] = useState('');
  // SPEC-229 — same time windows as /ops/data so the two screens cannot disagree.
  const [hours, setHours] = useState(0);
  const TIMES = [[0, 'All'], [6, '6h'], [12, '12h'], [24, '24h'], [48, '2d'], [72, '3d'], [168, '7d'], [336, '2w'], [672, '4w']];
  // SPEC-232 — how many rows a CSV contains is a separate question from which rows match.
  const SIZES = [100, 500, 1000, 5000, 10000, 25000];
  const [size, setSize] = useState(1000);
  const [category, setCategory] = useState('');
  const [d, setD] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await opsConsole({ ...(city ? { city } : {}), ...(location ? { location } : {}), ...(hours ? { sinceHours: hours } : {}), ...(category ? { category } : {}), limit: size }); setBusy(false);
    if (error || data?.error) { setErr(error?.message || data?.error); return; }
    setD(data);
  }, [city, location, hours, category, size]);
  useEffect(() => { load(); }, [load]);

  // download ONE source on click (the console used to preload every source -> timeout).
  // The CSV is scoped to the SAME city filter as the view it was clicked from.
  const fetchDl = useCallback(async (key) => {
    const { data, error } = await opsConsole({ download: key, ...(city ? { city } : {}), ...(location ? { location } : {}), ...(hours ? { sinceHours: hours } : {}), ...(category ? { category } : {}), limit: size });
    if (error || !data?.download?.[key]?.length) { setErr(error?.message || `no rows for ${key}${location || city ? ` in ${location || city}` : ''}`); return; }
    dl([key.replace(':', '_'), city || 'all', location || ''].filter(Boolean).join('_'), data.download[key]);
  }, [city, location, hours, category, size]);

  return (
    <div className="w-full max-w-full mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-extrabold text-black">Ops console</h1>
        <button onClick={load} className="shrink-0 rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-b3">↻ Refresh</button>
      </div>
      <p className="text-meta-sm text-b3 mt-1">Live proof: what's running, what's broken, what's been crawled.</p>

      <div className="mt-4 flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-xl px-4 py-2 text-meta-sm font-bold ${tab === t.id ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>{t.label}</button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <label className="text-[11px] font-bold uppercase tracking-wide text-b3">City</label>
        <select value={city} onChange={e => { setCity(e.target.value); setLocation(''); }}
          className="rounded-xl border border-bg5 bg-white px-3 py-2 text-meta-sm font-bold text-black">
          <option value="">All cities</option>
          {Object.entries(d?.filter?.cities || {}).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <label className="text-[11px] font-bold uppercase tracking-wide text-b3">Location</label>
        <select value={location} onChange={e => setLocation(e.target.value)}
          className="rounded-xl border border-bg5 bg-white px-3 py-2 text-meta-sm font-bold text-black">
          <option value="">All locations</option>
          {Object.entries(d?.filter?.locations || {}).map(([l, n]) => (
            <option key={l} value={l}>{l} ({n.toLocaleString()})</option>
          ))}
        </select>
        <label className="text-[11px] font-bold uppercase tracking-wide text-b3">Time</label>
        <div className="flex flex-wrap gap-1">
          {TIMES.map(([h, l]) => (
            <button key={h} onClick={() => setHours(h)}
              className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${hours === h ? 'bg-black text-white' : 'bg-bg5 text-b3'}`}>{l}</button>
          ))}
        </div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-b3">Category</label>
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="rounded-xl border border-bg5 bg-white px-3 py-2 text-meta-sm font-bold text-black">
          <option value="">All categories</option>
          {Object.entries(d?.filter?.categories || {}).map(([c, n]) => (
            <option key={c} value={c}>{c} ({n.toLocaleString()})</option>
          ))}
        </select>
        <label className="text-[11px] font-bold uppercase tracking-wide text-b3">Rows</label>
        <select value={size} onChange={e => setSize(Number(e.target.value))}
          className="rounded-xl border border-bg5 bg-white px-3 py-2 text-meta-sm font-bold text-black">
          {SIZES.map(v => <option key={v} value={v}>Last {v.toLocaleString()}</option>)}
        </select>
        {(city || location || hours || category) && <button onClick={() => { setCity(''); setLocation(''); setHours(0); setCategory(''); }} className="text-[12px] font-bold text-gd">clear</button>}
        <span className="text-[11px] text-b3">every count + CSV below is scoped to this city and location</span>
      </div>
      {/* SPEC-235 — a zero that came from a failed query must say so. "Services total 0"
          beside "NYC 12,034" gave no way to tell which number was lying. */}
      {!!(d?.crawls?.count_errors || []).length && (
        <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-600 font-bold">
          count query failed — these zeros are NOT real: {(d.crawls.count_errors || []).join(' · ')}
        </div>
      )}
      {!!Object.keys(d?.crawls?.off_scope_states || {}).length && (
        <div className="mt-2 rounded-xl bg-bg5 px-3 py-2 text-[12px] text-b3">
          <b>Off-target rows</b> (outside Phase 1, not offered as a city):{' '}
          {Object.entries(d.crawls.off_scope_states).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}
        </div>
      )}
      <div className="hidden">
      </div>
      {busy && <div className="mt-4 text-b3">Loading…</div>}
      {d && (!d.counter || !d.creatorsBySource) && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-[12px] text-red-700">
          <b>STALE PAYLOAD — numbers below are incomplete, do not quote them.</b><br />
          Served by <code>{d.served_by || 'unknown'}</code>, which is missing{' '}
          {[!d.counter && 'counter', !d.creatorsBySource && 'creatorsBySource'].filter(Boolean).join(' + ')}.
          The endpoint in production is behind main (it is outside the CI deploy array).
          Missing values show as — , never as 0.
        </div>
      )}
      {err && <div className="mt-4 text-red-600 text-meta-sm">{err}</div>}

      {d && tab === 'live' && (<>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-bg5 p-3">
            <div className="text-meta-sm font-bold text-black">NYC services</div>
            <div className="text-2xl font-extrabold text-black">{d.counter ? d.counter.nyc_services.toLocaleString() : '—'} <span className="text-meta-sm text-b3">/ {d.counter ? d.counter.nyc_target.toLocaleString() : '—'}</span></div>
            <Bar n={d.counter?.nyc_services} target={d.counter?.nyc_target} />
            <div className="text-meta-sm text-b3 mt-1">creators {d.counter ? d.counter.nyc_creators.toLocaleString() : '—'}</div>
          </div>
          <div className="rounded-xl border border-bg5 p-3">
            <div className="text-meta-sm font-bold text-black">Miami services</div>
            <div className="text-2xl font-extrabold text-black">{d.counter ? d.counter.miami_services.toLocaleString() : '—'} <span className="text-meta-sm text-b3">/ {d.counter ? d.counter.miami_target.toLocaleString() : '—'}</span></div>
            <Bar n={d.counter?.miami_services} target={d.counter?.miami_target} />
            <div className="text-meta-sm text-b3 mt-1">creators {d.counter ? d.counter.miami_creators.toLocaleString() : '—'}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="New 24h" value={d.counter ? d.counter.services_new_24h.toLocaleString() : (d.crawls?.services_new_24h ?? 0).toLocaleString()} />
          <Stat label="Open bugs" value={d.qa?.open_bugs} bad={(d.qa?.open_bugs ?? 0) > 0} />
          <Stat label="Services total" value={(d.crawls?.services_total ?? 0).toLocaleString()} />
        </div>
        {d.engine?.meta && (
          <div className="mt-4 rounded-xl border border-bg5 p-3">
            <div className="text-meta-sm font-bold text-black mb-1">Supply engine — last run {(d.engine.started_at || '').slice(0, 16)}</div>
            <div className="text-meta-sm text-b3">live sources: {(d.engine.meta.live_sources || []).join(', ')}</div>
            {(d.engine.meta.disabled_sources || []).length > 0 && <div className="text-meta-sm text-red-600 font-bold">auto-disabled: {(d.engine.meta.disabled_sources || []).join(', ')}</div>}
            {/* SPEC-239 — a founder-PAUSED source must never read as broken or auto-disabled.
                The reason travels with the payload (crawls.source_states) so this line and
                the Crawls tab tell the same story. */}
            {Object.entries(d.crawls?.source_states || {}).filter(([, v]) => v.state === 'paused').map(([s2, v]) => (
              <div key={s2} className="text-meta-sm text-amber-700 font-bold">{s2} PAUSED — <span className="font-normal text-b3">{v.reason}</span></div>
            ))}
            <div className="mt-2 text-meta-sm"><b>bugs found:</b> {(d.engine.meta.bugs_found || ['none']).join(' · ')}</div>
            <div className="text-meta-sm text-gd"><b>fixes applied:</b> {(d.engine.meta.fixes_applied || ['none']).join(' · ')}</div>
            <div className="mt-2 text-[12px]">
              {Object.entries(d.engine.meta.yields || {}).sort((a, b) => b[1].ratio - a[1].ratio).map(([s2, y]) => (
                <div key={s2} className="flex justify-between"><span className="text-b3">{s2}</span><span className="font-bold text-black">{y.rows} rows / {y.jobs} jobs · {Number(y.ratio).toFixed(2)}/job</span></div>
              ))}
            </div>
          </div>)}
        <div className="mt-4">
          <div className="text-meta-sm font-bold text-black mb-2">Download data (fetched on click)</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(d.crawls?.by_source || {}).filter(([, n]) => n > 0).map(([s2, n]) => (
              <button key={s2} onClick={() => fetchDl(`services:${s2}`)} className="rounded-xl bg-bg5 px-3 py-2 text-[12px] font-bold text-b3">
                ⬇ {s2} ({n.toLocaleString()})
              </button>))}
            {Object.entries(d.creatorsBySource || {}).filter(([, v]) => v.total > 0).map(([cs, v]) => (
              <button key={cs} onClick={() => fetchDl(`creators:${cs}`)} className="rounded-xl bg-bg5 px-3 py-2 text-[12px] font-bold text-b3">
                ⬇ {cs} ({v.total.toLocaleString()})
              </button>))}
          </div>
        </div>
      </>)}

      {d && tab === 'creators' && (
        <div className="mt-4">
          <div className="text-meta-sm font-bold text-black">Creator sources — every algorithm, with counts</div>
          <p className="text-[11px] text-b3 mt-1">A source at 0 is a FAILURE, not a blank. Cards, not a wide table, so no column is hidden off-screen.</p>
          {Object.keys(d.creatorsBySource || {}).length === 0 && (
            <div className="mt-3 rounded-xl bg-red-50 p-3 text-[12px] text-red-700">
              <b>No creator-source rows returned at all.</b> The endpoint that answered
              (<code>{d.served_by || 'unknown'}</code>) omitted <code>creatorsBySource</code> —
              a stale-deploy symptom, NOT "zero creators". Creators total reads{' '}
              <b>{(d.creators_total ?? d.crawls?.creators_total ?? 0).toLocaleString()}</b>.
            </div>)}
          <div className="mt-3 space-y-2">
            {Object.entries(d.creatorsBySource || {}).sort((a, b) => b[1].total - a[1].total).map(([cs, v]) => (
              <div key={cs} className={`rounded-xl border p-3 ${v.total === 0 ? 'border-red-200 bg-red-50' : 'border-bg5'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-meta-sm font-extrabold text-black break-all">{cs}</span>
                  <span className={`text-lg font-extrabold ${v.total === 0 ? 'text-red-600' : 'text-black'}`}>{v.total.toLocaleString()}</span>
                </div>
                <div className="mt-1 text-[11px] text-b3"><b>what:</b> {v.what || '—'}</div>
                <div className="text-[11px] text-b3"><b>where:</b> {v.where || '—'}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-b3">
                  <span>NYC <b className="text-black">{v.nyc.toLocaleString()}</b></span>
                  <span>Miami <b className="text-black">{v.miami.toLocaleString()}</b></span>
                  <span>email <b className="text-black">{v.withEmail.toLocaleString()}</b></span>
                  <span>followers <b className="text-black">{v.withFollowers.toLocaleString()}</b></span>
                  {v.total > 0 && <button onClick={() => fetchDl(`creators:${cs}`)} className="font-bold text-gd">⬇ csv</button>}
                </div>
              </div>))}
          </div>
          {d.creatorsUnattributed && Object.keys(d.creatorsUnattributed).length > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-[12px] text-amber-800">
              <b>{Object.values(d.creatorsUnattributed).reduce((a, b) => a + b, 0).toLocaleString()} creators sit under a
              discovered_via outside the listed algorithms</b> — NOT counted in the cards above:
              <div className="mt-1">{Object.entries(d.creatorsUnattributed).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <span key={k} className="mr-3 inline-block"><code>{k}</code> {n.toLocaleString()}</span>))}</div>
            </div>)}
        </div>)}

      {d && tab === 'qa' && (<>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Open bugs" value={d.qa.open_bugs} bad={d.qa.open_bugs > 0} />
          <Stat label="Findings tracked" value={d.qa.findings.length} />
          <Stat label="QA runs logged" value={d.qa.recent_runs.length} />
        </div>
        <div className="mt-4 rounded-xl border border-bg5 overflow-x-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Findings (bugs found → fixes confirmed)</div>
          <table className="w-full min-w-[480px] text-[12px]"><thead className="bg-bg5 text-b3"><tr>
            {['check','area','severity','status','detail','updated'].map(h => <th key={h} className="text-left px-2 py-1 font-bold">{h}</th>)}
          </tr></thead><tbody>
            {d.qa.findings.map((f, i) => (
              <tr key={i} className="border-t border-bg5">
                <td className="px-2 py-1 text-black">{f.check_name}</td><td className="px-2 py-1">{f.area}</td>
                <td className="px-2 py-1">{f.severity}</td>
                <td className={`px-2 py-1 font-bold ${f.status === 'open' ? 'text-red-600' : 'text-gd'}`}>{f.status}</td>
                <td className="px-2 py-1 truncate max-w-[260px]">{f.detail}</td>
                <td className="px-2 py-1 text-b3">{(f.updated_at || '').slice(0, 16)}</td>
              </tr>))}
          </tbody></table>
        </div>
        <div className="mt-4 rounded-xl border border-bg5 overflow-x-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Recent QA runs</div>
          <table className="w-full min-w-[480px] text-[12px]"><tbody>
            {d.qa.recent_runs.map((r, i) => (
              <tr key={i} className="border-t border-bg5">
                <td className="px-2 py-1 font-bold">{r.agent}</td>
                <td className={`px-2 py-1 font-bold ${r.status === 'ok' ? 'text-gd' : 'text-red-600'}`}>{r.status}</td>
                <td className="px-2 py-1">{r.rows_written}/{r.raw_found} passed</td>
                <td className="px-2 py-1 text-b3">{(r.started_at || '').slice(0, 16)}</td>
              </tr>))}
          </tbody></table>
        </div>
      </>)}

      {d && tab === 'agents' && (
        <div className="mt-4 rounded-xl border border-bg5 overflow-x-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Every agent — ON is proven by runs in the last 24h</div>
          <table className="w-full min-w-[480px] text-[12px]"><thead className="bg-bg5 text-b3"><tr>
            {['agent','state','runs 24h','last run','last status'].map(h => <th key={h} className="text-left px-2 py-1 font-bold">{h}</th>)}
          </tr></thead><tbody>
            {d.agents.map((a, i) => (
              <tr key={i} className="border-t border-bg5">
                <td className="px-2 py-1 font-bold text-black">{a.agent}</td>
                <td className={`px-2 py-1 font-extrabold ${a.live ? 'text-gd' : 'text-red-600'}`}>{a.live ? 'ON' : 'OFF'}</td>
                <td className="px-2 py-1">{a.runs24h}</td>
                <td className="px-2 py-1 text-b3">{(a.last_run || '—').slice(0, 16)}</td>
                <td className="px-2 py-1">{a.last_status || '—'}</td>
              </tr>))}
          </tbody></table>
        </div>)}

      {d && tab === 'crawls' && (<>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Services total" value={d.crawls.services_total?.toLocaleString()} />
          <Stat label="Creators total" value={d.crawls.creators_total?.toLocaleString()} />
          <Stat label="New services 24h" value={d.crawls.services_new_24h?.toLocaleString()} />
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-bg5 p-3">
            <div className="text-meta-sm font-bold text-black mb-2">Rows by source</div>
            {Object.entries(d.crawls.by_source).sort((a,b)=>b[1]-a[1]).map(([s,n]) => {
              const st = (d.crawls.source_states || {})[s];
              return (
                <div key={s} className="py-0.5">
                  <div className="flex justify-between text-meta-sm">
                    <span className="text-b3">{s}{st ? <b className="ml-1 uppercase text-amber-700">{st.state}</b> : null}</span>
                    <span className="font-bold text-black">{n.toLocaleString()}</span>
                  </div>
                  {st?.reason ? <div className="text-[10px] text-b3">{st.reason}</div> : null}
                </div>
              );
            })}
          </div>
          <div className="rounded-xl border border-bg5 p-3">
            <div className="text-meta-sm font-bold text-black mb-2">Job queue (source/status)</div>
            {Object.entries(d.crawls.job_stats).sort((a,b)=>b[1]-a[1]).map(([k,n]) => (
              <div key={k} className="flex justify-between text-meta-sm py-0.5"><span className="text-b3">{k}</span><span className="font-bold text-black">{n}</span></div>))}
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-bg5 overflow-x-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Recent crawl jobs</div>
          <table className="w-full min-w-[480px] text-[12px]"><tbody>
            {d.crawls.recent_jobs.map((j, i) => (
              <tr key={i} className="border-t border-bg5">
                <td className="px-2 py-1 font-bold">{j.source || 'osm'}</td><td className="px-2 py-1">{j.city}</td>
                <td className="px-2 py-1">{j.service_type}</td>
                <td className={`px-2 py-1 font-bold ${j.status === 'failed' ? 'text-red-600' : 'text-gd'}`}>{j.status}</td>
                <td className="px-2 py-1">{j.delivered_count ?? 0} rows</td>
                <td className="px-2 py-1 text-b3">{(j.updated_at || '').slice(0, 16)}</td>
              </tr>))}
          </tbody></table>
        </div>
      </>)}

      {d && (
        <p className="mt-4 text-[11px] text-b3">
          served by <code>{d.served_by || 'unknown'}</code> · generated {d.generated_at || '—'}
        </p>
      )}
      {d && tab === 'product' && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Profiles" value={d.product.profiles} />
          <Stat label="With avatar" value={d.product.with_avatar} bad={d.product.profiles > 0 && d.product.with_avatar === 0} />
          <Stat label="Connections" value={d.product.connections} bad={d.product.connections === 0} />
          <Stat label="Services listed" value={d.product.services} />
          <Stat label="Requests" value={d.product.requests} />
          <Stat label="Bookings" value={d.product.bookings} />
        </div>)}
    </div>
  );
}
