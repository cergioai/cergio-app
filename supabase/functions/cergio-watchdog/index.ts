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

    // ── STALENESS ESCALATION ───────────────────────────────────────────────────
    // The gap that let enrich-influencers sit SILENT for 5 days and a QA regression
    // sit red for days: a finding could be opened, re-opened, re-opened… forever,
    // and nothing ever changed. Detection without escalation is just a nicer way to
    // be blind. So: any finding still OPEN after ESCALATE_AFTER_HOURS with no fix
    // is (1) bumped to severity 'critical' and (2) written as a needs-approval
    // coo_proposal that NAMES it as a stale unfixed defect. `escalated_at` is
    // stamped so it can never re-escalate in a loop; cergio_qa_check clears it when
    // the finding is genuinely fixed, so a NEW occurrence can escalate again.
    // Reversible + read-mostly: it never fixes anything itself and never sends.
    const ESCALATE_AFTER_HOURS = Math.max(1, Number(Deno.env.get('QA_ESCALATE_AFTER_HOURS') || '12'));
    const escalated: any[] = [];
    let escalationError: string | null = null;
    try {
      const cutoff = new Date(Date.now() - ESCALATE_AFTER_HOURS * 3600_000).toISOString();
      const { data: stale, error: sErr } = await db
        .from('qa_findings')
        .select('id, area, check_name, severity, detail, found_at, escalated_at, status')
        .eq('status', 'open')
        .is('escalated_at', null)
        .lt('found_at', cutoff)
        .order('found_at', { ascending: true })
        .limit(10);   // cap per heartbeat so an outage can't flood the founder's list
      if (sErr) throw sErr;

      for (const f of stale ?? []) {
        const hours = Math.max(0, Math.floor((Date.now() - new Date(f.found_at).getTime()) / 3600_000));
        // STABLE title → the dedupe below (and the founder's list) never duplicates.
        const title = `STALE DEFECT: ${f.check_name} — open > ${ESCALATE_AFTER_HOURS}h with no fix`;

        // Was anything even ATTEMPTED? qa-suite writes 'Auto-fix: <check>' proposals
        // for the auto-fixable class; say so plainly either way.
        let attempted = 'none — no auto-fix proposal was ever written for this check';
        try {
          const { data: fix } = await db.from('coo_proposals')
            .select('id, status, result, executed_at')
            .eq('title', `Auto-fix: ${f.check_name}`)
            .order('id', { ascending: false }).limit(1).maybeSingle();
          if (fix) {
            attempted = `auto-fix proposal #${fix.id} is '${fix.status}'` +
              (fix.result ? ` — last result: ${String(fix.result).slice(0, 200)}` : '') +
              (fix.status === 'executed' ? ' (it ran and the finding STILL did not clear)' : '');
          }
        } catch (_e) { /* diagnostic only */ }

        const detail = [
          `${f.check_name} (area '${f.area}', severity '${f.severity}') has been OPEN for ${hours}h `,
          `(since ${String(f.found_at).slice(0, 16)}) and is still failing.`,
          `\nFINDING: ${String(f.detail || '').slice(0, 400)}`,
          `\nFIX ATTEMPTED: ${attempted}.`,
          `\nThis is an UNFIXED DEFECT, not a new idea — it needs an engineering fix, `,
          `not an approval to run something. Escalated automatically after ${ESCALATE_AFTER_HOURS}h.`,
        ].join('');

        // Write the escalation FIRST; only stamp escalated_at if it landed — a lost
        // proposal must not silently consume the one escalation this finding gets.
        const ok = await upsertProposal(db, title, detail.slice(0, 1800));
        if (!ok) continue;

        const { error: uErr } = await db.from('qa_findings')
          .update({ severity: 'critical', escalated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', f.id).eq('status', 'open');
        escalated.push({ check: f.check_name, hours, stamped: !uErr, error: uErr ? serr(uErr) : null });
      }
    } catch (e) {
      // Most likely cause: migration 20260713000000 (qa_findings.escalated_at) not
      // applied yet. Surface it — never swallow the monitor's own breakage.
      escalationError = serr(e);
    }

    // Log the watchdog's own run so IT can never silently die either.
    try {
      await db.from('agent_runs').insert({
        agent: 'cergio-watchdog',
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        raw_found: (rows ?? []).length,
        rows_written: findings.length,
        status: escalationError ? 'error' : 'ok',
        error: escalationError ? `staleness escalation unavailable: ${escalationError}` : null,
        meta: {
          open_findings: findings.length,
          escalate_after_hours: ESCALATE_AFTER_HOURS,
          escalated: escalated.length, escalations: escalated,
        },
      });
    } catch (_e) { /* best-effort */ }

    return j({
      ok: true, checked: (rows ?? []).length, open_findings: findings.length, findings,
      escalate_after_hours: ESCALATE_AFTER_HOURS, escalated, escalation_error: escalationError,
      ms: Date.now() - started,
    });
  } catch (e) {
    return j({ error: serr(e), ms: Date.now() - started }, 500);
  }
});

// Write a needs-approval COO proposal, idempotently (same contract the
// orchestrator uses): skip if an identical-title proposal is already pending.
// requires_approval=true + on_spec=false + action_kind='none' means coo-execute
// will NEVER auto-run it — it only surfaces on the founder's approve list.
// Returns true if a NEW proposal was created (or one already exists and is open —
// in which case the finding is already escalated and must still be stamped).
// NEVER throws.
async function upsertProposal(db: any, title: string, detail: string): Promise<boolean> {
  try {
    const { data: existing } = await db
      .from('coo_proposals')
      .select('id')
      .eq('title', title)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    if (existing) return true;   // already on the founder's list — don't duplicate

    const { error } = await db.from('coo_proposals').insert({
      division: 'qa',
      title,
      detail,
      expected_lift: 'closes a defect the loop has been carrying unfixed',
      effort: 'engineering',
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

// ── CANONICAL ERROR SERIALIZER — DO NOT FORK ─────────────────────────────────
// Supabase/PostgREST rejects with a PLAIN OBJECT ({message, details, hint, code}),
// NOT an Error. `String(e)` on that object yields the opaque "[object Object]" —
// which is exactly how 11/11 failed autonomous actions recorded an unreadable
// `result` and the loop went blind (Forensic Auditor 2026-07-13). Always extract a
// REAL message + code (+ 2 stack frames) so every failure is diagnosable.
// qa.mjs #73 asserts every copy of this helper is byte-identical, unit-tests it
// against a PostgREST-shaped rejection, and fails the push if it can ever emit
// "[object Object]".
function serr(e: unknown): string {
  if (e === null || e === undefined) return 'unknown error (null)';
  if (typeof e === 'string') return e || 'unknown error (empty string)';
  const o = e as any;
  const msg = (e instanceof Error ? e.message : null)
    || o?.message || o?.error?.message || o?.error_description || o?.msg
    || o?.details || o?.hint || null;
  const code = o?.code ?? o?.error?.code ?? o?.status ?? o?.statusCode ?? null;
  const parts: string[] = [];
  if (msg) parts.push(String(msg));
  if (code !== null && code !== undefined && String(code) !== '') parts.push('[' + String(code) + ']');
  if (o?.details && String(o.details) !== String(msg)) parts.push('- ' + String(o.details));
  if (o?.hint && String(o.hint) !== String(msg)) parts.push('(hint: ' + String(o.hint) + ')');
  if (parts.length === 0) {
    let dump = '';
    try { dump = JSON.stringify(e); } catch (_j) { dump = ''; }
    parts.push(dump && dump !== '{}' ? dump : 'unhandled ' + (typeof e) + ' thrown with no message/code/details fields');
  }
  if (e instanceof Error && e.stack) {
    const frames = String(e.stack).split('\n').slice(1, 3).map((s) => s.trim()).filter(Boolean).join(' <- ');
    if (frames) parts.push('| ' + frames);
  }
  return parts.join(' ').trim().slice(0, 900);
}
