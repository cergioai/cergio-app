// SPEC-63 — Admin → Crawls dashboard. Live view of the on-demand
// city-expansion pipeline: the queue, stalled/failed/empty crawls (with
// plain-English diagnosis), recent requests, and the leads funnel. Admin-only
// (the edge function re-checks server-side). Auto-refreshes every 60s.
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getAdminCrawlStatus, isAdminEmail } from '../lib/api';

function Stat({ label, value, tone = 'ink' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-g' : 'text-gray-900';
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function IssueCard({ title, rows, diagnosis, fix, tone }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'critical' ? 'border-red-300 bg-red-50' : tone === 'high' ? 'border-orange-300 bg-orange-50' : 'border-yellow-300 bg-yellow-50'}`}>
      <div className="font-semibold text-gray-900">{title} · {rows.length}</div>
      <div className="mt-1 text-sm text-gray-700"><b>What's wrong:</b> {diagnosis}</div>
      <div className="mt-1 text-sm text-gray-700"><b>Fix:</b> {fix}</div>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {rows.slice(0, 12).map((r) => (
          <li key={r.id}>• {r.city || '?'}{r.state ? `, ${r.state}` : ''} — {r.kind}/{r.service_type || 'any'}{r.notes ? ` — ${r.notes}` : ''}</li>
        ))}
      </ul>
    </div>
  );
}

export function AdminCrawlScreen() {
  const [email, setEmail] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await getAdminCrawlStatus();
    if (error) setErr(error.message || 'Failed to load');
    else { setData(data); setErr(null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    let timer;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const e = u?.user?.email || '';
      setEmail(e);
      if (isAdminEmail(e)) {
        await load();
        timer = setInterval(load, 60000); // auto-refresh
      } else {
        setLoading(false);
      }
    })();
    return () => timer && clearInterval(timer);
  }, [load]);

  if (!loading && email !== null && !isAdminEmail(email)) {
    return <div className="mx-auto max-w-md p-8 text-center text-gray-600">This page is for Cergio admins only.</div>;
  }

  const health = data?.health;
  const healthy = health?.ok;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Crawls — live status</h1>
        <button onClick={load} className="rounded-full bg-g px-4 py-1.5 text-sm font-medium text-white">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        On-demand city expansion. Auto-refreshes every 60s.{data?.checked_at ? ` Last: ${new Date(data.checked_at).toLocaleTimeString()}` : ''}
      </p>

      {err && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      {data && (
        <>
          <div className={`mt-4 rounded-2xl p-4 text-sm font-medium ${healthy ? 'bg-gl text-gd' : 'bg-red-50 text-red-700'}`}>
            {healthy
              ? '✅ Pipeline healthy — no stalled, failed, or empty crawls.'
              : `🚨 Needs attention — ${health.stalled} stalled · ${health.failed} failed · ${health.empty} empty.`}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Stalled" value={health.stalled} tone={health.stalled ? 'bad' : 'good'} />
            <Stat label="Failed" value={health.failed} tone={health.failed ? 'bad' : 'good'} />
            <Stat label="Empty" value={health.empty} tone={health.empty ? 'bad' : 'good'} />
          </div>

          <div className="mt-5 space-y-3">
            <IssueCard title="STALLED — crawler not picking these up" rows={data.stalled} tone="critical"
              diagnosis={`Open for more than ${data.stale_hours}h. Users in these locations are getting no results.`}
              fix="Confirm the crawler service is running and polling crawl_requests WHERE status='new'." />
            <IssueCard title="FAILED — crawler errored" rows={data.failed} tone="high"
              diagnosis="The crawler reported an error on these requests." fix="Read each row's notes; set status='new' to re-queue after fixing." />
            <IssueCard title="EMPTY — delivered zero leads" rows={data.empty} tone="medium"
              diagnosis="Crawler ran but found nothing for that city/type." fix="Widen radius, broaden the service_type mapping, or check source coverage." />
          </div>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Queue by status</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(data.queue_by_status || {}).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
                <span className="text-gray-500">{k}</span> <span className="font-semibold text-gray-900">{v}</span>
              </div>
            ))}
            {Object.keys(data.queue_by_status || {}).length === 0 && <div className="text-sm text-gray-500">No crawl requests yet.</div>}
          </div>

          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Recent requests</h2>
          <div className="mt-2 overflow-hidden rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg5 text-gray-500">
                <tr><th className="px-3 py-2">City</th><th className="px-3 py-2">Kind/Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Got/Want</th><th className="px-3 py-2">When</th></tr>
              </thead>
              <tbody>
                {(data.recent || []).map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-3 py-2">{r.city || '?'}{r.state ? `, ${r.state}` : ''}</td>
                    <td className="px-3 py-2">{r.kind}/{r.service_type || 'any'}</td>
                    <td className="px-3 py-2">
                      <span className={r.status === 'delivered' ? 'text-g' : r.status === 'failed' ? 'text-red-600' : 'text-gray-700'}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2">{r.delivered_count}/{r.target_count}</td>
                    <td className="px-3 py-2 text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {(data.recent || []).length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">No requests yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {Array.isArray(data.funnel) && data.funnel.length > 0 && (
            <>
              <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">Leads funnel</h2>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.funnel.map((f, i) => (
                  <div key={i} className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
                    <div className="font-semibold text-gray-900">{f.kind}</div>
                    <div className="text-gray-500">{f.total_leads} leads · {f.touched} messaged</div>
                    <div className="text-gray-500">{f.invited} invited · {f.signed_up} joined</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default AdminCrawlScreen;
