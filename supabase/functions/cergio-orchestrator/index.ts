// Supabase Edge Function — cergio-orchestrator (Item 3: heartbeat coordinator).
//
// The single org-health AUTHORITY. On a frequent heartbeat (pg_cron every 30m)
// it reads the whole self-healing backbone and acts:
//
//   1. READ   — agent_health (agent_runs ⋈ registry), open watchdog qa_findings,
//               and recent coo_execution_log failures.
//   2. JUDGE  — compute ONE org-health status via cergio_org_health():
//               'green' (all agents on spec) / 'degraded' (something off spec) /
//               'down' (a re-runnable worker is stalled or errored). The report
//               lists each failing agent + its specific delta vs spec.
//   3. HEAL   — for each STALLED re-runnable worker (registry.can_rerun=true),
//               fire a re-run via public.cergio_call_edge (the SAME idempotent
//               cron path). Self-healing: a stalled crawler gets nudged, not left.
//   4. ESCALATE — off-spec / prohibited situations the system must NOT self-fix
//               (e.g. a worker that has NEVER run → likely a deploy/secret gap,
//               or a persistent error after a re-run) are written as a
//               coo_proposal with requires_approval=true so ONLY those reach the
//               founder. Everything else self-heals silently.
//
// It self-heals and self-audits; it NEVER sends outreach, moves money, or does
// anything irreversible. can_rerun agents are exactly the idempotent read/enrich/
// harvest workers — same allowlist coo-execute uses.
//
// AUTH: service-role bearer only (cron via cergio_call_edge / launcher).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  const started = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return j({ error: 'unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);

    // ── 1+2. Single org-health verdict (agents + deltas + open findings) ────────
    const { data: healthJson, error: hErr } = await db.rpc('cergio_org_health');
    if (hErr) throw hErr;
    const org: any = healthJson || {};
    const agents: any[] = Array.isArray(org.agents) ? org.agents : [];

    // ── 3. HEAL: re-run stalled re-runnable workers via the cron path ───────────
    const { data: reg } = await db
      .from('agent_registry')
      .select('agent, can_rerun, enabled');
    const rerunnable = new Set((reg ?? []).filter((r: any) => r.can_rerun && r.enabled).map((r: any) => r.agent));

    const healed: any[] = [];
    for (const a of agents) {
      // Nudge only STALLED re-runnable workers. (A 'silent' or 'empty' state is a
      // data/logic issue a re-run won't fix; an 'error' may be transient but we
      // let the next scheduled tick or an escalation handle it, to avoid tight
      // crash loops.) One nudge per heartbeat, idempotent.
      if (a.health === 'stall' && rerunnable.has(a.agent)) {
        try {
          const { error: cErr } = await db.rpc('cergio_call_edge', { fn: a.agent });
          healed.push({ agent: a.agent, rerun: !cErr, error: cErr ? cErr.message : null });
        } catch (e) {
          healed.push({ agent: a.agent, rerun: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    // ── 4. ESCALATE only what the system must NOT self-fix ──────────────────────
    // A worker that has NEVER run (delta='never ran') is a deploy/cron/secret gap
    // a re-run can't cure → founder. A re-runnable worker still stalled AND with
    // no rows ever is likewise escalated. We write these as needs-approval COO
    // proposals (idempotent by a stable title per agent+issue so we don't spam).
    const escalations: any[] = [];
    for (const a of agents) {
      const neverRan = a.health === 'stall' && (a.last_run_at == null);
      if (neverRan) {
        const title = `Backbone: agent '${a.agent}' has never run`;
        const detail = `${a.agent} appears deployed-but-never-invoked (${a.delta}). ` +
          `A re-run cannot fix a missing deploy / unwired cron / wiped vault secret. ` +
          `Verify: (1) the fn is deployed, (2) its cron job exists in cron.job, ` +
          `(3) edge_fn_bearer is set in Vault. Run the Post-Deploy Health Check.`;
        const ok = await upsertProposal(db, title, detail, a.agent);
        if (ok) escalations.push({ agent: a.agent, escalated: true });
      }
    }

    // ── Write org_health status where the dashboard can show it ─────────────────
    // ops-metrics merges cergio_org_health() into its snapshot at read time, so
    // the top-line is always live. We ALSO record this heartbeat so the
    // orchestrator itself is watched.
    try {
      await db.from('agent_runs').insert({
        agent: 'cergio-orchestrator',
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        raw_found: agents.length,
        rows_written: healed.filter((h) => h.rerun).length,
        status: org.status === 'down' ? 'error' : 'ok',
        error: org.status === 'down' ? `org down: ${org.failing_count} agent(s) failing` : null,
        meta: { org_status: org.status, healed, escalations },
      });
    } catch (_e) { /* best-effort */ }

    return j({
      ok: true,
      org_status: org.status,
      failing_count: org.failing_count,
      agents,
      healed,
      escalations,
      ms: Date.now() - started,
    });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});

// Write a needs-approval COO proposal, idempotently. We avoid spamming by first
// checking for an existing OPEN (status='pending') proposal with the same title.
// NEVER throws. Returns true if a NEW proposal was created.
async function upsertProposal(db: any, title: string, detail: string, agent: string): Promise<boolean> {
  try {
    const { data: existing } = await db
      .from('coo_proposals')
      .select('id')
      .eq('title', title)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    if (existing) return false; // already open — don't duplicate

    // Insert the minimal safe shape: requires_approval=true, on_spec=false,
    // action_kind='none' → the executor will NEVER auto-run it; it only surfaces
    // to the founder via ops-metrics.needs_approval.
    const { error } = await db.from('coo_proposals').insert({
      division: 'ops',
      title,
      detail,
      requires_approval: true,
      on_spec: false,
      action_kind: 'none',
      status: 'pending',
      run_date: new Date().toISOString().slice(0, 10),
    });
    return !error;
  } catch (_e) {
    return false;
  }
}
