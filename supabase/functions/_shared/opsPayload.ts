// SHARED ops payload builder (SPEC-104, 2026-07-29).
//
// WHY THIS FILE EXISTS: `ops-console` is NOT in the CI deploy list in
// .github/workflows/deploy-functions.yml, and that workflow cannot be edited
// from the off-Mac pipeline (the PAT has no `workflow` scope). Result: fixes to
// ops-console merge but never reach production -> the founder saw a stale
// allowlist return "Forbidden" on /ops/status.
//
// FIX: the payload lives here, and `admin-crawl-status` (which IS in the CI
// deploy list) imports it and serves it at { view: 'ops' }. The Supabase CLI
// bundles imported modules at deploy time, so every future ops change now ships
// off-Mac automatically via CI. `ops-console` keeps the same contract.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb, growthEnvPresent } from './growthDb.ts';

// every agent/cron we claim runs — so "is it on?" is answered by DATA, not belief
export const AGENTS = ['fulfill-crawl','creator-harvest','enrich-influencers','creator-enrich','qa-suite','qa-live-verify','crawl-health-check','coo-execute','cergio-watchdog','cergio-orchestrator','ops-metrics','supply-engine'];
// SERVICE sources. google_sponsored is deliberately absent (SPEC-222): 34 rows in its
// whole life, ran on SerpAPI against the Apify-only rule, and overlapped google_lsa almost
// entirely. Historical rows are kept, so it is still counted where it appears in data —
// it just is not a source we schedule.
//
// I DELETED THIS WHOLE LINE ONCE with a regex meant to remove one entry from it, and the
// console then crashed with "SOURCES is not defined" — every count, every filter and every
// DMA gone at once. A regex that matches a line is not a regex that matches an item.
export const SOURCES = ['gmaps_apify','craigslist','yellowpages_apify','ig_services','yelp','google_local','google_lsa','yellowpages','osm','google_places','openstreetmap'];
// SPEC-243 (founder, 2026-08-03, verbatim: "add all sources not just creators to the
// crawl at 100 leads each max to review (except yelp)"). The rota sources the per-source
// audit cap governs, and for each one EVERY data_source value its rows actually carry.
// Two names for one source is the Part-6 mechanism-C defect — 859 real rows once
// exported as zero because a count used the wrong name: fulfillYellowPagesApify writes
// data_source 'yellowpages' (not its rota name), and google_lsa's history includes
// 'google_sponsored' rows folded in by SPEC-233. ONE definition, used by BOTH the
// fulfill-crawl claim gate and this payload's source_states, so the scheduler and the
// founder's screen can never disagree about whether a source is capped. yelp is absent
// on purpose: it is PAUSED by founder order (SPEC-239), not capped — re-activating it is
// a founder decision that updates gate #239, and it would need a row here then.
export const AUDIT_CAP_SOURCES: Record<string, string[]> = {
  osm: ['osm'],
  craigslist: ['craigslist'],
  yellowpages_apify: ['yellowpages_apify', 'yellowpages'],
  google_lsa: ['google_lsa', 'google_sponsored'],
  gmaps_apify: ['gmaps_apify'],
  ig_services: ['ig_services'],
};
// The cap itself, read from the committed controls (pushed to the edge runtime by CI).
// An unparseable value falls back to 100 — the founder's number — never to "no cap":
// a typo that silently disabled every stop would fail OPEN, and open is the expensive
// direction here.
export function sourceAuditCap(raw: string | undefined): number {
  const n = Number(raw ?? '100');
  return Number.isFinite(n) ? n : 100;
}

// ── SPEC-244 — THE DMA IS ITS OWN DEFINITION, NOT THE STATE COLUMN ──────────────────
// Founder, 2026-08-03, verbatim: "THE DMA is technically held by it's own DMA
// definition (that's unrelated to state)... orlando is also a key DMA in FL... NYC DMA
// includes Jersey City (state of new jersey)... this is standard DMA ... use a
// standard DMA definition / boundary".
// Everything DMA-shaped is keyed on Nielsen DMA codes (Nielsen 2024-25
// "Local Television Market Universe Estimates" — the same source as the household
// counts behind the quota formula). A state is not a DMA: Florida holds Miami-Ft. Lauderdale AND Orlando AND
// Tampa; the New York DMA reaches into NJ and CT. ONE definition, exported from here,
// consumed by the ops payload, the data explorer and (as a welded literal) fulfill-crawl.
export const DMAS: Record<string, { name: string; households: number }> = {
  '501': { name: 'New York', households: 7494510 },
  '528': { name: 'Miami-Ft. Lauderdale', households: 1756920 },
};
// LOCATION → DMA overrides, consulted BEFORE any state-based rule: DMA membership is a
// property of the place, not the state column. Jersey City and Newark are here because
// the founder named them. Add further NJ/CT locations against the Nielsen county list
// when they appear in real data — never from memory (TODO stands until then; south NJ
// belongs to the Philadelphia DMA 504, so a blanket NJ rule is wrong in both directions).
export const LOCATION_DMA: Record<string, string> = {
  'Jersey City': '501',
  'Newark': '501',
};
// Raw `state`-column spellings that map into each DMA, for rows whose location is not
// in LOCATION_DMA. NJ and CT sit inside the New York DMA per the founder's order — an
// NJ or CT row is IN-target now, not an off-target finding. TODO: if we ever hold NJ
// rows from the Philadelphia DMA or CT rows from the Hartford DMA, they must be split
// by location, not by state — that is the whole point of SPEC-244.
export const DMA_STATE_SPELLINGS: Record<string, string[]> = {
  '501': ['NY', 'NEW YORK', 'NYC', 'NJ', 'NEW JERSEY', 'CT', 'CONNECTICUT'],
  '528': ['FL', 'FLORIDA', 'MIAMI'],
};
// Legacy filter values ('NY'/'FL' — the old state-as-DMA keys) still arrive from older
// screens; they resolve to the DMA they meant. New code sends the code itself.
export function resolveDma(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (DMAS[v]) return v;
  const up = v.toUpperCase();
  for (const [code, spellings] of Object.entries(DMA_STATE_SPELLINGS)) {
    if (spellings.includes(up)) return code;
  }
  return null;
}
// CREATOR sources — the algorithm decided these (each with its own discovery method):
// SPEC-233 (founder, 2026-08-02): "we're supposed to have 2 (IG services and the other IG
// local creator search)". There are TWO, and listing six meant four permanently-zero rows
// sat beside them on the console — an abandoned Modash seed, a Feedspot list we never
// built, and two labels that were never written by any function. Zeros for things that do
// not exist make the two that DO exist look like failures.
export const CREATOR_SOURCES = [
  'ig-scraper-user-search',    // ig_services, DUAL-CLASS: one person -> a service row AND a creator row
  'se:web-harvest',            // creator-harvest: FREE keyless web search, contact from their own link-in-bio
];

// Admin allowlist — env wins, but the default must contain every address the
// founder actually signs in with (a narrow default is what caused "Forbidden").
export const DEFAULT_ADMINS = ['t@cergio.ai', 'info@cergio.ai', 'tarik.sansal2@gmail.com', 'tarik@cergio.ai', 'tariksansal@gmail.com'];
export function isAdminEmail(email: string, envList?: string | null): boolean {
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  return (envList || DEFAULT_ADMINS.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(e);
}

// WHAT each creator algorithm actually does + WHERE it looks. The founder asked
// "what are they... where are they" — a bare source key answers neither.
export const CREATOR_SOURCE_META: Record<string, { what: string; where: string }> = {
  'ig-scraper-user-search': { what: 'Apify Instagram user search, run by the DUAL-CLASS ig_services crawl — one person yields a service row AND a creator row', where: 'Instagram (Apify)' },
  'se:web-harvest':         { what: 'FREE keyless web search for local on-values creators; contact taken from their own link-in-bio. Stamped per run day, so it must be matched by PREFIX', where: 'DuckDuckGo HTML (no key, no Mac)' },
};

// creator-harvest writes one discovered_via PER RUN DAY (e.g. se:web-harvest-2026-07-28).
// Counting by equality on the algorithm name matched 0 rows even with thousands
// present — so every count here is a PREFIX match that folds the daily runs back
// into their algorithm. Never switch this back to eq().
export const creatorSourceMatch = (q: any, source: string) => q.like('discovered_via', `${source}%`);

export async function buildOpsPayload(db: SupabaseClient, body: Record<string, unknown> = {}) {
  // SPEC-132: crawl_requests / leads_services / leads_influencers now live in the
  // SEPARATE growth project. Read them from there so the dashboard keeps showing
  // real numbers after the cutover. agent_runs / qa_findings / product tables stay
  // on the product DB. If growth is not configured we fall back to `db` so the
  // console degrades to "no growth data" instead of throwing.
  const gdb = growthEnvPresent() ? growthDb() : db;
  const since = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  // CITY FILTER (founder request 2026-07-29: "no way to filter by city").
  // null = all cities. Applied to EVERY services/creators count below so the
  // whole console is scoped consistently — not just one panel.
  // SPEC-227 (founder, 2026-08-02): "cities are DMA's only.. what you have under cities is
  // locations.. which should be a sub filter of city".
  //
  // CITY is the DMA — NYC or Miami — and lives in `state` (NY / FL). LOCATION is the
  // neighbourhood and lives in the column confusingly NAMED `city`. The dropdown was
  // listing Bronx, Astoria, Bayside as "cities", which is why it read as wrong: it was
  // showing locations under a City label.
  const city = typeof body.city === 'string' && body.city.trim() ? (body.city as string).trim() : null;          // DMA: 'NY' | 'FL'
  const location = typeof body.location === 'string' && body.location.trim() ? (body.location as string).trim() : null;
  // Declared HERE, above scope(), which uses it. The first version sat five lines below
  // and the used-before-declared guard caught it before it shipped — the fifth instance of
  // this exact shape, and the first one stopped before reaching production.
  const category = typeof body.category === 'string' && body.category.trim() ? (body.category as string).trim() : null;
  const rowLimit = Math.min(Number(body.limit || 1000), 25000);
  const scope = (q: any) => {
    let out = q;
    // Match EVERY spelling of the chosen DMA. Filtering on 'NY' alone missed every row
    // stored as 'NEW YORK', so the count dropped when a filter was applied and the filter
    // looked broken rather than the data looking dirty. SPEC-244: the filter value is a
    // Nielsen DMA code (legacy 'NY'/'FL' resolve to the code), and its spellings include
    // the NJ/CT rows that live inside the New York DMA.
    if (city) {
      const dmaCode = resolveDma(city);
      const spellings = dmaCode ? DMA_STATE_SPELLINGS[dmaCode] : [];
      out = out.in('state', spellings.length ? spellings : [city]);
    }
    if (location) out = out.eq('city', location);
    if (category) out = out.eq('service_type', category);
    return out;
  };
  // SPEC-229 — time window applies to every count on the console, not just the table.
  const sinceHours = Number(body.sinceHours || 0);
  const timed = (q: any) => (sinceHours > 0 ? q.gte('fetched_at', new Date(Date.now() - sinceHours * 36e5).toISOString()) : q);
  const svcQ = () => timed(scope(gdb.from('leads_services').select('id', { count: 'exact', head: true })));
  const creQ = () => timed(scope(gdb.from('leads_influencers').select('id', { count: 'exact', head: true })));

  // ── 1. QA: findings (bugs), recent runs, pass/fail
  const { data: findings } = await db.from('qa_findings').select('check_name, area, severity, status, count, detail, found_at, updated_at').order('updated_at', { ascending: false }).limit(100);
  const openBugs = (findings || []).filter((f: any) => f.status === 'open');
  const { data: qaRuns } = await db.from('agent_runs').select('agent, status, started_at, rows_written, raw_found, meta').in('agent', ['qa-suite','qa-live-verify']).order('started_at', { ascending: false }).limit(20);

  // ── 2. AGENTS: on/off proven by runs in last 24h
  const agents: Array<Record<string, unknown>> = [];
  for (const a of AGENTS) {
    const { count: c24 } = await db.from('agent_runs').select('id', { count: 'exact', head: true }).eq('agent', a).gte('started_at', since(24));
    const { data: last } = await db.from('agent_runs').select('started_at, status').eq('agent', a).order('started_at', { ascending: false }).limit(1);
    agents.push({ agent: a, runs24h: c24 ?? 0, live: (c24 ?? 0) > 0, last_run: last?.[0]?.started_at ?? null, last_status: last?.[0]?.status ?? null });
  }

  // ── 3. CRAWLS: per-source counts + job queue health
  const bySource: Record<string, number> = {};
  for (const s of SOURCES) { const { count } = await svcQ().eq('data_source', s); bySource[s] = count ?? 0; }
  // SPEC-233 — google_sponsored is MERGED INTO google_lsa, not shown beside it. Both read
  // the same Google local-ads inventory through the same SerpAPI call; sponsored was
  // retired in SPEC-222 and its 34 historical rows are real leads. Showing them as their
  // own row implies a source we still run. Folding them in keeps the leads and drops the
  // false impression.
  {
    const { count: sponsored } = await svcQ().eq('data_source', 'google_sponsored');
    if (sponsored) bySource['google_lsa'] = (bySource['google_lsa'] || 0) + sponsored;
  }
  // SPEC-239 — yelp is PAUSED by founder order, and the dashboard must SAY so on the
  // yelp row. Founder, 2026-08-02, verbatim: "ignore yelp as a source", then clarified
  // "don't delete yelp.. just pause as a source". Paused means KEPT: the source stays in
  // the code, the rota and this screen, and its rows are kept — it is simply out of
  // CRAWLS_ONLY until the founder re-activates it. Without this annotation an idle yelp
  // is indistinguishable from a broken yelp, its silence reads as a defect (the fleet
  // brief literally listed it as one), and a "defective" source is how real leads get
  // deleted as cleanup. The reason is data on the payload, not a tooltip in the UI, so
  // every consumer of this payload sees the same truth.
  const sourceStates: Record<string, { state: string; reason: string }> = {
    yelp: {
      state: 'paused',
      reason: "paused by founder order, 2026-08-02 — \"don't delete yelp.. just pause as a source\". Source and rows KEPT; out of CRAWLS_ONLY until the founder re-activates it.",
    },
  };
  const { data: jobs } = await gdb.from('crawl_requests').select('source, status, city, service_type, delivered_count, updated_at').order('updated_at', { ascending: false }).limit(200);
  const jobStats: Record<string, number> = {};
  for (const j of (jobs || [])) { const k = `${j.source || 'osm'}/${j.status}`; jobStats[k] = (jobStats[k] ?? 0) + 1; }
  // SPEC-235 — a zero here used to be indistinguishable from a failed query. The founder
  // saw "Services total 0" beside "NYC services 12,034" and had no way to tell which was
  // lying. The error now travels with the number.
  const { count: svcTotal, error: svcErr } = await svcQ();
  const { count: creTotal, error: creErr } = await creQ();
  const { count: svcNew24 } = await svcQ().gte('fetched_at', since(24));
  const countErrors: string[] = [];
  if (svcErr) countErrors.push(`services total: ${svcErr.message}`);
  if (creErr) countErrors.push(`creators total: ${creErr.message}`);

  // SPEC-243 — a source that stopped itself at the audit cap must SAY so on its row,
  // for the same reason yelp's pause travels on the payload: an idle source with no
  // visible reason reads as a BROKEN source, and a "broken" source invites the next
  // agent to "fix" a founder order. Same map as the fulfill-crawl claim gate, so the
  // scheduler and this screen cannot disagree. The count is UNSCOPED on purpose — the
  // cap is a fact about the source's whole table, and a state that flickered off under
  // a 6-hour time filter would read as a source coming back to life. A failed count
  // travels to the screen via countErrors (SPEC-235), never as a silent absence.
  // NOTE: this block sits BELOW the countErrors declaration by necessity, not style —
  // used-before-declared is this repo's four-outage trap.
  {
    const AUDIT_CAP = sourceAuditCap(Deno.env.get('SOURCE_AUDIT_CAP'));
    if (AUDIT_CAP > 0) {
      for (const [src, keys] of Object.entries(AUDIT_CAP_SOURCES)) {
        const { count: capCount, error: capErr } = await gdb.from('leads_services')
          .select('id', { count: 'exact', head: true }).in('data_source', keys);
        if (capErr) { countErrors.push(`audit-cap count ${src}: ${capErr.message}`); continue; }
        if ((capCount ?? 0) >= AUDIT_CAP && !sourceStates[src]) {
          sourceStates[src] = {
            state: 'audit-cap met',
            reason: `audit cap met — ${capCount} leads of ${AUDIT_CAP} max to review (founder, 2026-08-03: "add all sources not just creators to the crawl at 100 leads each max to review"). Stopped itself; awaiting founder audit of sample-100-${src}.csv (SPEC-243).`,
          };
        }
      }
    }
  }

  // ── 4. CREATORS per source (discovered_via) + contactability
  const creatorsBySource: Record<string, { total: number; withEmail: number; withFollowers: number; nyc: number; miami: number; what: string; where: string }> = {};
  for (const cs of CREATOR_SOURCES) {
    const q = (f: (b: any) => any) => f(creatorSourceMatch(creQ(), cs));
    const { count: total } = await q((b: any) => b);
    const { count: withEmail } = await q((b: any) => b.not('email', 'is', null));
    const { count: withFollowers } = await q((b: any) => b.not('followers', 'is', null));
    // SPEC-244: DMA membership by spelling set, never a single state equality — an NJ
    // creator inside the New York DMA counts toward NYC.
    const { count: nyc } = await q((b: any) => b.in('state', DMA_STATE_SPELLINGS['501']));
    const { count: miami } = await q((b: any) => b.in('state', DMA_STATE_SPELLINGS['528']));
    creatorsBySource[cs] = { total: total ?? 0, withEmail: withEmail ?? 0, withFollowers: withFollowers ?? 0, nyc: nyc ?? 0, miami: miami ?? 0,
                             what: CREATOR_SOURCE_META[cs]?.what || '', where: CREATOR_SOURCE_META[cs]?.where || '' };
  }

  // The founder saw "creator counts at zero" while CREATORS TOTAL was 4,211:
  // rows exist under discovered_via values NOT in CREATOR_SOURCES. Never let a
  // known-listed set silently hide real rows — report the actual values.
  const listedCreators = Object.values(creatorsBySource).reduce((a, b) => a + b.total, 0);
  let creatorsUnattributed: Record<string, number> = {};
  if ((creTotal ?? 0) > listedCreators) {
    const { data: dv } = await (city ? gdb.from('leads_influencers').select('discovered_via').eq('city', city) : gdb.from('leads_influencers').select('discovered_via')).limit(20000);
    for (const r of (dv || [])) {
      const k = (r as any).discovered_via || 'NULL';
      // prefix-aware: a dated run of a KNOWN algorithm is attributed, not orphaned
      if (!CREATOR_SOURCES.some(cs => k === cs || k.startsWith(cs))) creatorsUnattributed[k] = (creatorsUnattributed[k] || 0) + 1;
    }
  }

  // SPEC-235 (founder, 2026-08-02): "New York needs to be NYC.. why do we have connecticut
  // and CO.. we're only doing miami and new york city to start".
  //
  // The raw `state` column is DIRTY — NY, "NEW YORK", NJ, "NEW JERSEY", CT, CO all appear —
  // so deriving the list straight from it printed the same DMA twice under two spellings
  // and offered Colorado as somewhere we crawl. Two rules:
  //   1. CANONICALISE first: full names and casing collapse to one code.
  //   2. Only the AUTHORISED Phase-1 DMAs are offered. Anything else is an OFF-TARGET row,
  //      which is a data-quality finding, not a filter option.
  // SPEC-244: DMA_CANON is DERIVED from the one shared spelling table — a second
  // hand-written copy here is how two lists drift. Values are Nielsen DMA codes.
  const DMA_CANON: Record<string, string> = Object.fromEntries(
    Object.entries(DMA_STATE_SPELLINGS).flatMap(([code, ss]) => ss.map((s) => [s, code])),
  );
  const DMA_NAMES: Record<string, string> = Object.fromEntries(
    Object.entries(DMAS).map(([code, d]) => [code, d.name]),
  );
  const dmaCounts: Record<string, number> = {};
  const offScope: Record<string, number> = {};
  try {
    // Membership is decided by LOCATION first (LOCATION_DMA — Jersey City is an NJ row
    // inside the New York DMA), then by state spelling. Only a row matching neither is
    // an off-target finding — keyed on DMA membership, not on the state column.
    const { data: dl } = await gdb.from('leads_services').select('state, city').limit(20000);
    for (const r of (dl || [])) {
      const raw = String((r as any).state ?? '').trim().toUpperCase();
      const loc = String((r as any).city ?? '').trim();
      const code = LOCATION_DMA[loc] ?? (raw ? DMA_CANON[raw] : undefined);
      if (code) dmaCounts[code] = (dmaCounts[code] || 0) + 1;
      else if (raw) offScope[raw] = (offScope[raw] || 0) + 1;
    }
  } catch (_e) {}
  // CATEGORY (service type) facet, scoped to the current DMA + location.
  const categoryCounts: Record<string, number> = {};
  try {
    let cq2 = gdb.from('leads_services').select('service_type, state, city').limit(20000);
    if (city) { const d = resolveDma(city); cq2 = d ? cq2.in('state', DMA_STATE_SPELLINGS[d]) : cq2.eq('state', city); }
    if (location) cq2 = cq2.eq('city', location);
    const { data: ct } = await cq2;
    for (const r of (ct || [])) { const k = String((r as any).service_type ?? '').trim(); if (k) categoryCounts[k] = (categoryCounts[k] || 0) + 1; }
  } catch (_e) {}

  const dmas: Record<string, string> = {};
  for (const [code] of Object.entries(dmaCounts).sort((a, b) => b[1] - a[1])) dmas[code] = DMA_NAMES[code];

  // LOCATION LIST, scoped to the selected DMA and NORMALISED. The raw column holds
  // "Astoria", "ASTORIA", "Astoria " and " Brooklyn" as four different values, so the
  // dropdown showed the same place four times with the count split between them. Trim,
  // collapse inner whitespace, and title-case for display while keeping the variants
  // grouped under one entry.
  const locations: Record<string, number> = {};
  try {
    let lq = gdb.from('leads_services').select('city, state').limit(20000);
    if (city) { const d = resolveDma(city); lq = d ? lq.in('state', DMA_STATE_SPELLINGS[d]) : lq.eq('state', city); }
    const { data: cl } = await lq;
    for (const r of (cl || [])) {
      const raw = String((r as any).city ?? '').trim().replace(/\s+/g, ' ');
      if (!raw || raw.length < 2) continue;
      // Junk the crawler occasionally produces: "bellmore .. 1", "Bergen country".
      if (/\d/.test(raw) || /\.\./.test(raw)) continue;
      const key = raw.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
      locations[key] = (locations[key] || 0) + 1;
    }
  } catch (_e) {}

  // ── 5. LIVE COUNTER
  //
  // SPEC-231 — THESE IGNORED EVERY FILTER. They were four hardcoded queries built straight
  // off the table, bypassing the city, location and time helpers entirely — which is why
  // selecting "4 weeks" changed nothing on the numbers the founder actually reads. A
  // filter that visibly does nothing is worse than no filter: it makes the page look
  // wrong and hides the fact that the data behind it is fine.
  // SPEC-244: the counter is keyed by DMA code and matches every spelling in the DMA
  // (NJ/CT rows inside the New York DMA count toward it) — a single state equality here
  // is the state-as-DMA proxy the founder corrected.
  const dmaCount = async (dmaCode: string, table: string) => {
    let q = gdb.from(table).select('id', { count: 'exact', head: true }).in('state', DMA_STATE_SPELLINGS[dmaCode] || []);
    if (location) q = q.eq('city', location);
    if (sinceHours > 0) q = q.gte(table === 'leads_services' ? 'fetched_at' : 'created_at', new Date(Date.now() - sinceHours * 36e5).toISOString());
    const { count } = await q;
    return count ?? 0;
  };
  const nycSvc = await dmaCount('501', 'leads_services');
  const miaSvc = await dmaCount('528', 'leads_services');
  const nycCre = await dmaCount('501', 'leads_influencers');
  const miaCre = await dmaCount('528', 'leads_influencers');
  // Targets come from the committed founder quota map (keys are DMA codes, SPEC-240/244).
  // The literal fallback repeats the founder numbers gate #207 pins — the screen showed
  // miami_target 20,000 for a while, a number the founder never set.
  let quotaMap: Record<string, number> = { '501': 50000, '528': 11700 };
  try {
    const j = JSON.parse(Deno.env.get('PHASE1_CITY_QUOTA') || '');
    if (j && typeof j === 'object' && !Array.isArray(j) && Object.keys(j).length) quotaMap = j;
  } catch (_e) { /* keep the pinned fallback */ }
  const counter = { nyc_services: nycSvc, nyc_target: quotaMap['501'] ?? 50000, miami_services: miaSvc, miami_target: quotaMap['528'] ?? 11700,
                    nyc_creators: nycCre, miami_creators: miaCre, services_new_24h: svcNew24 ?? 0 };

  // latest supply-engine run (bugs found + auto-fixes)
  let engine: unknown = null;
  try { const { data } = await db.from('agent_runs').select('meta, started_at, status').eq('agent','supply-engine').order('started_at',{ascending:false}).limit(1); engine = data?.[0] ?? null; } catch (_e) {}

  // DOWNLOAD is OPT-IN (fix 2026-07-29): loading 15 sources x 2000 rows on every
  // page load timed out the function -> the console showed "non-2xx status code".
  // The UI now requests ONE source at a time via { download: "<kind>:<key>" }.
  const download: Record<string, unknown[]> = {};
  const wantDl = typeof body.download === 'string' ? body.download as string : null;
  if (wantDl) {
    const [kind, ...rest] = wantDl.split(':');
    const key = rest.join(':');
    if (kind === 'services') {
      let q = gdb.from('leads_services')
        .select('name, service_type, phone, owner_email, instagram, city, state, data_source, outreach_status')
        .eq('data_source', key);
      if (city) q = q.eq('city', city);           // the CSV must match the filtered view
      const { data } = await q.limit(5000);
      download[wantDl] = data || [];
    } else if (kind === 'creators') {
      let q = gdb.from('leads_influencers')
        .select('ig_handle, display_name, category, followers, email, phone, city, state, discovered_via, outreach_status')
        .like('discovered_via', `${key}%`);   // prefix: include every dated run of this algorithm
      if (city) q = q.eq('city', city);
      const { data } = await q.limit(5000);
      download[wantDl] = data || [];
    }
  }

  const { count: profiles } = await db.from('profiles').select('id', { count: 'exact', head: true });
  let withAvatar = 0, connections = 0, services = 0, requests = 0, bookings = 0, bookings_all = 0, bookings_completed = 0, bookings_paid = 0;
  try { const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).not('avatar_url','is',null); withAvatar = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('connections').select('id', { count: 'exact', head: true }); connections = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('services').select('id', { count: 'exact', head: true }); services = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('requests').select('id', { count: 'exact', head: true }); requests = count ?? 0; } catch (_e) {}
  // Headline `bookings` KPI = REAL bookings only: non-seed AND status='completed'.
  // WHY (SPEC-107 — audit check `bookings_kpi_includes_test_rows`, critical): the raw
  // table count counts QA seed rows plus pending/confirmed placeholders, inflating
  // an INVESTOR-FACING number (was 53 headline vs 1 real completed). The headline
  // must only ever count completed, non-seed bookings. Raw total kept as
  // `bookings_all` for internal ops visibility (never surfaced as the headline).
  try { const { count } = await db.from('bookings').select('id', { count: 'exact', head: true }); bookings_all = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('bookings').select('id', { count: 'exact', head: true }).not('seed','is',true).eq('status','completed'); bookings_completed = count ?? 0; } catch (_e) {}
  // HEADLINE bookings = the honest PROOF metric: non-seed, completed, AND between DISTINCT
  // PARTIES (consumer_id !== provider_id). SPEC-107c (audit run124): the loop's proof is that
  // ONE person paid/completed ANOTHER person's service. A self-booking (a provider completing
  // their own listing during testing) proves NO marketplace loop, so it must NEVER count as the
  // headline — it inflated the investor number to 6 completed vs 1 real distinct-party. PostgREST
  // cannot compare two columns, so fetch the (tiny) completed non-seed set and count in JS.
  // bookings_paid is surfaced alongside (0 in the free-first cohort, by design) so the auditor
  // sees paid vs completed without either inflating the headline.
  try {
    const { data: rows } = await db.from('bookings').select('consumer_id, provider_id, paid_at').not('seed','is',true).eq('status','completed');
    const real = (rows || []).filter((b) => b.consumer_id && b.provider_id && b.consumer_id !== b.provider_id);
    bookings = real.length;
    bookings_paid = real.filter((b) => b.paid_at).length;
  } catch (_e) {}

  return {
    generated_at: new Date().toISOString(),
    served_by: 'shared',
    qa: { open_bugs: openBugs.length, findings: findings || [], recent_runs: qaRuns || [] },
    agents,
    crawls: { count_errors: countErrors, off_scope_states: offScope, by_source: bySource, source_states: sourceStates, job_stats: jobStats, services_total: svcTotal ?? 0, creators_total: creTotal ?? 0, services_new_24h: svcNew24 ?? 0, recent_jobs: (jobs || []).slice(0, 40) },
    product: { profiles: profiles ?? 0, with_avatar: withAvatar, connections, services, requests, bookings, bookings_all, bookings_completed, bookings_paid },
    counter, creatorsBySource, creatorsUnattributed, engine, download,
    filter: {
      city, location, sinceHours, category, limit: rowLimit,
      categories: Object.fromEntries(Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 200)),
      // SPEC-231 — DMAs come FROM THE DATA. Hardcoding two meant a third DMA would be
      // crawled and never appear in the filter, so its rows would be invisible on the one
      // screen meant to prove what we have. Known codes get their proper name; anything
      // else is shown by its code rather than dropped.
      cities: dmas,
      locations: Object.fromEntries(Object.entries(locations).sort((a, b) => b[1] - a[1]).slice(0, 200)),
    },
    creators_listed_total: listedCreators, creators_total: creTotal ?? 0,
  };
}
