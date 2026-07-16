// Supabase Edge Function — the autonomous AI COO. Runs on pg_cron, reads the live
// ops snapshot, asks Claude for the top ranked cross-functional proposals, and
// writes them to public.coo_proposals — fully server-side, NO Mac, no launcher.
// AUTH: service-role bearer (called by cergio_call_edge from cron).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const MODEL = 'claude-opus-4-8'; // highest-intelligence model for COO judgment (upgraded from haiku)
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

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

// ── Payload safety pre-check (mirror of coo-execute's hard allowlist) ─────────
// coo-brain does NOT trust the model's requires_approval flag blindly; it re-runs
// the SAME allowlist the executor enforces. This lets an on-spec proposal AUTO-RUN
// only when its payload actually PASSES the executor gate — and it can only ever
// DOWNGRADE a proposal to approval (never upgrade a prohibited action to auto-run).

// Verbs/targets that make a SQL action irreversible/privileged/a send/money/auth
// move. If ANY appears we refuse (identical to coo-execute SQL_BLOCK).
const SQL_BLOCK = [
  /\bdelete\b/i, /\bdrop\b/i, /\btruncate\b/i, /\bgrant\b/i, /\brevoke\b/i,
  /\balter\s+role\b/i, /\balter\s+table\b/i, /\bcreate\b/i, /\binsert\b/i,
  /\bauth\./i, /\bstorage\./i, /\bvault\./i, /\bpg_catalog\b/i, /\binformation_schema\b/i,
  /\bcopy\b/i, /\bcall\b/i, /\bdo\s*\$\$/i,
  /\b(outreach_|outbound|notifications?|messages?|payouts?|payments?|transfers?|charges?)\b/i,
];

// A safe reversible UPDATE: single statement, UPDATE of one of the two lead
// tables, with a WHERE clause. (Identical logic to coo-execute sqlIsSafe.)
function sqlPayloadSafe(raw: string): boolean {
  const stmt = String(raw || '').trim();
  if (!stmt) return false;
  const noTrail = stmt.replace(/;+\s*$/, '');
  if (noTrail.includes(';')) return false;
  const s = noTrail.toLowerCase();
  if (!/^\s*update\s/.test(s)) return false;
  if (!/^\s*update\s+(public\.)?(leads_services|leads_influencers)\s/.test(s)) return false;
  if (!/\swhere\s/.test(s)) return false;
  for (const re of SQL_BLOCK) if (re.test(s)) return false;
  return true;
}

// Idempotent workers the executor will re-run (identical to coo-execute EDGE_ALLOW).
const EDGE_ALLOW = new Set([
  'fulfill-crawl', 'enrich-influencers', 'crawl-health-check', 'creator-harvest', 'crawl-seed-osm',
]);
const EDGE_DENY = [/^outreach-/i, /^notify/i, /^stripe-/i, /release-funds/i, /^outbound/i];

function edgePayloadSafe(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  for (const re of EDGE_DENY) if (re.test(n)) return false;
  return EDGE_ALLOW.has(n);
}

// Return the safe auto-run verdict for a (kind, payload) pair, WITH the reason it
// failed. This ONLY ever grants auto-run when the payload passes the executor
// allowlist AND every column it names actually exists; anything else is
// downgraded. It can never upgrade a prohibited action.
function payloadVerdict(kind: string, payload: string, cols: LeadColumns): { ok: boolean; why?: string } {
  if (kind === 'sql') {
    if (!sqlPayloadSafe(payload)) return { ok: false, why: 'payload does not pass the executor SQL allowlist (single reversible UPDATE of a lead table, with a WHERE, no prohibited verb/target)' };
    // The gate that was missing: does every column it names EXIST?
    return sqlColumnsOk(payload, cols);
  }
  if (kind === 'edge_call') {
    return edgePayloadSafe(payload)
      ? { ok: true }
      : { ok: false, why: `edge fn '${payload}' is not in the idempotent-worker allowlist` };
  }
  return { ok: false, why: 'no concrete action' };
}

// The REAL schema, rendered into the prompt. This is the anti-hallucination fix:
// the model is no longer left to invent column names ("handle", "website") — it is
// handed the live list and told, in the same breath, which two guesses already
// cost us 12 dead actions.
function schemaContract(cols: LeadColumns): string {
  return [
    '    ┌─ SCHEMA CONTRACT — THESE ARE THE ONLY COLUMNS THAT EXIST ─────────────────┐',
    '    │ Read LIVE from the database on every run. Referencing any column not      │',
    '    │ listed below raises Postgres 42703 and the action FAILS. Do NOT guess.    │',
    '    └───────────────────────────────────────────────────────────────────────────┘',
    `    public.leads_services:    ${cols.leads_services.join(', ')}`,
    `    public.leads_influencers: ${cols.leads_influencers.join(', ')}`,
    '',
    `    THE ONLY BOOLEAN COLUMNS: leads_services → ${(LEAD_BOOLEAN_COLUMNS.leads_services || []).join(', ')}; `
      + `leads_influencers → ${(LEAD_BOOLEAN_COLUMNS.leads_influencers || []).join(', ')}.`,
    '    Every other column is text / integer / timestamp. `IS TRUE` / `IS NOT TRUE` on a',
    '    NON-boolean column raises Postgres 42804 ("argument of IS TRUE must be type boolean,',
    '    not type integer") — that is exactly how action #97 died. Use = / <> / IS NULL instead.',
    '',
    '    THE THREE HALLUCINATIONS THAT HAVE ALREADY FAILED IN PRODUCTION — never repeat them:',
    '      · There is NO "handle" column. The creator IG handle is leads_influencers.ig_handle.',
    '      · There is NO "website" column on either table. The services site URL is',
    '        leads_services.website_url; the creator link-in-bio is leads_influencers.external_url.',
    '      · leads_services has NO "category" column — the service category lives in service_type.',
    '        (leads_influencers DOES have category.)',
    '      · The services IG handle is leads_services.instagram; has_instagram is the derived boolean.',
    '',
    '    Before you emit an sql payload, check EVERY column you name against the two lists',
    '    above. If the column you want is not there, the fix is a CODE CHANGE',
    '    (action_kind="none", requires_approval=true) — NOT a guessed name. A payload that',
    '    names a column that does not exist is rejected before it runs and handed to the',
    '    founder as a defect, so guessing buys you nothing.',
  ].join('\n');
}

// Stale proposals whose fix is already shipped: coo-brain closes these at the
// start of each run so they stop nagging the founder. Match on title keywords
// (reversible: status='dismissed', never deleted). Each entry: a set of tokens
// that must ALL appear (case-insensitive) in the proposal title/detail.
const SUPERSEDED_MATCHERS: { label: string; tokens: string[] }[] = [
  // (1) ingest delivery-verification — now covered by agent_runs + cergio-watchdog.
  { label: 'delivery-verification (watchdog live)', tokens: ['deliver', 'verif'] },
  { label: 'ingest verification (watchdog live)', tokens: ['ingest', 'verif'] },
  // (2) creator-harvest upsert — now covered by seed rotation in creator-harvest.
  { label: 'creator-harvest upsert (seed rotation live)', tokens: ['harvest', 'upsert'] },
  { label: 'creator-harvest seed rotation (live)', tokens: ['harvest', 'seed'] },
];

// The system prompt is now a FUNCTION of the live schema — the column list is
// injected, never hard-coded, so the model always writes SQL against the columns
// the database actually has today.
const buildSystem = (cols: LeadColumns) => `You are the COO of Cergio, a services marketplace (friends recommend independent/mobile providers; creators drive bookings; everyone earns referral fees). Mission: help hundreds of millions earn from their skills — shared prosperity.

NON-NEGOTIABLE CONSTITUTION (these OVERRIDE any optimization; never violate, never hedge around):
1. EXECUTE the founder's FROZEN vision. Never propose anything that contradicts it.
2. FREE-FIRST, WITH JUDGMENT (not laziness). Default to free and NEVER be lazy about free data that is plainly harvestable — thousands of creators are free within the metro via web search; if yield is low, the FIRST answer is always to fix the harvester (better queries, fetch link-in-bio for contacts, decouple discovery from enrichment), never an excuse. You MAY surface a paid idea (e.g. a creator DB) but ONLY with a concrete ROI case tied to the proven-model path, framed as the founder's option — never as an escape from doing the free work, never as filler. A paid suggestion without exhausting the obvious free lever is a failure.
3. MIAMI-FIRST applies ONLY to the founding COHORT + CREATOR outreach (prove the loop in one metro first). It does NOT apply to SERVICES DATA: the services crawl is harvested BROADLY across many cities as a core asset — expanding services to new cities (Google Places / Yelp / Craigslist w/ quality gate) is CORRECT and encouraged, and must NEVER be flagged as a violation. Blocking services multi-city harvesting is obstruction.
4. No securities/equity in outreach.
5. Every proposal is a concrete, buildable tweak that advances traction WITHIN these constraints: better free harvest, better funnel/copy, activating the cohort we already have, fixing broken flows. No vague strategy, no "consider", no smoke.

You are given a live metrics snapshot. Output the TOP 3-5 highest lift-to-effort actions RIGHT NOW, all obeying the constitution.

── AUTONOMOUS EXECUTION CLASSIFICATION (per proposal — this is what lets safe work run itself) ──
For EACH proposal you MUST also emit an executable classification so an untrusted executor can safely run it or route it to the founder. The GOAL is that ON-SPEC, REVERSIBLE data fixes RUN THEMSELVES (requires_approval=false) — do NOT dump safe reversible work into the founder's approval queue. Only genuinely gated categories (below) may require approval.

• "on_spec" (boolean): true only if the action clearly ADVANCES the FROZEN vision and violates none of the constitution (free-first, no securities, cohort Miami-first for outreach, no blocked categories). If unsure, false.

• "action_kind" (enum): "sql" | "edge_call" | "none".
  - "sql": a SINGLE reversible SQL statement (put it in action_payload). ONLY these shapes are permitted and they must be reversible:
      · Quarantine bad/garbage/mislabeled leads: UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE <condition> (never DELETE).
      · Fix a mislabeled service_type / category / city on leads_services or leads_influencers via UPDATE ... SET ... WHERE ... .
      · Set an intrinsic flag such as has_instagram, or clear/set another reversible boolean/text flag: UPDATE ... SET has_instagram=true WHERE ... .
      · Re-queue a city / re-seed a lead status: UPDATE ... SET outreach_status='queued'/'new' WHERE ... .

${schemaContract(cols)}

    The snapshot includes "execution_failures". If a proposal you are about to
    make already appears there, DO NOT re-emit the same payload: it has already
    failed. Either correct it against the schema contract, or gate it.

    HARD RULES for sql payloads (the executor will REJECT anything else, so match exactly):
      (a) exactly ONE statement, no ';' except an optional trailing one;
      (b) it MUST start with UPDATE and target ONLY public.leads_services OR public.leads_influencers;
      (c) it MUST have a WHERE clause (never rewrite a whole table);
      (d) it must contain NONE of: DELETE, DROP, TRUNCATE, GRANT, REVOKE, ALTER, CREATE, INSERT, COPY, CALL, DO $$, auth./storage./vault., or any outreach_/outbound/notification/message/payout/payment/transfer/charge table.
    NEVER emit DELETE, DROP, TRUNCATE, GRANT, ALTER, INSERT into any send/outbound table, or any write to auth.* . Those are not reversible/allowed here.
  - "edge_call": re-run an idempotent, read/enrich/harvest worker by NAME (put the bare function name in action_payload). ONLY these are allowed: "fulfill-crawl", "enrich-influencers", "crawl-health-check", "creator-harvest", "crawl-seed-osm". NEVER "outreach-send", "notify-*", "stripe-*", "release-funds", "crawl-seed-google-places" (paid) or anything that messages a human or moves money.
  - "none": no safe automatic action exists (pure human decision, copy change, code change/deploy, strategy, or a change to the live metrics endpoint / cergio_ops_snapshot). action_payload = "".

• "action_payload" (string): the EXACT single SQL statement (for sql) or the bare edge fn name (for edge_call), else "". When action_kind is "sql" or "edge_call" you MUST fill this with a concrete, ready-to-run value — an empty payload makes the proposal un-runnable and it will be gated to the founder.

• "requires_approval" (boolean):
  - Set FALSE (AUTO-RUN) when ALL of: on_spec=true AND action_kind is "sql" or "edge_call" AND action_payload is a concrete value that obeys the HARD RULES above. On-spec reversible quarantine / relabel / flag-set / re-queue / re-seed / idempotent-worker-rerun SHOULD auto-run — that is the point of this system.
  - Set TRUE (GATE to founder) for ANY of these, no exceptions: off frozen spec; a code change needing deploy; a change to the LIVE METRICS ENDPOINT, ops-metrics, or cergio_ops_snapshot; ANY send/message/outreach; ANY money/payout/refund/transfer; anything legal; any access/permission/password/role change; any hard-delete or destructive op. For all of these, prefer action_kind="none" with requires_approval=true.
  - If action_kind="none", requires_approval MUST be true (there is nothing safe to auto-run).
  - When in doubt, requires_approval=true. NEVER mark a send/money/legal/access/delete/metrics-endpoint action auto-run.

WORKED EXAMPLES (emit payloads in exactly this shape):
  · Back-fill has_instagram on services that have an instagram URL → AUTO-RUN:
    {"action_kind":"sql","action_payload":"UPDATE public.leads_services SET has_instagram=true WHERE has_instagram IS NOT TRUE AND (coalesce(instagram,'') <> '' OR coalesce(website_url,'') ~* 'instagram\\\\.com/')","requires_approval":false}
  · Quarantine restaurant-mislabeled rows via do_not_contact → AUTO-RUN:
    {"action_kind":"sql","action_payload":"UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE outreach_status IN ('queued','new') AND lower(coalesce(service_type,'')||' '||coalesce(name,'')) ~ 'restaurant|cafe|diner|eatery'","requires_approval":false}
  · Re-run the crawl fulfiller (idempotent) → AUTO-RUN:
    {"action_kind":"edge_call","action_payload":"fulfill-crawl","requires_approval":false}
  · Change the bookings headline on the live metrics endpoint (code + metrics endpoint) → GATE:
    {"action_kind":"none","action_payload":"","requires_approval":true}
  · Send a cold outreach email/SMS to a cohort → GATE (never auto-run a send):
    {"action_kind":"none","action_payload":"","requires_approval":true}

Respond ONLY with JSON:
{"proposals":[{"rank":1,"division":"Growth|Product/UX|Engineering|Traction|Data","title":"...","detail":"one or two concrete sentences","lift":"...","effort":"low|med|high","on_spec":true,"action_kind":"sql","action_payload":"UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE outreach_status='queued' AND lower(coalesce(service_type,'')) ~ 'nightclub|hookah|liquor'","requires_approval":false}]}`;

serve(async (req: Request) => {
  const started = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return j({ error: 'unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);

    const { data: snap, error: sErr } = await db.rpc('cergio_ops_snapshot');
    if (sErr) throw sErr;

    // The REAL columns of the two lead tables, read live. They go INTO the prompt
    // (so the model stops inventing "handle" / "website") and are used again below
    // to re-check whatever SQL the model hands back.
    const leadCols = await liveLeadColumns(supabaseUrl, serviceKey);

    // ── Supersede stale proposals whose fix is ALREADY shipped ──────────────
    // Reversible (status='dismissed', never deleted). We only close a stale
    // proposal when the delivering system is actually live: (1) delivery-
    // verification → cergio-watchdog has a recent agent_runs row; (2) creator-
    // harvest upsert → creator-harvest has a recent agent_runs row (seed
    // rotation ships inside that worker). If the ledger check errs, we skip
    // (never close on uncertainty).
    let superseded = 0;
    try {
      const liveAgents = await recentAgents(db);
      const watchdogLive = liveAgents.has('cergio-watchdog');
      const harvestLive = liveAgents.has('creator-harvest');
      const enabled = SUPERSEDED_MATCHERS.filter((m) => {
        const t = m.tokens.join(' ');
        if (/verif|deliver|ingest/.test(t)) return watchdogLive;
        if (/harvest|upsert|seed/.test(t)) return harvestLive;
        return false;
      });
      if (enabled.length) {
        const { data: pending } = await db
          .from('coo_proposals')
          .select('id, title, detail')
          .eq('status', 'pending');
        const toClose: number[] = [];
        for (const row of pending ?? []) {
          const hay = `${row.title ?? ''} ${row.detail ?? ''}`.toLowerCase();
          if (enabled.some((m) => m.tokens.every((tok) => hay.includes(tok)))) toClose.push(row.id);
        }
        if (toClose.length) {
          await db.from('coo_proposals')
            .update({ status: 'dismissed', result: 'superseded: fix already shipped (watchdog / harvest seed-rotation live)' })
            .in('id', toClose);
          superseded = toClose.length;
        }
      }
    } catch (_e) { /* never let supersede-cleanup block fresh proposals */ }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return j({ error: 'ANTHROPIC_API_KEY not set' }, 500);
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: buildSystem(leadCols), // raised: per-proposal classification adds JSON
        messages: [{ role: 'user', content: 'Live metrics snapshot:\n' + JSON.stringify(snap) + '\n\nGive the ranked proposals JSON now.' }],
      }),
    });
    if (!resp.ok) return j({ error: 'anthropic ' + resp.status, body: (await resp.text()).slice(0, 300) }, 502);
    const aj = await resp.json();
    const text = (aj?.content ?? []).map((c: any) => c?.text ?? '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return j({ error: 'no json from model', raw: text.slice(0, 300) }, 502);
    const parsed = JSON.parse(m[0]);
    const items = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 5) : [];

    // Replace the pending set with today's fresh COO proposals.
    await db.from('coo_proposals').update({ status: 'dismissed' }).eq('status', 'pending');
    if (items.length) {
      const rows = items.map((p: any, i: number) => {
        // Normalize + defensively re-gate the model's classification. The model
        // proposes; coo-brain re-verifies each payload against the SAME hard
        // allowlist the executor enforces, then coo-execute re-checks again.
        //
        // Direction is one-way: this logic can only ever DOWNGRADE a proposal to
        // requires_approval=true (when the payload is missing or fails the safety
        // pre-check). It NEVER upgrades a prohibited/off-spec action to auto-run.
        const kindRaw = String(p.action_kind ?? 'none').toLowerCase();
        let action_kind = (kindRaw === 'sql' || kindRaw === 'edge_call') ? kindRaw : 'none';
        let action_payload = action_kind === 'none' ? '' : String(p.action_payload ?? '').slice(0, 2000);
        const on_spec = p.on_spec === true;

        // Safety pre-check: does the concrete payload PASS the executor allowlist
        // (single reversible UPDATE of a lead table w/ WHERE, or an allowlisted
        // idempotent worker) AND — the check that did not exist while 12 actions
        // died — does every column it names actually EXIST on the target table?
        const verdict = (action_kind !== 'none' && action_payload.length > 0)
          ? payloadVerdict(action_kind, action_payload, leadCols)
          : { ok: false, why: 'no concrete action_payload' };
        const payloadSafe = verdict.ok;

        // A payload that names a column the table does not have is NOT a proposal
        // the founder can approve into existence — approving it would just ship the
        // same 42703. So we strip the doomed SQL (action_kind='none'), keep the
        // statement + reason in `detail` where an engineer can see it, and gate it.
        const schemaBad = action_kind === 'sql' && !verdict.ok && /^SCHEMA:/.test(String(verdict.why || ''));
        const gateNote = schemaBad
          ? `\n\n[GATED — ${verdict.why} The proposal is sound but the SQL is not runnable; this needs a code/schema fix, not an approval. Rejected payload: ${action_payload}]`
          : '';
        if (schemaBad) { action_kind = 'none'; action_payload = ''; }

        // AUTO-RUN (requires_approval=false) only when the proposal is on_spec,
        // the model asked for auto-run, AND the payload passes the safety gate.
        // Anything else — off-spec, model wanted approval, missing/unsafe payload
        // (a send/money/legal/delete/metrics-endpoint payload can never pass the
        // allowlist), or a payload naming a non-existent column — is DOWNGRADED to
        // requires_approval=true.
        const requires_approval = !(
          p.requires_approval === false && on_spec && payloadSafe
        );
        return {
          rank: p.rank ?? i + 1, division: String(p.division ?? 'General').slice(0, 40),
          title: String(p.title ?? '').slice(0, 200),
          detail: (String(p.detail ?? '') + gateNote).slice(0, 1000),
          expected_lift: String(p.lift ?? '').slice(0, 120), effort: String(p.effort ?? '').slice(0, 60),
          status: 'pending', on_spec, action_kind, action_payload, requires_approval,
        };
      });
      await db.from('coo_proposals').insert(rows);
    }
    try { await db.from('harvest_runs').insert({ tag: 'coo-brain', candidates: items.length, ms: Date.now() - started }); } catch (_e) { /**/ }
    return j({ ok: true, proposals_written: items.length, superseded, sample: items.map((p: any) => p.title), ms: Date.now() - started });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});

// Which agents have a RECENT (last 48h) run in the unified agent_runs ledger.
// Used to decide whether a "fix" (delivery-verification watchdog / creator-
// harvest seed rotation) is actually live before we supersede its proposal.
// Returns an empty set (→ closes nothing) on any error: never close on doubt.
async function recentAgents(db: any): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data } = await db
      .from('agent_runs')
      .select('agent, finished_at')
      .gte('finished_at', since)
      .limit(500);
    for (const r of data ?? []) if (r?.agent) out.add(String(r.agent));
  } catch (_e) { /* empty set → supersede nothing */ }
  return out;
}
