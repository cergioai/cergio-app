// Ops STATUS console (SPEC-94) — /ops/status. ONE page: QA tests/bugs, agents on-off,
// crawls per source, product/social-graph density. Everything proven by DATA.
import { useEffect, useState, useCallback } from 'react';
import { opsConsole } from '../lib/api';

const TABS = [
  { id: 'qa', label: 'QA & Bugs' },
  { id: 'agents', label: 'Agents' },
  { id: 'crawls', label: 'Crawls' },
  { id: 'product', label: 'Product data' },
];
function Stat({ label, value, bad }) {
  return (<div className="rounded-xl bg-bg5 px-3 py-2">
    <div className="text-[11px] text-b3 font-bold uppercase tracking-wide">{label}</div>
    <div className={`text-lg font-extrabold ${bad ? 'text-red-600' : 'text-black'}`}>{value ?? '—'}</div>
  </div>);
}
export function OpsStatusScreen() {
  const [tab, setTab] = useState('qa');
  const [d, setD] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await opsConsole(); setBusy(false);
    if (error || data?.error) { setErr(error?.message || data?.error); return; }
    setD(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-black">Ops console</h1>
        <button onClick={load} className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-b3">↻ Refresh</button>
      </div>
      <p className="text-meta-sm text-b3 mt-1">Live proof: what's running, what's broken, what's been crawled.</p>

      <div className="mt-4 flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-xl px-4 py-2 text-meta-sm font-bold ${tab === t.id ? 'bg-g text-white' : 'bg-bg5 text-b3'}`}>{t.label}</button>
        ))}
      </div>
      {busy && <div className="mt-4 text-b3">Loading…</div>}
      {err && <div className="mt-4 text-red-600 text-meta-sm">{err}</div>}

      {d && tab === 'qa' && (<>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Open bugs" value={d.qa.open_bugs} bad={d.qa.open_bugs > 0} />
          <Stat label="Findings tracked" value={d.qa.findings.length} />
          <Stat label="QA runs logged" value={d.qa.recent_runs.length} />
        </div>
        <div className="mt-4 rounded-xl border border-bg5 overflow-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Findings (bugs found → fixes confirmed)</div>
          <table className="w-full text-[12px]"><thead className="bg-bg5 text-b3"><tr>
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
        <div className="mt-4 rounded-xl border border-bg5 overflow-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Recent QA runs</div>
          <table className="w-full text-[12px]"><tbody>
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
        <div className="mt-4 rounded-xl border border-bg5 overflow-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Every agent — ON is proven by runs in the last 24h</div>
          <table className="w-full text-[12px]"><thead className="bg-bg5 text-b3"><tr>
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
            {Object.entries(d.crawls.by_source).sort((a,b)=>b[1]-a[1]).map(([s,n]) => (
              <div key={s} className="flex justify-between text-meta-sm py-0.5"><span className="text-b3">{s}</span><span className="font-bold text-black">{n.toLocaleString()}</span></div>))}
          </div>
          <div className="rounded-xl border border-bg5 p-3">
            <div className="text-meta-sm font-bold text-black mb-2">Job queue (source/status)</div>
            {Object.entries(d.crawls.job_stats).sort((a,b)=>b[1]-a[1]).map(([k,n]) => (
              <div key={k} className="flex justify-between text-meta-sm py-0.5"><span className="text-b3">{k}</span><span className="font-bold text-black">{n}</span></div>))}
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-bg5 overflow-auto">
          <div className="px-3 py-2 text-meta-sm font-bold text-black">Recent crawl jobs</div>
          <table className="w-full text-[12px]"><tbody>
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
