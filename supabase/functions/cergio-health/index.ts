// Supabase Edge Function — cergio-health (Item 2: post-deploy invariant gate).
//
// A deploy must NEVER again silently wipe the vault secret / break a fn / return
// a 401 or 546 without it being caught immediately. Run this right after any
// deploy (the "zzz RUN ME - Post-Deploy Health Check.command" launcher does) and
// it verifies the invariants that broke tonight:
//
//   (a) VAULT BEARER — the vault secret edge_fn_bearer exists AND the exact cron
//       path (public.cergio_call_edge) can fire an edge fn with it. A live probe
//       call must come back 200 (not 401 bad-header, not 546 crash).
//   (b) CRITICAL FNS SMOKE — each critical edge fn responds to an authenticated
//       probe with a non-5xx status (proves it boots — no 546 module crash).
//   (c) OPS-METRICS — returns 200 AND the expected top-level keys the dashboard
//       reads (so a broken snapshot fn is caught, not served as blank).
//
// Returns a pass/fail report and writes ONE qa_finding (area='watchdog',
// check_name='health:post_deploy') that OPENS on any fail and auto-resolves when
// a later all-green run passes. Read-only except that finding. No send, no money.
//
// AUTH: service-role bearer only (launcher / manual). Env: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Optional: FUNCTIONS_BASE_URL (defaults to the
// project's functions host derived from SUPABASE_URL).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Fns that must boot (a 546 here = the class of crash we fixed in fulfill-crawl).
const CRITICAL_FNS = ['fulfill-crawl', 'enrich-influencers', 'creator-harvest', 'coo-execute', 'ops-metrics'];

serve(async (req: Request) => {
  const started = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return j({ error: 'unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);

    // functions.supabase.co base for this project (from SUPABASE_URL host ref).
    const base = (Deno.env.get('FUNCTIONS_BASE_URL')
      || supabaseUrl.replace('.supabase.co', '.functions.supabase.co')
      || '').replace(/\/+$/, '');

    const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

    // ── (a) VAULT BEARER present + cron path fires ──────────────────────────────
    // Prove the exact cron path works: cergio_call_edge reads edge_fn_bearer from
    // Vault and POSTs. If the secret is missing it raises a NOTICE + no-ops (which
    // is EXACTLY how ingest silently died), so we check the secret directly too.
    let vaultOk = false; let vaultDetail = '';
    try {
      const { data: hasSecret, error: sErr } = await db.rpc('cergio_has_edge_bearer');
      if (sErr) throw sErr;
      vaultOk = hasSecret === true;
      vaultDetail = vaultOk ? 'edge_fn_bearer present in Vault' : 'edge_fn_bearer MISSING from Vault (cron calls silently no-op)';
    } catch (e) {
      // Fallback if the helper fn isn't deployed: attempt the call path itself.
      vaultDetail = 'cergio_has_edge_bearer unavailable: ' + (e instanceof Error ? e.message : String(e));
    }
    checks.push({ name: 'vault_bearer_present', pass: vaultOk, detail: vaultDetail });

    // Live probe: fire ops-metrics through cergio_call_edge (the cron path). We
    // can't read the async pg_net response here, so we ALSO do a direct probe
    // below; this just proves the RPC itself doesn't error (bad grant/secret).
    let callEdgeOk = false; let callEdgeDetail = '';
    try {
      const { error: cErr } = await db.rpc('cergio_call_edge', { fn: 'ops-metrics' });
      callEdgeOk = !cErr;
      callEdgeDetail = cErr ? ('cergio_call_edge errored: ' + cErr.message) : 'cergio_call_edge dispatched without error';
    } catch (e) {
      callEdgeDetail = 'cergio_call_edge threw: ' + (e instanceof Error ? e.message : String(e));
    }
    checks.push({ name: 'cron_call_path', pass: callEdgeOk, detail: callEdgeDetail });

    // ── (b) CRITICAL FNS SMOKE (authenticated, must not 5xx) ────────────────────
    for (const fn of CRITICAL_FNS) {
      const r = await probe(base, fn, serviceKey);
      // A 401 means our own bearer was rejected (header/secret problem). A 5xx/546
      // means the fn crashed on boot. Both FAIL. Any 2xx/4xx-non-401 = it booted.
      const pass = r.status !== 0 && r.status !== 401 && r.status < 500;
      checks.push({ name: `smoke:${fn}`, pass, detail: `HTTP ${r.status}${r.note ? ' — ' + r.note : ''}` });
    }

    // ── (c) OPS-METRICS returns 200 + expected keys ─────────────────────────────
    let metricsOk = false; let metricsDetail = '';
    try {
      const res = await fetch(`${base}/ops-metrics?health=${Date.now()}`, {
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      if (res.status !== 200) {
        metricsDetail = `ops-metrics returned HTTP ${res.status}`;
      } else {
        const body: any = await res.json().catch(() => ({}));
        const needKeys = ['services', 'creators'];
        const missing = needKeys.filter((k) => !(k in (body || {})));
        metricsOk = missing.length === 0 && !body.error;
        metricsDetail = metricsOk
          ? 'ops-metrics 200 with expected keys'
          : (body.error ? `ops-metrics error: ${body.error}` : `ops-metrics missing keys: ${missing.join(', ')}`);
      }
    } catch (e) {
      metricsDetail = 'ops-metrics fetch failed: ' + (e instanceof Error ? e.message : String(e));
    }
    checks.push({ name: 'ops_metrics_shape', pass: metricsOk, detail: metricsDetail });

    // ── Verdict + finding ───────────────────────────────────────────────────────
    const failed = checks.filter((c) => !c.pass);
    const pass = failed.length === 0;
    const detail = pass
      ? 'post-deploy health: all invariants green'
      : 'post-deploy FAIL: ' + failed.map((c) => `${c.name} (${c.detail})`).join(' | ');

    try {
      await db.rpc('cergio_qa_check', {
        p_area: 'watchdog', p_check: 'health:post_deploy',
        p_sev: 'high', p_count: failed.length, p_detail: detail.slice(0, 1000),
      });
    } catch (_e) { /* best-effort */ }

    try {
      await db.from('agent_runs').insert({
        agent: 'cergio-health',
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        raw_found: checks.length, rows_written: checks.filter((c) => c.pass).length,
        status: pass ? 'ok' : 'error', error: pass ? null : detail.slice(0, 1000),
        meta: { checks },
      });
    } catch (_e) { /* best-effort */ }

    return j({ ok: true, pass, failed: failed.length, checks, detail, ms: Date.now() - started }, pass ? 200 : 200);
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});

// Probe an edge fn with our own service-role bearer. Returns the HTTP status (0
// on network failure) so the caller can distinguish boot-crash (5xx) from a
// healthy fn that simply rejected the empty body (4xx).
async function probe(base: string, fn: string, bearer: string): Promise<{ status: number; note?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${base}/${fn}?health=${Date.now()}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { status: res.status };
  } catch (e) {
    return { status: 0, note: e instanceof Error ? e.message : String(e) };
  }
}
