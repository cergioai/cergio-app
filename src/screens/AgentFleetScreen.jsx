// SPEC-220 — /ops/agents. Live CI subagent numbers, in the product, with a download.
// Founder: "need dashboard with live #'s and download a report of CI subagents... not github."
import { useCallback, useEffect, useState } from 'react';
import { ciSubagents } from '../lib/api';

const TONE = { 'GREEN': 'text-g', 'NEEDS WORK': 'text-black', 'CANNOT RUN': 'text-red-600', 'DID NOT RUN': 'text-red-600' };

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-bg5 px-3 py-2">
      <div className="text-[11px] text-b3 font-bold uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-extrabold ${tone || 'text-black'}`}>{value ?? '—'}</div>
    </div>
  );
}

export function AgentFleetScreen() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data, error } = await ciSubagents();
    setBusy(false);
    if (error) { setErr(error.message || 'Load failed'); return; }
    if (data?.error) { setErr(data.error); return; }
    setD(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const download = (rows, name) => {
    if (!rows?.length) { setErr('Nothing to download yet.'); return; }
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = keys.join(',') + '\n' + rows.map((r) => keys.map((k) => esc(r[k])).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };

  const s = d?.summary;
  const agents = d?.agents || [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-extrabold text-black">CI subagents</h1>
      <p className="text-meta-sm text-b3 mt-1">
        Live from the last run of each subagent. They run on CI every 3 hours — your Mac is never involved.
      </p>

      <div className="mt-4 flex gap-2 flex-wrap">
        <button onClick={load} className="rounded-xl bg-bg5 px-3 py-2 text-meta-sm font-bold text-b3">↻ Refresh</button>
        <button onClick={() => download(agents, 'Cergio CI subagents — latest.csv')} className="rounded-xl bg-g px-4 py-2 text-meta-sm font-bold text-white">Download report</button>
        <button onClick={() => download(d?.history, 'Cergio CI subagents — full history.csv')} className="rounded-xl bg-black px-4 py-2 text-meta-sm font-bold text-white">Download full history</button>
      </div>

      {busy && <div className="mt-4 text-b3">Loading…</div>}
      {err && <div className="mt-4 text-red-600 text-meta-sm">{err}</div>}

      {s && (
        <>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2">
            <Stat label="Green" value={`${s.green}/${s.total}`} tone={s.green === s.total ? 'text-g' : 'text-black'} />
            <Stat label="Needs work" value={s.needs_work} />
            {/* Not idle — unable to start. That distinction hid a dead agent for weeks. */}
            <Stat label="Cannot run" value={s.cannot_run} tone={s.cannot_run ? 'text-red-600' : 'text-b3'} />
            <Stat label="Open defects" value={s.defects} />
            <Stat label="Fixed 24h" value={s.fixed_24h} tone={s.fixed_24h ? 'text-g' : 'text-b3'} />
          </div>
          {d.last_run && <div className="mt-2 text-[11px] text-b3">Last run {new Date(d.last_run).toLocaleString()}</div>}

          <div className="mt-4 rounded-xl border border-bg5 overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-bg5 text-b3"><tr>
                {['agent', 'verdict', 'gates', 'defects', 'did', 'green when'].map((h) => <th key={h} className="text-left px-2 py-1 font-bold">{h}</th>)}
              </tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent} className="border-t border-bg5 align-top">
                    <td className="px-2 py-1 font-bold text-black">{a.agent}</td>
                    <td className={`px-2 py-1 font-bold ${TONE[a.verdict] || 'text-b3'}`}>{a.verdict}</td>
                    <td className="px-2 py-1 text-black">{a.gates_pass}/{a.gates_total}</td>
                    <td className="px-2 py-1 text-black">{a.defects}</td>
                    <td className="px-2 py-1 text-b3 max-w-[260px]">
                      {a.work_state === 'FIXED' ? <span className="text-g font-bold">fixed {a.file_changed}</span>
                        : a.work_state === 'ATTEMPTED' ? <span className="text-red-600">tried, reverted — {a.why_not}</span>
                        : a.work_state === 'CANNOT RUN' ? <span className="text-red-600">{String(a.why_not || '').slice(0, 120)}</span>
                        : (a.finding || '—')}
                    </td>
                    <td className="px-2 py-1 text-b3 max-w-[220px]">{a.green_when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!agents.length && <div className="px-3 py-3 text-meta-sm text-b3">No runs recorded yet — the fleet publishes after its next cycle.</div>}
          </div>
        </>
      )}
    </div>
  );
}
