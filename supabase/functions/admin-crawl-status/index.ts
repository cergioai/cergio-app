// Supabase Edge Function — SPEC-63 admin crawl dashboard data.
//
// Returns the full crawl + outreach picture for the in-app Admin → Crawls page.
// AUTH: the CALLER must be a signed-in admin (their JWT email must be in the
// allowlist). We verify the caller with the anon client (their token), then use
// the service-role client to read across RLS for the aggregates. This keeps
// crawl_requests/leads RLS intact for everyone else.
//
// Admins: ADMIN_EMAILS env (comma-separated) or the built-in default.
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { buildOpsPayload, isAdminEmail } from '../_shared/opsPayload.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};


serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ── Verify caller is an admin ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const supaUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await supaUser.auth.getUser();
    const email = (u?.user?.email || '').toLowerCase();
    if (!isAdminEmail(email, Deno.env.get('ADMIN_EMAILS'))) return json({ error: 'Forbidden', signed_in_as: email || null, hint: 'this email is not in the ops allowlist' }, 403);

    const db = createClient(supabaseUrl, serviceKey);

    // ── SPEC-104: serve the OPS CONSOLE payload from here too ────────────────
    // `ops-console` is absent from the CI deploy array and that workflow file
    // cannot be pushed off-Mac (PAT lacks `workflow` scope), so ops fixes never
    // reached prod. This function IS CI-deployed, so /ops/status falls back here
    // and every future ops change ships automatically.
    let reqBody: Record<string, unknown> = {};
    try { reqBody = await req.clone().json(); } catch (_e) { reqBody = {}; }
    if (reqBody.view === 'ops') {
      const payload = await buildOpsPayload(db, reqBody);
      return json({ ...payload, served_by: 'admin-crawl-status' });
    }

    const staleHours = Number(Deno.env.get('CRAWL_STALE_HOURS') || '2');
    const sinceIso = new Date(Date.now() - staleHours * 3600 * 1000).toISOString();

    const [{ data: queue }, { data: recent }, { data: stalled }, { data: failed }, { data: empty }] =
      await Promise.all([
        db.from('crawl_requests').select('kind, status').limit(5000),
        db.from('crawl_requests').select('id, kind, city, state, service_type, status, target_count, delivered_count, created_at, updated_at')
          .order('created_at', { ascending: false }).limit(40),
        db.from('crawl_requests').select('id, kind, city, service_type, status, created_at')
          .in('status', ['new', 'crawling']).lt('created_at', sinceIso).order('created_at', { ascending: true }).limit(100),
        db.from('crawl_requests').select('id, kind, city, service_type, notes, updated_at').eq('status', 'failed').limit(100),
        db.from('crawl_requests').select('id, kind, city, service_type, updated_at').eq('status', 'delivered').eq('delivered_count', 0).limit(100),
      ]);

    const byStatus: Record<string, number> = {};
    for (const r of queue ?? []) { const k = `${r.kind}/${r.status}`; byStatus[k] = (byStatus[k] ?? 0) + 1; }

    // Leads funnel (best-effort; tables may be empty).
    let funnel: unknown = null;
    try { const { data } = await db.from('leads_conversion_funnel').select('*'); funnel = data; } catch { funnel = null; }

    const health = {
      stalled: (stalled ?? []).length,
      failed:  (failed ?? []).length,
      empty:   (empty ?? []).length,
      ok: !((stalled ?? []).length || (failed ?? []).length || (empty ?? []).length),
    };

    return json({
      checked_at: new Date().toISOString(),
      stale_hours: staleHours,
      health,
      queue_by_status: byStatus,
      recent: recent ?? [],
      stalled: stalled ?? [],
      failed: failed ?? [],
      empty: empty ?? [],
      funnel,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
