// Supabase Edge Function — the autonomous AI COO. Runs on pg_cron, reads the live
// ops snapshot, asks Claude for the top ranked cross-functional proposals, and
// writes them to public.coo_proposals — fully server-side, NO Mac, no launcher.
// AUTH: service-role bearer (called by cergio_call_edge from cron).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const MODEL = 'claude-opus-4-8'; // highest-intelligence model for COO judgment (upgraded from haiku)
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

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
  'fulfill-crawl', 'enrich-influencers', 'crawl-health-check', 'creator-harvest', 'crawl-seed-yellowpages',
]);
const EDGE_DENY = [/^outreach-/i, /^notify/i, /^stripe-/i, /release-funds/i, /^outbound/i];

function edgePayloadSafe(name: string): boolean {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  for (const re of EDGE_DENY) if (re.test(n)) return false;
  return EDGE_ALLOW.has(n);
}

// Return the safe auto-run verdict for a (kind, payload) pair. This ONLY ever
// grants auto-run when the payload passes the executor allowlist; anything else
// is downgraded. It can never upgrade a prohibited action.
function payloadPassesAllowlist(kind: string, payload: string): boolean {
  if (kind === 'sql') return sqlPayloadSafe(payload);
  if (kind === 'edge_call') return edgePayloadSafe(payload);
  return false;
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

const SYSTEM = `You are the COO of Cergio, a services marketplace (friends recommend independent/mobile providers; creators drive bookings; everyone earns referral fees). Mission: help hundreds of millions earn from their skills — shared prosperity.

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

    ┌─ SCHEMA CONTRACT — THESE ARE THE ONLY COLUMNS THAT EXIST ─────────────────┐
    │ Referencing any column not listed here raises 42703 and the action FAILS. │
    │ Do NOT guess or invent column names. There is no "website", no "handle".  │
    │                                                                            │
    │ public.leads_services:                                                     │
    │   id, name, service_type, phone, phone_origin, website_url, address,       │
    │   city, state, zip, lat, lon, osm_id, yelp_url, cl_post_url, instagram,    │
    │   facebook, owner_email, data_source, fetched_at, has_instagram,           │
    │   outreach_status, outreach_last_at, outreach_notes                        │
    │   → the site URL is website_url (NOT "website")                            │
    │   → there is NO "category" column; the category lives in service_type      │
    │   → the IG handle is instagram; has_instagram is the derived boolean flag  │
    │                                                                            │
    │ public.leads_influencers:                                                  │
    │   id, ig_handle, display_name, bio, category, city, state, followers,      │
    │   tier, email, email_verified, phone, phone_verified_level, external_url,  │
    │   is_business, osm_id, discovered_via, outreach_status                     │
    │   → the IG handle is ig_handle (NOT "handle")                              │
    │   → the link-in-bio / site URL is external_url (NOT "website")             │
    └────────────────────────────────────────────────────────────────────────────┘

    Before you emit an sql payload, check EVERY column you named against the
    contract above. If the column you want does not exist, the fix is a code
    change (action_kind="none", requires_approval=true) — NOT a guessed name.

    The snapshot includes "execution_failures". If a proposal you are about to
    make already appears there, DO NOT re-emit the same payload: it has already
    failed. Either correct it against the schema contract, or gate it.

    HARD RULES for sql payloads (the executor will REJECT anything else, so match exactly):
      (a) exactly ONE statement, no ';' except an optional trailing one;
      (b) it MUST start with UPDATE and target ONLY public.leads_services OR public.leads_influencers;
      (c) it MUST have a WHERE clause (never rewrite a whole table);
      (d) it must contain NONE of: DELETE, DROP, TRUNCATE, GRANT, REVOKE, ALTER, CREATE, INSERT, COPY, CALL, DO $$, auth./storage./vault., or any outreach_/outbound/notification/message/payout/payment/transfer/charge table.
    NEVER emit DELETE, DROP, TRUNCATE, GRANT, ALTER, INSERT into any send/outbound table, or any write to auth.* . Those are not reversible/allowed here.
  - "edge_call": re-run an idempotent, read/enrich/harvest worker by NAME (put the bare function name in action_payload). ONLY these are allowed: "fulfill-crawl", "enrich-influencers", "crawl-health-check", "creator-harvest", "crawl-seed-yellowpages". NEVER "outreach-send", "notify-*", "stripe-*", "release-funds" or anything that messages a human or moves money.
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
        model: MODEL, max_tokens: 2000, system: SYSTEM, // raised: per-proposal classification adds JSON
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
        const action_kind = (kindRaw === 'sql' || kindRaw === 'edge_call') ? kindRaw : 'none';
        const action_payload = action_kind === 'none' ? '' : String(p.action_payload ?? '').slice(0, 2000);
        const on_spec = p.on_spec === true;

        // Safety pre-check: does the concrete payload PASS the executor allowlist?
        // (single reversible UPDATE of a lead table w/ WHERE, or an allowlisted
        // idempotent worker). Only a payload that passes may be auto-run.
        const payloadSafe = action_kind !== 'none' && action_payload.length > 0
          && payloadPassesAllowlist(action_kind, action_payload);

        // AUTO-RUN (requires_approval=false) only when the proposal is on_spec,
        // the model asked for auto-run, AND the payload passes the safety gate.
        // Anything else — off-spec, model wanted approval, missing/unsafe payload
        // (a send/money/legal/delete/metrics-endpoint payload can never pass the
        // allowlist) — is DOWNGRADED to requires_approval=true.
        const requires_approval = !(
          p.requires_approval === false && on_spec && payloadSafe
        );
        return {
          rank: p.rank ?? i + 1, division: String(p.division ?? 'General').slice(0, 40),
          title: String(p.title ?? '').slice(0, 200), detail: String(p.detail ?? '').slice(0, 1000),
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
