// Supabase Edge Function — cergio-watchdog (Item 1: delivery-verification).
//
// The core anti-"green-but-false" mechanism. Every failure tonight was the same
// class: "cron reported succeeded but nothing moved" (wiped vault secret, 401
// from a bad header, a 546 fn crash, harvest upserting 0). This watchdog makes
// that class impossible to HIDE, by reading the unified agent_runs ledger and
// opening a qa_finding whenever, for any expected agent:
//   • SILENT   — latest run had raw_found>0 AND rows_written=0 (found data, wrote
//                nothing → a collision / bad upsert masquerading as success)
//   • ERROR    — latest run status='error' (crash / 401 / 546 surfaced as error)
//   • STALL    — no run inside the agent's expected window (crawler stopped /
//                cron not firing / secret wiped so cergio_call_edge no-ops)
//
// It RESOLVES a finding automatically when a later good run appears (cergio_qa_check
// flips status→'fixed' when the passed count is 0). Findings live in qa_findings
// with area='watchdog', one row per agent+problem (check_name unique).
//
// Reads the DB view agent_health (agent_registry ⋈ latest agent_runs) so the
// stall window is data-driven, not hard-coded here. Pure read + qa_findings
// writes — reversible, no destructive change, no send, no money.
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

    // agent_health = one row per expected+enabled agent with a computed verdict.
    const { data: rows, error } = await db
      .from('agent_health')
      .select('agent, health, last_run_at, raw_found, rows_written, last_status, last_error, max_gap_minutes');
    if (error) throw error;

    const findings: any[] = [];
    for (const r of rows ?? []) {
      const agent = String(r.agent);
      const health = String(r.health);

      // For each agent we own ONE check_name per problem-class. cergio_qa_check
      // opens it when count>0 and auto-resolves (status='fixed') when count=0 —
      // so calling with 0 on a healthy agent CLEARS a prior finding. We therefore
      // call all three checks for every agent, with the right count.
      const isStall  = health === 'stall'  ? 1 : 0;
      const isError  = health === 'error'  ? 1 : 0;
      const isSilent = health === 'silent' ? 1 : 0;

      await qaCheck(db, `watchdog:stall:${agent}`, isStall ? 'high' : 'low', isStall,
        isStall
          ? (r.last_run_at
              ? `${agent}: no run in ${r.max_gap_minutes}m (last ${r.last_run_at}) — worker stalled / cron not firing / vault secret wiped`
              : `${agent}: has NEVER run — deploy or cron not wired`)
          : `${agent}: running within its ${r.max_gap_minutes}m window`);

      await qaCheck(db, `watchdog:error:${agent}`, isError ? 'high' : 'low', isError,
        isError
          ? `${agent}: last run errored — ${String(r.last_error || 'unknown').slice(0, 200)}`
          : `${agent}: last run did not error`);

      await qaCheck(db, `watchdog:silent:${agent}`, isSilent ? 'high' : 'low', isSilent,
        isSilent
          ? `${agent}: SILENT COLLISION — found ${r.raw_found ?? 0} but wrote 0 rows (upsert/insert masking a no-op as success)`
          : `${agent}: writes match discovery`);

      if (isStall || isError || isSilent) {
        findings.push({ agent, health, raw_found: r.raw_found, rows_written: r.rows_written });
      }
    }

    // Log the watchdog's own run so IT can never silently die either.
    try {
      await db.from('agent_runs').insert({
        agent: 'cergio-watchdog',
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        raw_found: (rows ?? []).length,
        rows_written: findings.length,
        status: 'ok',
        meta: { open_findings: findings.length },
      });
    } catch (_e) { /* best-effort */ }

    return j({ ok: true, checked: (rows ?? []).length, open_findings: findings.length, findings, ms: Date.now() - started });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});

// Idempotent open-or-resolve of ONE finding, keyed by check_name (unique).
// count>0 opens/updates; count=0 flips a prior open finding to 'fixed'. NEVER
// throws (a monitoring write must never crash the monitor).
async function qaCheck(db: any, checkName: string, severity: string, count: number, detail: string): Promise<void> {
  try {
    await db.rpc('cergio_qa_check', {
      p_area: 'watchdog', p_check: checkName, p_sev: severity, p_count: count, p_detail: detail,
    });
  } catch (_e) { /* best-effort */ }
}
