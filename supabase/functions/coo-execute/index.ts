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

// ─── LEAD-TABLE SCHEMA CONTRACT — DO NOT FORK ────────────────────────────────
// 12 autonomous actions died with Postgres 42703 — `column "handle" does not
// exist (hint: perhaps you meant to reference the column
// "leads_influencers.ig_handle")` and `column "website" does not exist` — because
// the model authored SQL against a HALLUCINATED schema and NOTHING between the
// model and Postgres ever checked the column names. The old allowlist only asked
// "is this a single reversible UPDATE of a lead table with a WHERE?" — a doomed
// statement passes that test perfectly. Shape was checked; meaning was not.
//
// So the column list is now DATA, carried byte-identically by coo-brain (which
// injects it into the model prompt AND re-checks the payload it gets back) and
// coo-execute (which re-checks again immediately before running anything). A
// payload naming a column that does not exist is REFUSED and routed to the
// founder — it is never shipped to the database to fail.
//
// The fallback list is the DDL truth (leads_services / leads_influencers as
// created by the services-crawl handoff `01_leads_tables.sql`, plus the two
// additive ALTERs: leads_services.has_instagram and
// leads_influencers.enrich_attempted_at). At RUN TIME we prefer the LIVE column
// list read from PostgREST's OpenAPI spec, so an ALTER that has not actually been
// applied yet can never produce a payload referencing a column the database does
// not really have.
//
// qa.mjs #76 asserts the two copies never drift, and unit-tests this validator
// against the exact two payloads that failed live.
type LeadColumns = { leads_services: string[]; leads_influencers: string[] };

const LEAD_COLUMNS_FALLBACK: LeadColumns = {
  leads_services: [
    'id', 'name', 'service_type', 'phone', 'phone_origin', 'website_url', 'address',
    'city', 'state', 'zip', 'lat', 'lon', 'osm_id', 'yelp_url', 'cl_post_url',
    'instagram', 'facebook', 'owner_email', 'data_source', 'fetched_at', 'has_instagram',
    'outreach_status', 'outreach_last_at', 'outreach_notes', 'invited_at',
    'signed_up_profile_id', 'signed_up_at', 'created_at', 'updated_at',
  ],
  leads_influencers: [
    'id', 'ig_handle', 'display_name', 'category', 'tier', 'followers', 'email',
    'phone', 'phone_verified_level', 'email_verified', 'city', 'state', 'bio',
    'external_url', 'is_business', 'osm_id', 'discovered_via', 'enrich_attempted_at',
    'outreach_status', 'outreach_last_at', 'outreach_notes', 'invited_at',
    'signed_up_profile_id', 'signed_up_at', 'created_at', 'updated_at',
  ],
};

// Tokens that may legally appear in an UPDATE payload WITHOUT being a column
// name (keywords, operators-as-words, type names, literal prefixes). Anything
// left over after these — and after comments, string literals, casts, schema
// qualifiers, the table name, its alias and function names are stripped — MUST be
// a real column of the target table.
const SQL_NON_COLUMN_WORDS = new Set([
  'update', 'set', 'where', 'from', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false',
  'unknown', 'like', 'ilike', 'similar', 'to', 'between', 'symmetric', 'exists', 'any', 'all',
  'some', 'case', 'when', 'then', 'else', 'end', 'as', 'asc', 'desc', 'nulls', 'first', 'last',
  'distinct', 'on', 'using', 'only', 'returning', 'default', 'collate', 'escape', 'interval',
  'array', 'row', 'values', 'select', 'limit', 'offset', 'order', 'by', 'group', 'having',
  'with', 'without', 'at', 'time', 'zone', 'current_date', 'current_time', 'current_timestamp',
  'localtime', 'localtimestamp', 'cast', 'both', 'leading', 'trailing', 'text', 'varchar',
  'char', 'character', 'int', 'integer', 'int2', 'int4', 'int8', 'bigint', 'smallint', 'numeric',
  'decimal', 'real', 'double', 'precision', 'boolean', 'bool', 'uuid', 'json', 'jsonb', 'date',
  'timestamp', 'timestamptz', 'timetz', 'bytea', 'e', 'u', 'n', 'b', 'x',
]);

// The NAME check above stops 42703. It does NOT stop 42804 — which is what killed
// action #97 on 2026-07-14: `... IS NOT TRUE` applied to a column that is an
// INTEGER, not a boolean ("argument of IS TRUE must be type boolean, not type
// integer"). Same disease as the hallucinated column: the model assumed a type
// nobody ever told it. So the contract also carries the ONLY boolean columns on
// each lead table, and `IS [NOT] TRUE/FALSE` is refused on anything else.
const LEAD_BOOLEAN_COLUMNS: Record<string, string[]> = {
  leads_services: ['has_instagram'],
  leads_influencers: ['is_business', 'email_verified'],
};

function typesOk(stmt: string, table: string): { ok: boolean; why?: string } {
  const bools = new Set((LEAD_BOOLEAN_COLUMNS[table] || []).map((c) => c.toLowerCase()));
  const re = /\b([a-z_][a-z0-9_$]*)\s+is\s+(?:not\s+)?(?:true|false)\b/gi;
  const bad: string[] = [];
  let m = re.exec(stmt);
  while (m !== null) {
    const col = m[1].toLowerCase();
    if (!bools.has(col) && bad.indexOf(col) === -1) bad.push(col);
    m = re.exec(stmt);
  }
  if (bad.length === 0) return { ok: true };
  return {
    ok: false,
    why: `SCHEMA: \`IS [NOT] TRUE/FALSE\` used on non-boolean column(s) on public.${table}: ${bad.join(', ')} — Postgres 42804 (this is what killed action #97). Boolean columns here: ${[...bools].join(', ') || '(none)'}. Compare with = / <> / IS NULL instead.`,
  };
}

// PRE-FLIGHT SCHEMA VALIDATION. Every bare identifier the statement references on
// the target table must exist, AND every IS TRUE/FALSE must target a boolean.
// Fails CLOSED: an identifier we cannot account for is reported as unknown (→ the
// action is gated to the founder), never assumed fine. That is the correct
// direction — a false gate costs one approval click; a false pass costs another
// dead autonomous action and another day of blind loop.
function sqlColumnsOk(raw: string, cols: LeadColumns): { ok: boolean; why?: string } {
  const stmt = String(raw || '').trim().replace(/;+\s*$/, '');
  const head = stmt.match(
    /^\s*update\s+(?:only\s+)?(?:public\s*\.\s*)?(leads_services|leads_influencers)\b\s*(?:as\s+)?([a-z_][a-z0-9_$]*)?/i,
  );
  if (!head) return { ok: false, why: 'target table not allowlisted (only leads_services / leads_influencers)' };
  const table = head[1].toLowerCase();
  const aliasRaw = String(head[2] || '').toLowerCase();
  const alias = (aliasRaw && aliasRaw !== 'set') ? aliasRaw : '';
  const known = table === 'leads_services' ? cols.leads_services : cols.leads_influencers;
  if (!known || known.length === 0) return { ok: false, why: `no known column list for ${table} — refusing to guess` };
  const knownSet = new Set(known.map((c) => String(c).toLowerCase()));

  // Strip everything that is NOT a bare column reference, in this order.
  let s = ' ' + stmt + ' ';
  s = s.replace(/--[^\n]*/g, ' ');                              // line comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');                      // block comments
  s = s.replace(/\$[a-z0-9_]*\$[\s\S]*?\$[a-z0-9_]*\$/gi, ' '); // dollar-quoted bodies
  s = s.replace(/'(?:''|[^'])*'/g, ' ');                        // string literals ('a''b' safe)
  s = s.replace(/"([a-z_][a-z0-9_$]*)"/gi, ' $1 ');             // quoted identifiers -> bare
  s = s.replace(/::\s*[a-z_][a-z0-9_]*(\s*\[\s*\])?/gi, ' ');   // ::casts
  s = s.replace(/\bpublic\s*\.\s*/gi, ' ');                     // schema qualifier
  if (alias) s = s.replace(new RegExp('\\b' + alias + '\\s*\\.\\s*', 'gi'), ' ');
  s = s.replace(/\b(leads_services|leads_influencers)\s*\.\s*/gi, ' ');
  s = s.replace(/\b(leads_services|leads_influencers)\b/gi, ' ');
  if (alias) s = s.replace(new RegExp('\\b' + alias + '\\b', 'gi'), ' ');

  const unknown: string[] = [];
  const re = /[a-z_][a-z0-9_$]*/gi;
  let m = re.exec(s);
  while (m !== null) {
    const word = m[0];
    const lower = word.toLowerCase();
    const isCall = /^\s*\(/.test(s.slice(m.index + word.length)); // lower(...) / coalesce(...) etc.
    if (!isCall && !SQL_NON_COLUMN_WORDS.has(lower) && !knownSet.has(lower) && unknown.indexOf(lower) === -1) {
      unknown.push(lower);
    }
    m = re.exec(s);
  }
  if (unknown.length === 0) return typesOk(stmt, table);

  // Name the real column when we can — this is the hint Postgres gave us AFTER
  // the action had already failed; give it to the author BEFORE it runs.
  const hints = unknown.map((u) => {
    const near = known.find((k) => k.toLowerCase().includes(u) || u.includes(k.toLowerCase()));
    return near ? `${u} (did you mean ${near}?)` : u;
  });
  return {
    ok: false,
    why: `SCHEMA: unknown column(s) on public.${table}: ${hints.join(', ')} — this payload would raise Postgres 42703 and fail, exactly like the 12 dead actions. Refusing to ship it.`,
  };
}

// LIVE column list, straight from PostgREST's OpenAPI spec (no migration, no RPC
// needed). Falls back to the DDL list on ANY doubt — a partial or unreadable spec
// must never silently shrink the known-column set and start rejecting good SQL.
async function liveLeadColumns(url: string, key: string): Promise<LeadColumns> {
  try {
    const r = await fetch(String(url).replace(/\/+$/, '') + '/rest/v1/', {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
    });
    if (!r.ok) return LEAD_COLUMNS_FALLBACK;
    const spec = await r.json();
    const defs = (spec && (spec.definitions || (spec.components && spec.components.schemas))) || {};
    const svc = defs['leads_services'] && defs['leads_services'].properties
      ? Object.keys(defs['leads_services'].properties) : [];
    const inf = defs['leads_influencers'] && defs['leads_influencers'].properties
      ? Object.keys(defs['leads_influencers'].properties) : [];
    if (svc.length < 5 || inf.length < 5) return LEAD_COLUMNS_FALLBACK;
    return { leads_services: svc, leads_influencers: inf };
  } catch (_e) {
    return LEAD_COLUMNS_FALLBACK;
  }
}
// ─── END LEAD-TABLE SCHEMA CONTRACT ──────────────────────────────────────────

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
// NOTE: 'crawl-seed-yellowpages' was REMOVED 2026-07-13 — YellowPages is
// permanently 403-blocked from datacenter IPs, so re-invoking the seeder only
// refills a queue that can never drain. Google Places is the live services path.
const EDGE_ALLOW = new Set([
  'fulfill-crawl',
  'enrich-influencers',
  'crawl-health-check',
  'creator-harvest',
  // FREE OpenStreetMap/Overpass matrix seeder (SPEC-72 free-first). Enqueue-only,
  // idempotent, no send / no money — safe for the executor to re-run. Replaces the
  // paid 'crawl-seed-google-places' (never in the allowlist) as the primary source.
  'crawl-seed-osm',
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

    // The REAL column list, read live (falls back to the DDL list on any doubt).
    // Every SQL payload is checked against this before it is allowed near Postgres.
    const leadCols = await liveLeadColumns(supabaseUrl, serviceKey);

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
      // GATED (not failed): the payload is syntactically allowlisted but references
      // a column that does not exist. We caught it BEFORE Postgres did, so there is
      // nothing to "fail" — the proposal is handed back to the founder instead.
      let gated = false;

      try {
        // Second gate: even reaching here, on_spec + non-'none' + payload are required.
        if (p.on_spec !== true) throw new Error('refused: not marked on_spec');
        if (kind === 'none' || !payload) throw new Error('refused: no concrete action_payload');

        if (kind === 'sql') {
          const g = sqlIsSafe(payload);
          if (!g.ok) throw new Error('refused by SQL allowlist: ' + g.why);
          // PRE-FLIGHT SCHEMA VALIDATION — the check that did not exist when 12
          // actions were shipped straight into a 42703. A statement naming a column
          // the table does not have is REFUSED here and never reaches the database.
          const c = sqlColumnsOk(payload, leadCols);
          if (!c.ok) {
            gated = true;
            result = 'refused before execution — ' + (c.why || 'unknown column');
          } else {
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
          }
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
        result = serr(e);
      }

      // SCHEMA-GATED: hand it back to the founder instead of shipping a doomed
      // action. requires_approval=true removes it from this executor's queue for
      // good (the queue is requires_approval=false), so it can never loop, and the
      // reason travels with it so the fix is a code change, not another guess.
      if (gated) {
        try {
          await db.from('coo_execution_log').insert({
            proposal_id: p.id, division: p.division, title: p.title,
            action_kind: kind, action_payload: payload,
            status: 'refused', affected: null, result, before_json: null, after_json: null,
          });
        } catch (_e) { /* logging must never mask the real outcome */ }
        await db.from('coo_proposals')
          .update({ requires_approval: true, status: 'pending', result: result.slice(0, 1000) })
          .eq('id', p.id);
        results.push({ id: p.id, title: p.title, kind, status: 'refused', affected: null, result });
        continue;
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
    const refused = results.filter((r) => r.status === 'refused').length;
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
      // `refused` = payloads caught by the pre-flight schema check and handed back
      // to the founder. Not an error (nothing broke) but it MUST be visible: a
      // non-zero count means coo-brain is still authoring against a wrong schema.
      meta: { considered: results.length, executed, failed, refused },
    });

    return j({ ok: true, considered: results.length, executed, failed, refused, results, ms: Date.now() - started });
  } catch (e) {
    await logAgentRun(dbRef, 'coo-execute', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: serr(e),
    });
    return j({ error: serr(e), ms: Date.now() - started }, 500);
  }
});

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
