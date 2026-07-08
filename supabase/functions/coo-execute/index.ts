// Supabase Edge Function — the autonomous COO's EXECUTION hand.
//
// Picks up on-spec + reversible proposals (requires_approval=false, status='pending')
// that coo-brain wrote, RE-VERIFIES each one against a hard code-side allowlist
// (never trusts the model), executes the single action, records before/after or
// affected-row count to the execution log + daily impact rollup, and marks the
// proposal 'executed' (with result) or 'failed' (with error text). It NEVER
// silently reports success — this project has a false-success history.
//
// Proposals with requires_approval=true are LEFT as status='pending' — they are
// the ONLY things the founder is asked to approve.
//
// AUTH: service-role bearer (called by cergio_call_edge from pg_cron).
// REVERSIBLE-ONLY. Never sends a message, never moves money, never deletes.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── Code-side hard allowlist (defense-in-depth; SQL fn re-checks too) ─────────

// SQL verbs/targets that make an action irreversible, privileged, a send, or a
// money/auth move. If ANY appears, we refuse — no exceptions.
const SQL_BLOCK = [
  /\bdelete\b/i, /\bdrop\b/i, /\btruncate\b/i, /\bgrant\b/i, /\brevoke\b/i,
  /\balter\s+role\b/i, /\balter\s+table\b/i, /\bcreate\b/i, /\binsert\b/i,
  /\bauth\./i, /\bstorage\./i, /\bvault\./i, /\bpg_catalog\b/i, /\binformation_schema\b/i,
  /\bcopy\b/i, /\bcall\b/i, /\bdo\s*\$\$/i,
  // outbound / send / money tables must never be written:
  /\b(outreach_|outbound|notifications?|messages?|payouts?|payments?|transfers?|charges?)\b/i,
];

// A safe reversible UPDATE must (a) be a single statement, (b) be an UPDATE of one
// of the two lead tables, (c) have a WHERE clause. Anything else is refused.
function sqlIsSafe(raw: string): { ok: boolean; why?: string } {
  const stmt = String(raw || '').trim();
  if (!stmt) return { ok: false, why: 'empty statement' };
  // Single statement only — no stacking. Strip one trailing ';' then reject any inner ';'.
  const noTrail = stmt.replace(/;+\s*$/, '');
  if (noTrail.includes(';')) return { ok: false, why: 'multiple statements' };
  const s = noTrail.toLowerCase();
  if (!/^\s*update\s/.test(s)) return { ok: false, why: 'not a single UPDATE' };
  if (!/^\s*update\s+(public\.)?(leads_services|leads_influencers)\s/.test(s))
    return { ok: false, why: 'target table not allowlisted (only leads_services / leads_influencers)' };
  if (!/\swhere\s/.test(s)) return { ok: false, why: 'UPDATE has no WHERE clause' };
  for (const re of SQL_BLOCK) if (re.test(s)) return { ok: false, why: `prohibited token: ${re}` };
  return { ok: true };
}

// Edge calls the executor may re-run: read-only / enrich / harvest workers that
// are idempotent and NEVER message a human or move money.
const EDGE_ALLOW = new Set([
  'fulfill-crawl',
  'enrich-influencers',
  'crawl-health-check',
  'creator-harvest',
  'crawl-seed-yellowpages',
]);
// Explicit deny-list of families that message humans or move money (belt & braces).
const EDGE_DENY = [/^outreach-/i, /^notify/i, /^stripe-/i, /release-funds/i, /^outbound/i];

function edgeIsSafe(name: string): { ok: boolean; why?: string } {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return { ok: false, why: 'empty edge fn name' };
  for (const re of EDGE_DENY) if (re.test(n)) return { ok: false, why: `denied edge family: ${re}` };
  if (!EDGE_ALLOW.has(n)) return { ok: false, why: 'edge fn not in allowlist' };
  return { ok: true };
}

serve(async (req: Request) => {
  const started = Date.now();
  let dbRef: any = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return j({ error: 'unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    dbRef = db;

    // Only on-spec + reversible + not-yet-run proposals. Anything requiring
    // approval is intentionally excluded (it stays 'pending' for the founder).
    const { data: props, error: pErr } = await db
      .from('coo_proposals')
      .select('id, division, title, action_kind, action_payload, on_spec, requires_approval, status')
      .eq('requires_approval', false)
      .eq('status', 'pending')
      .order('rank', { ascending: true })
      .limit(10);
    if (pErr) throw pErr;

    const results: any[] = [];

    for (const p of props ?? []) {
      const kind = String(p.action_kind || 'none');
      const payload = String(p.action_payload || '');
      let status = 'failed';
      let result = '';
      let affected: number | null = null;
      let before_json: unknown = null;
      let after_json: unknown = null;

      try {
        // Second gate: even reaching here, on_spec + non-'none' + payload are required.
        if (p.on_spec !== true) throw new Error('refused: not marked on_spec');
        if (kind === 'none' || !payload) throw new Error('refused: no concrete action_payload');

        if (kind === 'sql') {
          const g = sqlIsSafe(payload);
          if (!g.ok) throw new Error('refused by SQL allowlist: ' + g.why);
          // Snapshot a cheap before/after signal: queued lead counts (reversible
          // quarantine/relabel/re-queue all move rows between these buckets).
          before_json = await leadCounts(db);
          // Run via the locked-down SECURITY DEFINER fn (it re-validates + returns rows).
          const { data: rows, error: eErr } = await db.rpc('cergio_coo_exec_sql', { stmt: payload });
          if (eErr) throw eErr;
          affected = typeof rows === 'number' ? rows : Number(rows ?? 0);
          after_json = await leadCounts(db);
          status = 'executed';
          result = `UPDATE affected ${affected} row(s)`;
        } else if (kind === 'edge_call') {
          const g = edgeIsSafe(payload);
          if (!g.ok) throw new Error('refused by edge allowlist: ' + g.why);
          // Re-run the idempotent worker via the SAME cron helper cergio_call_edge.
          const { error: cErr } = await db.rpc('cergio_call_edge', { fn: payload.trim().toLowerCase() });
          if (cErr) throw cErr;
          status = 'executed';
          result = `re-invoked edge fn '${payload.trim().toLowerCase()}' via cergio_call_edge`;
        } else {
          throw new Error('refused: unknown action_kind ' + kind);
        }
      } catch (e) {
        status = 'failed';
        result = e instanceof Error ? e.message : String(e);
      }

      // Per-action audit row (append log) — always written, executed OR failed.
      try {
        await db.from('coo_execution_log').insert({
          proposal_id: p.id, division: p.division, title: p.title,
          action_kind: kind, action_payload: payload,
          status, affected, result, before_json, after_json,
        });
      } catch (_e) { /* logging must never mask the real outcome */ }

      // Mark the proposal. Never claim success on error.
      await db.from('coo_proposals')
        .update({ status, executed_at: new Date().toISOString(), result: result.slice(0, 1000) })
        .eq('id', p.id);

      results.push({ id: p.id, title: p.title, kind, status, affected, result });
    }

    // Refresh the daily impact rollup so the dashboard reflects moved rows.
    try { await db.rpc('cergio_daily_impact'); } catch (_e) { /* non-fatal */ }

    const executed = results.filter((r) => r.status === 'executed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    try {
      await db.from('harvest_runs').insert({
        tag: 'coo-execute', candidates: results.length, ms: Date.now() - started,
        error: failed ? `${failed} failed` : null,
      });
    } catch (_e) { /**/ }

    // BACKBONE: unified agent_runs ledger. raw_found = proposals considered,
    // rows_written = actions successfully executed. 'error' if any failed (a
    // failed autonomous action must never read as green); 'empty' if nothing was
    // pending (a legitimate idle run).
    await logAgentRun(db, 'coo-execute', {
      started, raw_found: results.length, rows_written: executed,
      status: failed > 0 ? 'error' : (results.length === 0 ? 'empty' : 'ok'),
      error: failed > 0 ? `${failed} action(s) failed` : null,
      meta: { considered: results.length, executed, failed },
    });

    return j({ ok: true, considered: results.length, executed, failed, results, ms: Date.now() - started });
  } catch (e) {
    await logAgentRun(dbRef, 'coo-execute', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: e instanceof Error ? e.message : String(e),
    });
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws.
async function logAgentRun(
  db: any,
  agent: string,
  o: { started: number; raw_found?: number | null; rows_written?: number | null;
       status?: string; error?: string | null; meta?: unknown },
): Promise<void> {
  if (!db) return;
  try {
    await db.from('agent_runs').insert({
      agent,
      started_at: new Date(o.started).toISOString(),
      finished_at: new Date().toISOString(),
      raw_found: o.raw_found ?? null,
      rows_written: o.rows_written ?? null,
      status: o.status ?? 'ok',
      error: o.error ? String(o.error).slice(0, 1000) : null,
      meta: o.meta ?? null,
    });
  } catch (_e) { /* best-effort */ }
}

// Cheap before/after signal for the log: lead-status bucket counts.
async function leadCounts(db: any) {
  const q = async (table: string, status: string) => {
    const { count } = await db.from(table).select('id', { count: 'exact', head: true }).eq('outreach_status', status);
    return count ?? 0;
  };
  return {
    services_queued: await q('leads_services', 'queued'),
    services_dnc: await q('leads_services', 'do_not_contact'),
    creators_queued: await q('leads_influencers', 'queued'),
    creators_dnc: await q('leads_influencers', 'do_not_contact'),
  };
}
