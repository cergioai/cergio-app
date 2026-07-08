// Supabase Edge Function — live OPS metrics for the Cergio Terminal.
// Public, read-only, NO PII (aggregate counts + engine status + COO proposals).
// The terminal HTML polls this every ~20s → a live view with zero Mac.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await db.rpc('cergio_ops_snapshot');
    if (error) throw error;
    const snap: any = (data && typeof data === 'object') ? data : {};

    // ── BACKBONE: single top-line ORG HEALTH + per-agent health ─────────────────
    // Merged in at read time (rather than baking it into the large snapshot fn,
    // which lives in a launcher) so the dashboard always shows one clear status —
    // green / degraded / down — plus every agent's delta vs spec. Best-effort:
    // if the fn isn't deployed yet, the snapshot still serves without it.
    try {
      const { data: oh } = await db.rpc('cergio_org_health');
      if (oh && typeof oh === 'object') snap.org_health = oh;
    } catch (_e) { /* additive; never break the snapshot on this */ }

    // ── Autonomous-execution split ────────────────────────────────────────────
    // Founder should SEE progress (things the COO already did) separately from a
    // to-do list. So we split proposals into:
    //   executed_autonomously — what the executor ran, with the result
    //   needs_approval        — the ONLY items awaiting the founder's word
    // Both are additive; the legacy `proposals` key is left intact.

    // Recently executed (last 3 days), newest first — the "done" feed.
    const { data: doneRows } = await db
      .from('coo_proposals')
      .select('id, division, title, detail, action_kind, action_payload, result, executed_at, status')
      .eq('status', 'executed')
      .gte('executed_at', new Date(Date.now() - 3 * 864e5).toISOString())
      .order('executed_at', { ascending: false })
      .limit(25);

    // Recent failures — surfaced so a false-success can never hide (project history).
    const { data: failRows } = await db
      .from('coo_proposals')
      .select('id, division, title, result, executed_at')
      .eq('status', 'failed')
      .gte('executed_at', new Date(Date.now() - 3 * 864e5).toISOString())
      .order('executed_at', { ascending: false })
      .limit(15);

    // Only requires_approval=true, still pending → the founder's approve list.
    const { data: needRows } = await db
      .from('coo_proposals')
      .select('id, rank, division, title, detail, expected_lift, effort, on_spec, action_kind')
      .eq('status', 'pending')
      .eq('requires_approval', true)
      .gte('run_date', new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10))
      .order('rank', { ascending: true })
      .limit(25);

    snap.executed_autonomously = (doneRows ?? []).map((r: any) => ({
      id: r.id, division: r.division, title: r.title, detail: r.detail,
      action_kind: r.action_kind, action_payload: r.action_payload,
      result: r.result, executed_at: r.executed_at,
    }));
    snap.execution_failures = failRows ?? [];
    snap.needs_approval = (needRows ?? []).map((r: any) => ({
      id: r.id, rank: r.rank, division: r.division, title: r.title, detail: r.detail,
      lift: r.expected_lift, effort: r.effort, on_spec: r.on_spec, action_kind: r.action_kind,
    }));
    snap.execution_summary = {
      executed_recent: (doneRows ?? []).length,
      failed_recent: (failRows ?? []).length,
      awaiting_approval: (needRows ?? []).length,
    };

    return new Response(JSON.stringify(snap), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
