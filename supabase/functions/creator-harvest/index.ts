// Supabase Edge Function — FREE creator harvester (zero Mac, zero paid API).
//
// Discovers on-values greater-Miami creators via keyless web search (DuckDuckGo
// HTML endpoint), extracts a public email/phone from result snippets or the
// creator's OWN link-in-bio / website (third-party public sites — NOT Meta's
// property, same clean-room rule as enrich-influencers), and inserts them into
// leads_influencers as 'new'. Then runs the creator gate so reachable, on-values
// creators become 'queued' (sendable). Runs on pg_cron via cergio_call_edge —
// no Mac, no key. Reversible: everything tagged discovered_via='se:web-harvest'.
//
// SPEC-264 — v2 (FOUNDER, 2026-08-06, verbatim, both orders): "I'm showing 0
// progress on creators.. . use same solution for IG services for IG creators (by
// running seaches direct based on spec (top 25 micro and mid parenting, pets, etc
// influncers in nyc miami etc..)... augment the IG services solution with more
// emails and phones by carawling their websites (email is easily visible there in
// most).. also crawl the # of followers so we rank..... use same stategy for
// creators... run creators now .. it's a free staregy.. need to see initial 100 to
// tweak..." and, overriding any paid path: "NO... for creators we're doing the
// same IG FREE web crawling staretgy we're using for IG services... (it's
// working!)....correct and upgrade with above and ship get 100 from each — not
// paid! IG .."
//
// MEASURED defect that zeroed v1: the CREATOR_TARGET self-stop counted the
// like('se:web-harvest%') prefix over ALL TIME. The table holds ~4,211 rows under
// the June/July daily tags (in-tree: opsPayload "CREATORS TOTAL was 4,211"; gate
// #220's "0 rows beside a real total of 4,211") — 4,211 >= 100, so EVERY
// invocation returned { paused: true } at the top of the handler, before any
// search, while the board's FRESH count (AUDIT_FRESH_SINCE) read 0/100: the
// founder's "0 progress on creators", verbatim. v2 windows the self-stop and the
// per-(category × metro) caps by the SAME committed freshness instant the audit
// cap uses (SPEC-246 — "100 FRESH peices of DATA"), keeps the prefix like(), and
// re-asserts the */15 cron in its migration (belt and braces — board snapshots
// showed agent_runs: [] beside a correct-looking final schedule).
//
// AUTH: service-role bearer only (cron).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb, growthEnvPresent } from '../_shared/growthDb.ts';
import { CREATOR_CATEGORIES, CREATOR_CAT_CAP, auditFreshSince } from '../_shared/opsPayload.ts';

// On-values creator niches (category is chosen to pass cergio_grade_creators).
// BLOCKED (never harvested — MEMORY: mobile_first_positioning + no-values guard):
// massage, tattoo, makeup, personal chef, plus SHAFT (sex/hate/alcohol/firearms/
// tobacco/gambling/adult/DJ-nightlife/plastic surgery/drugs). Do NOT re-add them.
// SPEC-245 — THE FOUNDER'S TIERED CREATOR CATEGORIES (2026-08-02, recorded verbatim in
// specs/CERGIO-CRAWL-LISTS.md — the source of truth; this is its encoding).
// Tier order is crawl priority. Search-based discovery has no queue to "exhaust", so
// priority is encoded as each run's QUERY BUDGET per tier (see TIER_BUDGET below) with
// rotation WITHIN each tier for coverage across runs. The founder marked `nightlife`
// BLOCKED for creators — deliberately absent. The legacy niches (last tier) keep their
// original category tags because pending_review rows already carry them: dropping a
// legacy category from the target list would hand those rows to the SPEC-86b
// quarantine. PHASE 3 list is FORTHCOMING from the founder — do not invent it.
const NICHE_TIERS: Array<Array<{ q: string; category: string }>> = [
  [ // Tier 1 — founder order: pets, parenting, fitness, home, beauty, local city life
    { q: 'pet influencer',              category: 'pets' },
    { q: 'dog influencer',              category: 'pets' },
    { q: 'parenting influencer',        category: 'parenting' },
    { q: 'mom influencer',              category: 'parenting' },
    { q: 'family content creator',      category: 'parenting' },
    { q: 'fitness influencer',          category: 'fitness' },
    { q: 'fitness content creator',     category: 'fitness' },
    { q: 'home decor influencer',       category: 'home' },
    { q: 'interior design creator',     category: 'home' },
    { q: 'beauty influencer',           category: 'beauty' },
    { q: 'skincare influencer',         category: 'beauty' },
    { q: 'city life content creator',   category: 'local city life' },
    { q: 'local lifestyle creator',     category: 'local city life' },
  ],
  [ // Tier 2 — food, wellness, style, photography, events, neighbourhood accounts
    { q: 'food content creator',        category: 'food' },
    { q: 'local food influencer',       category: 'food' },
    { q: 'wellness influencer',         category: 'wellness' },
    { q: 'self care creator',           category: 'wellness' },
    { q: 'style content creator',       category: 'style' },
    { q: 'personal style influencer',   category: 'style' },
    { q: 'photography content creator', category: 'photography' },
    { q: 'events content creator',      category: 'events' },
    { q: 'neighbourhood account',       category: 'neighbourhood accounts' },
    { q: 'neighborhood community account', category: 'neighbourhood accounts' },
  ],
  [ // Tier 3 — full ontology, founder order, `nightlife` BLOCKED and absent
    { q: 'dog breed content creator',   category: 'dog breeds — specific' },
    { q: 'cat content creator',         category: 'cat owners' },
    { q: 'small pets creator',          category: 'small pets and exotics' },
    { q: 'new mum creator',             category: 'new mums' },
    { q: 'dad content creator',         category: 'dads' },
    { q: 'toddler activities creator',  category: 'toddler activities' },
    { q: 'school age parenting creator', category: 'school-age parenting' },
    { q: 'special needs parenting creator', category: 'special needs parenting' },
    { q: 'home workout creator',        category: 'home workouts' },
    { q: 'running content creator',     category: 'running' },
    { q: 'cycling content creator',     category: 'cycling' },
    { q: 'yoga content creator',        category: 'yoga' },
    { q: 'pilates content creator',     category: 'pilates' },
    { q: 'strength training creator',   category: 'strength training' },
    { q: 'marathon endurance creator',  category: 'marathon and endurance' },
    { q: 'meal prep content creator',   category: 'nutrition and meal prep' },
    { q: 'plant based content creator', category: 'plant-based' },
    { q: 'supplements content creator', category: 'supplements' },
    { q: 'mindfulness content creator', category: 'mental health and mindfulness' },
    { q: 'sleep recovery creator',      category: 'sleep and recovery' },
    { q: 'home renovation creator',     category: 'home renovation' },
    { q: 'interiors content creator',   category: 'interiors' },
    { q: 'small space living creator',  category: 'small space living' },
    { q: 'first apartment creator',     category: 'rentals and first apartments' },
    { q: 'decluttering content creator', category: 'organisation and decluttering' },
    { q: 'cleaning content creator',    category: 'cleaning' },
    { q: 'DIY repair content creator',  category: 'DIY and repair' },
    { q: 'plant care content creator',  category: 'gardening and plants' },
    { q: 'skincare content creator',    category: 'skincare' },
    { q: 'haircare content creator',    category: 'haircare' },
    { q: 'natural hair creator',        category: 'natural hair' },
    { q: 'nail content creator',        category: 'nails' },
    { q: 'lash and brow creator',       category: 'lashes and brows' },
    { q: 'mens grooming creator',       category: 'mens grooming' },
    { q: 'thrift fashion creator',      category: 'fashion and thrift' },
    { q: 'sustainable living creator',  category: 'sustainable living' },
    { q: 'budget living creator',       category: 'budget living' },
    { q: 'local restaurant creator',    category: 'local food and restaurants' },
    { q: 'coffee content creator',      category: 'coffee' },
    { q: 'things to do creator',        category: 'events and things to do' },
    { q: 'neighbourhood guide creator', category: 'neighbourhood guides' },
    { q: 'moving to the city creator',  category: 'moving to the city' },
    { q: 'newcomer content creator',    category: 'expat and newcomer' },
    { q: 'student life creator',        category: 'student life' },
    { q: 'dating social content creator', category: 'dating and social' },
    { q: 'wedding influencer',          category: 'weddings' },
    { q: 'baby shower party creator',   category: 'baby showers and parties' },
    { q: 'content photography creator', category: 'photography and content' },
    { q: 'videography content creator', category: 'videography' },
    { q: 'side hustle creator',         category: 'side hustle and freelance' },
    { q: 'small business owner creator', category: 'small business owners' },
    { q: 'real estate influencer',      category: 'real estate' },
    { q: 'car content creator',         category: 'cars' },
    { q: 'local weekend travel creator', category: 'travel — local weekends' },
    { q: 'beach outdoors creator',      category: 'beaches and outdoors' },
    { q: 'sports fan content creator',  category: 'sports fans' },
    { q: 'pet rescue adoption creator', category: 'pet rescue and adoption' },
  ],
  [ // Legacy niches — kept LAST so existing pending_review rows keep a valid category
    { q: 'health influencer',           category: 'health' },
    { q: 'healthy living creator',      category: 'health' },
    { q: 'nutrition influencer',        category: 'nutrition' },
    { q: 'dietitian content creator',   category: 'nutrition' },
    { q: 'bride content creator',       category: 'weddings' },
    { q: 'realtor content creator',     category: 'real estate' },
    { q: 'fashion influencer',          category: 'fashion' },
    { q: 'lifestyle influencer',        category: 'lifestyle' },
    { q: 'lifestyle blogger',           category: 'lifestyle' },
    { q: 'shopping influencer',         category: 'shopping' },
    { q: 'fashion haul creator',        category: 'shopping' },
    { q: 'car influencer',              category: 'auto' },
    { q: 'auto content creator',        category: 'auto' },
  ],
];
// Each run's query budget per tier, in tier order (sums to MAX_QUERIES). Tier 1 gets
// half of every run — the founder's "crawl first" — while lower tiers keep enough
// share that coverage still advances across runs.
const TIER_BUDGET = [24, 12, 8, 4];
const NICHES: Array<{ q: string; category: string }> = NICHE_TIERS.flat();
// NYC + Miami dual-metro geo set (SPEC-86 expansion): accumulate BOTH cities
// toward ~200 each. cityVerified() gates every hit to the creator's own text, so
// a Miami query that surfaces an LA/Utah handle is dropped — geo stays honest.
const CITIES = [
  // New York
  'New York', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'New York City',
  'Williamsburg', 'Bushwick', 'Harlem', 'Astoria', 'Long Island City',
  'Park Slope', 'Lower East Side', 'Upper East Side', 'SoHo', 'Greenpoint',
  // Miami
  'Miami', 'Miami Beach', 'Brickell', 'Wynwood', 'Coral Gables', 'Doral',
  'South Beach', 'Coconut Grove', 'Aventura', 'Little Havana', 'Hialeah',
  'Fort Lauderdale', 'North Miami', 'Kendall', 'Pinecrest'];
// Query-shape modifiers — each rotates independently so the SAME niche×city can
// still surface NEW handles run-to-run instead of repeating one rigid phrasing.
// {c} = city, {n} = niche query.
const MODIFIERS = [
  '{c} {n} instagram',
  'top {c} {n} instagram',
  'top 25 {c} {n} to follow',
  'best {c} {n} instagram to follow',
  '{c} {n} instagram collab email',
  '{c} {n} instagram partnerships email',
  '{c} micro influencer {n} instagram',
  '{c} {n} linktr.ee email',
  '{c} {n} instagram gmail.com',
  '{c} based {n} instagram',
]

const MAX_QUERIES   = 48;   // high-volume discovery — target 1000+ new/day across continuous runs
const MAX_SITEFETCH = 120;  // bounded external fetches for email mining (was 60 — SPEC-265 budget grew)
// SPEC-265 — the founder's "100X SPEED via parallel crawlers", free lane. The v2 run
// was strictly sequential: ~6-10 of its 48 queries fit inside 50s. A pool of
// HARVEST_POOL concurrent query processors inside a ~120s budget (edge wall allows
// ~150s) completes the WHOLE 48-query slice. Pool kept deliberately MODEST — DDG
// bot-walls are the measured risk of this source, and a burst from one egress IP is
// how you earn one; the lite.duckduckgo.com fallback stays the second chance.
// Cron cadence never stacks runs: 120s « the lane stagger (see the SPEC-265 migration).
const HARVEST_POOL  = 4;
const DEADLINE_MS   = 120000;
// SPEC-264 — the founder's "nyc miami" is METRO-level. Spelled 'New York'/'Miami'
// (never 'NYC') because CITY_STATE, CITY_ALIASES and the .eq('city') cap counts
// all key on these spellings — a 'NYC' literal would write state=null rows and
// geo-verify against nothing.
const HARVEST_METROS = ['New York', 'Miami'];

// ── QUALITY GATE HELPERS (SPEC-86, 2026-07-18) — enforce the frozen creator bar:
//    verified geo only, individual (not business), NO fabricated fields. ──
const CITY_STATE: Record<string, string> = {
  'New York': 'NY', 'Brooklyn': 'NY', 'Manhattan': 'NY', 'Queens': 'NY', 'Bronx': 'NY',
  'New York City': 'NY', 'Williamsburg': 'NY', 'Bushwick': 'NY', 'Harlem': 'NY', 'Astoria': 'NY', 'Long Island City': 'NY', 'Park Slope': 'NY', 'Lower East Side': 'NY', 'Upper East Side': 'NY', 'SoHo': 'NY', 'Chelsea NYC': 'NY', 'Greenpoint': 'NY', 'Flushing': 'NY', 'Jackson Heights': 'NY', 'Staten Island': 'NY',
  'Miami Beach': 'FL', 'Brickell': 'FL', 'Wynwood': 'FL', 'Coral Gables': 'FL', 'Doral': 'FL', 'South Beach': 'FL', 'Coconut Grove': 'FL', 'Aventura': 'FL', 'Little Havana': 'FL', 'Hialeah': 'FL', 'North Miami': 'FL', 'Kendall': 'FL', 'Pinecrest': 'FL',
  'Miami': 'FL', 'Fort Lauderdale': 'FL', 'Los Angeles': 'CA', 'Chicago': 'IL',
  'Atlanta': 'GA', 'Washington': 'DC', 'San Francisco': 'CA', 'Boston': 'MA',
  'Philadelphia': 'PA', 'Dallas': 'TX', 'Houston': 'TX',
};
const CITY_ALIASES: Record<string, string[]> = {
  'New York': ['new york', 'nyc', 'brooklyn', 'manhattan', 'queens', 'bronx', 'new york city'],
  'New York City': ['new york', 'nyc', 'new york city'],
  'Williamsburg': ['new york', 'nyc', 'williamsburg'],
  'Bushwick': ['new york', 'nyc', 'bushwick'],
  'Harlem': ['new york', 'nyc', 'harlem'],
  'Astoria': ['new york', 'nyc', 'astoria'],
  'Long Island City': ['new york', 'nyc', 'long island city'],
  'Park Slope': ['new york', 'nyc', 'park slope'],
  'Lower East Side': ['new york', 'nyc', 'lower east side'],
  'Upper East Side': ['new york', 'nyc', 'upper east side'],
  'SoHo': ['new york', 'nyc', 'soho'],
  'Chelsea NYC': ['new york', 'nyc', 'chelsea'],
  'Greenpoint': ['new york', 'nyc', 'greenpoint'],
  'Flushing': ['new york', 'nyc', 'flushing'],
  'Jackson Heights': ['new york', 'nyc', 'jackson heights'],
  'Staten Island': ['new york', 'nyc', 'staten island'],
  'Miami': ['miami', 'brickell', 'wynwood', 'coral gables', 'south beach', 'miami beach', 'doral'],
  'Miami Beach': ['miami', 'miami beach', 'south florida', 'miami beach'],
  'Brickell': ['miami', 'miami beach', 'south florida', 'brickell'],
  'Wynwood': ['miami', 'miami beach', 'south florida', 'wynwood'],
  'Coral Gables': ['miami', 'miami beach', 'south florida', 'coral gables'],
  'Doral': ['miami', 'miami beach', 'south florida', 'doral'],
  'South Beach': ['miami', 'miami beach', 'south florida', 'south beach'],
  'Coconut Grove': ['miami', 'miami beach', 'south florida', 'coconut grove'],
  'Aventura': ['miami', 'miami beach', 'south florida', 'aventura'],
  'Little Havana': ['miami', 'miami beach', 'south florida', 'little havana'],
  'Hialeah': ['miami', 'miami beach', 'south florida', 'hialeah'],
  'Fort Lauderdale': ['miami', 'miami beach', 'south florida', 'fort lauderdale'],
  'North Miami': ['miami', 'miami beach', 'south florida', 'north miami'],
  'Kendall': ['miami', 'miami beach', 'south florida', 'kendall'],
  'Pinecrest': ['miami', 'miami beach', 'south florida', 'pinecrest'],
};
/** Geo is set ONLY when the creator's own text names the target city/area — kills
 *  the Utah-labeled-Miami class. If unverifiable, the row is dropped (never guessed). */
function cityVerified(city: string, text: string): boolean {
  const t = (text || '').toLowerCase();
  const al = CITY_ALIASES[city] || [city.toLowerCase()];
  return al.some((a) => t.includes(a));
}
/** Drop obvious business/brand accounts — kills the business-as-creator class. */
function isBusinessLike(handle: string, title: string): boolean {
  const s = `${handle} ${title}`.toLowerCase();
  return /(studio|salon|\bspa\b|clinic|official|boutique|\bco\b|\binc\b|\bllc\b|academy|\bagency\b|\bshop\b|\bstore\b|\bteam\b|\bhq\b|\bgroup\b|\bcompany\b|\bbrand\b)/.test(s);
}

// BLOCKED CONTENT guard (SPEC-86c, Forensic 2026-07-20): medical-aesthetic /
// medspa / injectable / laser / clinic accounts were slipping into the sendable
// pool tagged category 'beauty' (is_business=false), because isBusinessLike only
// scans handle+title and lacks medical terms. These are off-spec blocked
// categories (mobile_first_positioning: plastic surgery / med-spa). This scans
// handle+title+url+snippet for medical-aesthetic + SHAFT signals and is applied
// BOTH at the source (skip on harvest) and in the server-side self-heal cleanup
// (quarantine existing pending_review rows every cron tick — no Mac needed).
const BLOCKED_CONTENT_RE =
  /(med[\s.-]?spa|medi[\s.-]?spa|med[\s.-]?aesthetic|medical aesthetic|\baesthetics\b|\blaser\b|botox|filler|injectable|microneedl|dermatolog|plastic surg|liposuction|\bbbl\b|rejuven|iv[\s.-]?therapy|hormone|wellness ?center|health ?center|tattoo|\bvape\b|hookah|nightclub|casino|firearm)/i;
function isBlockedContent(...parts: Array<string | null | undefined>): boolean {
  return BLOCKED_CONTENT_RE.test(parts.filter(Boolean).join(' ').toLowerCase());
}

serve(async (req: Request) => {

// ── SPEC-132: GROWTH TABLES LIVE IN THE GROWTH PROJECT ─────────────────────
// crawl_requests / leads_services / leads_influencers are read+written on the
// SEPARATE growth database. The product DB keeps auth, profiles, services,
// requests, bookings — and agent_runs / qa_findings so the ops console and the
// watchdog keep working unchanged.
//
// Two projects = two connection pools. On 2026-07-30 background crawling
// saturated the product pool (/rest/v1/services -> 503 while /auth/v1/user -> 200)
// and the founder could not sign in or list a service. That is now physically
// impossible rather than a matter of restraint.
//
// If the growth env is absent we FAIL LOUD — a silent fallback to the product DB
// would recreate exactly that outage.
const gdb = growthDb();
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let stage = 'init';
  const dbg = { raw_results: 0, queries_with_results: 0, first_urls: [] as string[] };
  // SPEC-268 — per-engine {tried,got} for THIS run; written to agent_runs.meta.engines
  // so "which search transport works from the edge" is a measured fact on every tick.
  const engineTally: Record<string, { tried: number; got: number }> = {};
  let dbRef: any = null;   // hoisted so the catch can log an agent_runs error row
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);

    // ── SPEC-269 — CI SEARCH RELAY MODES. MEASURED chain: from the edge egress
    // ALL FOUR keyless engines wall (meta.engines, live), while search-probe #1
    // showed ddg-html SERVES GitHub runner IPs (HTTP 200, 10 result__a blocks).
    // Same code, same query — only the IP decides. So the SEARCH leg may run in
    // CI: 'queries' returns the run's built slice (after every kill-switch and
    // cap below), 'ingest' runs the UNMODIFIED extraction/gates/dedupe/upsert
    // pipeline over results the relay posts back. Extraction truth stays HERE,
    // single-copy (the #204 lesson) — CI carries transport, never judgment.
    // Auth above runs FIRST: both modes are service-bearer-only, like the cron.
    const reqBody = req.method === 'POST' ? await req.json().catch(() => ({} as any)) : ({} as any);
    const MODE: 'crawl' | 'queries' | 'ingest' =
      reqBody?.mode === 'queries' ? 'queries' : reqBody?.mode === 'ingest' ? 'ingest' : 'crawl';

    // ── SPEC-237: THE ACTIVATION CONTRACT, ENFORCED HERE — founder, 2026-08-02:
    // "activate the crawls just for the creator sources to get 100 of each then
    // pause alongside the rest to audit."
    //
    // (a) The committed kill-switch (growth-controls.json) covers this function.
    //     Until now creator-harvest read NO control at all, so "are we crawling?"
    //     had a different answer for this source than for the other eight. It
    //     defaults to SUSPENDED, so a missing env fails CLOSED — refusing costs
    //     nothing (the same rule that gates fulfill-crawl).
    // (b) The target stops the source ITSELF. "Get 100 then pause" cannot depend
    //     on someone watching a dashboard — that is how a $1 tranche became $108.
    //     Rows are counted by PREFIX: se:web-harvest is stamped per run day, and
    //     an eq() on the bare name once reported 0 beside a real total of 4,211.
    const SUSPENDED = (Deno.env.get('CRAWLS_SUSPENDED') || 'true').toLowerCase() !== 'false';
    const ONLY = (Deno.env.get('CRAWLS_ONLY') || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (SUSPENDED || (ONLY.length > 0 && !ONLY.includes('se:web-harvest'))) {
      const reason = SUSPENDED
        ? 'CRAWLS_SUSPENDED — growth-controls.json is the committed switch'
        : 'se:web-harvest is not in CRAWLS_ONLY — growth-controls.json is the committed allowlist';
      await logAgentRun(db, 'creator-harvest', {
        started, raw_found: 0, rows_written: 0, status: 'ok',
        meta: { suspended: true, reason },
      });
      return json({ ok: true, suspended: true, reason });
    }
    const CREATOR_TARGET = Number(Deno.env.get('CREATOR_TARGET') || 100);
    // SPEC-264 — THE MEASURED DEFECT LIVED ON THE NEXT QUERY. Unwindowed, this
    // prefix count reads the ~4,211 June/July rows, decides 4,211 >= 100, and the
    // worker pauses itself on every tick — "0 progress on creators" beside a
    // target it believes it met weeks ago. The window is the SAME committed
    // freshness instant the audit cap and the board already use (SPEC-246,
    // AUDIT_FRESH_SINCE): the founder is owed 100 FRESH rows, so the stop counts
    // fresh rows. The like() prefix stays EXACTLY (SPEC-237: per-run-day tags;
    // an eq() reads 0 beside real rows). Unparseable instant → epoch → counts
    // everything → stops sooner: fail-closed, refusing costs nothing.
    const HARVEST_FRESH = auditFreshSince(Deno.env.get('AUDIT_FRESH_SINCE')) ?? '1970-01-01T00:00:00Z';
    if (CREATOR_TARGET > 0) {
      const { count: harvested, error: cntErr } = await gdb.from('leads_influencers')
        .select('id', { count: 'exact', head: true })
        .like('discovered_via', 'se:web-harvest%')
        .gte('fetched_at', HARVEST_FRESH);
      // If the target cannot be READ, refuse to crawl — refusing costs nothing.
      if (cntErr) {
        await logAgentRun(db, 'creator-harvest', {
          started, raw_found: 0, rows_written: 0, status: 'error',
          error: `target unreadable — refusing to crawl: ${serr(cntErr)}`, meta: { stage: 'target-check' },
        });
        return json({ error: `target unreadable — refusing to crawl: ${serr(cntErr)}` }, 500);
      }
      if ((harvested ?? 0) >= CREATOR_TARGET) {
        const reason = `creator target met — ${harvested} of ${CREATOR_TARGET} FRESH (since ${HARVEST_FRESH}) from se:web-harvest (prefix). Paused for audit alongside the rest (founder, 2026-08-02; freshness window SPEC-264).`;
        await logAgentRun(db, 'creator-harvest', {
          started, raw_found: 0, rows_written: 0, status: 'ok',
          meta: { target_met: true, harvested, target: CREATOR_TARGET, reason },
        });
        return json({ ok: true, paused: true, reason });
      }
    }

    // ── ONE-TIME SELF-HEALING CLEANUP (SPEC-86b): the earlier harvest pulled
    // bookable SERVICE providers (photographers, lash techs, event planners), not
    // influencers. Quarantine every pending_review row whose category is NOT one of
    // the 14 target influencer categories — EXCEPT the Modash-vetted seeds, which
    // are protected by discovered_via and kept no matter their legacy category tag.
    // Runs server-side on the cron tick (no Mac); harmless once the pool is clean.
    // SPEC-245 — DERIVED from the niches, never hand-written: the trap here is adding
    // a niche whose category is missing from this list, at which point this cleanup
    // quarantines every row that niche harvests, silently, forever. Deriving makes
    // that impossible — a category is targetable exactly when some niche harvests it.
    const TARGET_CATEGORIES = [...new Set(NICHES.map((n) => n.category))];
    try {
      const inList = '(' + TARGET_CATEGORIES.map((c) => '"' + c + '"').join(',') + ')';
      const { data: q } = await gdb.from('leads_influencers')
        .update({ outreach_status: 'do_not_contact' })
        .eq('outreach_status', 'pending_review')
        .neq('discovered_via', 'modash-vetted-seed')
        .not('category', 'in', inList)
        .select('id');
      if (q && q.length) console.log(`cleanup: quarantined ${q.length} off-target service-type rows`);
    } catch (_e) { /* cleanup is best-effort; never blocks a harvest run */ }

    // SELF-HEAL (SPEC-86c): quarantine any pending_review row that is a blocked
    // medical-aesthetic / med-spa / SHAFT account (matched on url/handle/name/bio).
    // Server-side, runs on the cron tick — closes the leak with zero Mac clicks.
    // Modash-vetted seeds are protected.
    try {
      // KEEP IN SYNC WITH BLOCKED_CONTENT_RE (above). Forensic Auditor 2026-07-21
      // (SPEC-86d): the source-side regex blocks filler/microneedling/liposuction/
      // rejuven at HARVEST, but this existing-row self-heal .or() list had drifted
      // NARROWER — a med-spa row whose bio says "lip filler" (no botox/injectable)
      // survived in pending_review (ISSUE3, deferred 07-21). Bringing the two into
      // parity across bio/handle/name/url. Additive + demote-only: this can only
      // flip a blocked med-aesthetic row to do_not_contact, never promote — so it
      // cannot affect the founding-cohort send. Modash-vetted seeds stay protected.
      const orExpr = [
        'external_url.ilike.%medspa%','external_url.ilike.%med-spa%','external_url.ilike.%aesthetic%',
        'external_url.ilike.%laser%','external_url.ilike.%botox%','external_url.ilike.%injectable%',
        'external_url.ilike.%filler%','external_url.ilike.%microneedl%','external_url.ilike.%dermatolog%',
        'ig_handle.ilike.%medspa%','ig_handle.ilike.%aesthetic%','ig_handle.ilike.%laser%',
        'ig_handle.ilike.%medaesthetic%','ig_handle.ilike.%botox%','ig_handle.ilike.%injectable%',
        'ig_handle.ilike.%filler%',
        'display_name.ilike.%med spa%','display_name.ilike.%medspa%','display_name.ilike.%aesthetics%',
        'display_name.ilike.%laser%','display_name.ilike.%botox%','display_name.ilike.%injectable%',
        'display_name.ilike.%filler%',
        'bio.ilike.%medspa%','bio.ilike.%med spa%','bio.ilike.%injectable%','bio.ilike.%botox%',
        'bio.ilike.%dermatolog%','bio.ilike.%plastic surg%','bio.ilike.%filler%',
        'bio.ilike.%microneedl%','bio.ilike.%liposuction%','bio.ilike.%rejuven%',
        'bio.ilike.%med aesthetic%','bio.ilike.%medaesthetic%','bio.ilike.%aesthetics%',
      ].join(',');
      const { data: mq } = await gdb.from('leads_influencers')
        .update({ outreach_status: 'do_not_contact' })
        .eq('outreach_status', 'pending_review')
        .neq('discovered_via', 'modash-vetted-seed')
        .or(orExpr)
        .select('id');
      if (mq && mq.length) console.log(`cleanup: quarantined ${mq.length} blocked med-aesthetic rows`);
    } catch (_e) { /* best-effort */ }

    // ── PROMOTE HALF of the creator gate (SPEC-88, Forensic Auditor 2026-07-20) ──
    // ROOT CAUSE of "204 sendable, 0 EVER contacted": creator-harvest only ever
    // DEMOTED rows (the two quarantine blocks above). The PROMOTE half the
    // services gate has (leads_services new->'queued') was never built for
    // creators, so they sat forever at 'pending_review'. outreach-send's
    // influencer loop (WHERE outreach_status='queued') therefore found 0 rows and
    // the founder's MANUAL "Send Outreach" launcher emailed nobody.
    //
    // SAFETY — this does NOT auto-send. outreach-send is NOT on cron
    // (20260622180000_periodic_workers_cron.sql: "NOT scheduled: outreach-send.
    // Cold email/SMS stays MANUAL (the launcher)"). 'queued' is only the
    // sendable-but-not-yet-sent staging state; the founder still deliberately
    // fires the send launcher. Promoting to 'queued' therefore respects the
    // frozen never-auto-sent invariant (qa#84) — nothing leaves until a human
    // clicks. Reversible (a status flip).
    //
    // SCOPE — honors the spec's "passes the gate + human vet" rule: promote ONLY
    // the human-vetted set, never the raw se:web-harvest pool:
    //   (a) discovered_via='modash-vetted-seed' inside the category gate, OR
    //   (b) FOUNDER_VETTED_ALLOWLIST — the exact handles the founder hand-marked
    //       in "FOUNDING COHORT - creators (READY TO SEND).csv".
    // Both sets are hand-vetted (not med-spa), and the two quarantine blocks above
    // already ran this tick, so a blocked row cannot be sitting at pending_review
    // to be promoted.
    const FOUNDER_VETTED_ALLOWLIST = [
      'remixthedog','mallowfrenchie','bullyfambam','brookelilybrazelton',
      'byvictoriabarrientos','highonlifestylee','maryandpalettes','rachelove',
      'fromappletoorange','lopezjennylopez',
    ];
    try {
      const catList = '(' + TARGET_CATEGORIES.map((c) => '"' + c + '"').join(',') + ')';
      const allow   = '(' + FOUNDER_VETTED_ALLOWLIST.map((h) => '"' + h + '"').join(',') + ')';
      let promoted = 0;
      // (a) vetted seeds inside the category gate
      const { data: pa } = await gdb.from('leads_influencers')
        .update({ outreach_status: 'queued' })
        .eq('outreach_status', 'pending_review')
        .eq('discovered_via', 'modash-vetted-seed')
        .filter('category', 'in', catList)
        .select('id');
      promoted += pa?.length ?? 0;
      // (b) explicit founder allowlist (hand-picked, so no category gate needed).
      // Forensic Auditor 2026-07-21 (SPEC-88c): the 10 Miami founding-cohort handles
      // had been swept to 'do_not_contact' by the June se:web-2026-06-29 CATEGORY
      // purge — NOT by any opt-out/bounce (verified from the ALL-Creators export:
      // notes are biolink provenance only, every handle has an email, none is a
      // blocked category). The old pending_review-only filter therefore made this
      // branch a SILENT NO-OP and the constitutional Miami-first founding cohort
      // produced 0 queued creators, while only the 36 NYC modash seeds moved.
      // Promote the EXPLICIT allowlist from BOTH pending_review AND do_not_contact —
      // the hardcoded list is itself the founder's informed override. This only
      // STAGES ('queued'); the actual send is a manual founder click and
      // outreach-send re-checks outreach_suppressions by email at send time (it
      // skips + re-suppresses any genuine opt-out), so a future opt-out on an
      // allowlisted handle is still honored. Send stays frozen NOT-scheduled.
      const { data: pb } = await gdb.from('leads_influencers')
        .update({ outreach_status: 'queued' })
        .filter('outreach_status', 'in', '("pending_review","do_not_contact")')
        .filter('ig_handle', 'in', allow)
        .select('id');
      promoted += pb?.length ?? 0;
      if (promoted) console.log(`promote: ${promoted} vetted creators pending_review -> queued (staged, NOT sent)`);
    } catch (_e) { /* best-effort; never blocks a harvest run */ }

    dbRef = db;

    const tag = `se:web-harvest-${new Date().toISOString().slice(0, 10)}`;
    // ROTATION (Discovery fix 2026-07-08): the old set repeated the SAME two rigid
    // query shapes over a 12×4 slice every run, so it kept re-finding already-known
    // handles and yielded 0 NEW candidates. Now each run advances a per-run counter
    // (`spin`, one step every ~20 min = the cron cadence) and rotates niches, cities
    // AND modifier phrasings by DIFFERENT co-prime offsets, so each run explores a
    // genuinely different slice of the niche × city × modifier space (≈ 45 niches ×
    // 20 cities × 10 shapes = 9,000 distinct queries cycled over successive runs).
    // SPEC-265: 7-min bucket (was 20) — with the second cron lane the worker ticks
    // ~every 7.5 min, and a bucket longer than the tick spacing would hand two
    // consecutive runs the SAME rotation slice: the second run re-searches what the
    // first just deduped and its budget is spent on known_handle skips. 7 min < the
    // tightest lane gap, so every tick explores a genuinely different slice.
    const spin = Math.floor(Date.now() / 420000);   // 7-min run bucket
    const cities = rotate(CITIES,    (spin * 3)  % CITIES.length);
    const mods   = rotate(MODIFIERS, (spin * 2)  % MODIFIERS.length);

    // ── SPEC-264 — SPEC-SHAPED QUERIES FIRST (founder: "running seaches direct
    // based on spec (top 25 micro and mid parenting, pets, etc influncers in nyc
    // miami etc..)"). For each committed CREATOR_CATEGORIES slug (tier order —
    // the SAME table SPEC-257 welded) × metro, TWO variants encode "top 25 micro
    // and mid". A (category × metro) pair that already holds CREATOR_CAT_CAP (25)
    // FRESH kept rows is SKIPPED — the founder asked for the top 25 per category
    // per city, not an unbounded pile in one bucket. Counts are fresh-windowed
    // for the same reason the self-stop is: legacy rows already saturate several
    // pairs, and an unwindowed cap re-zeroes the source on day one. A pair whose
    // count ERRORS is treated as 0 and crawled anyway — this path spends no
    // money, and the handle-dedupe + upsert make over-crawling a no-op.
    const catCityHave: Record<string, number> = {};
    stage = 'cap-count';
    await Promise.all(CREATOR_CATEGORIES.flatMap((cat) => HARVEST_METROS.map(async (metro) => {
      const { count } = await gdb.from('leads_influencers')
        .select('id', { count: 'exact', head: true })
        .like('discovered_via', 'se:web-harvest%')
        .eq('category', cat.slug)
        .eq('city', metro)
        .gte('fetched_at', HARVEST_FRESH);
      catCityHave[`${cat.slug}|${metro}`] = count ?? 0;
    })));

    const queries: Array<{ query: string; niche: { q: string; category: string }; city: string }> = [];
    const qseen = new Set<string>();
    for (const cat of CREATOR_CATEGORIES) {
      for (const metro of HARVEST_METROS) {
        if ((catCityHave[`${cat.slug}|${metro}`] ?? 0) >= CREATOR_CAT_CAP) continue;   // top-25 cap met — next pair
        for (const query of [
          `top ${cat.igQuery}s in ${metro} instagram`,     // "top 25 ... influncers in nyc miami"
          `micro ${cat.igQuery} ${metro} instagram`,       // "micro and mid"
        ]) {
          const k = query.toLowerCase();
          if (qseen.has(k) || queries.length >= MAX_QUERIES) continue;
          qseen.add(k);
          queries.push({ query, niche: { q: cat.igQuery, category: cat.slug }, city: metro });
        }
      }
    }

    // SPEC-245 — the tier walk now FILLS whatever budget the spec-shaped queries
    // left (all of it once every pair caps out): each tier rotated within itself
    // and holding its own share of the remainder (TIER_BUDGET). Tier order is the
    // founder's crawl order; rotation within a tier keeps successive runs
    // exploring different slices instead of re-finding the same handles. The walk
    // is still diagonal across city × modifier so one run mixes several niches
    // and shapes.
    NICHE_TIERS.forEach((tier, t) => {
      const tn = rotate(tier, (spin * 7) % Math.max(tier.length, 1));
      let added = 0;
      outer:
      for (let i = 0; i < tn.length; i++) {
        const n = tn[i];
        for (let j = 0; j < cities.length; j++) {
          const c = cities[(i + j) % cities.length];
          const mod = mods[(i + j) % mods.length];
          const query = mod.replace('{c}', c).replace('{n}', n.q);
          const k = query.toLowerCase();
          if (qseen.has(k)) continue;
          qseen.add(k);
          queries.push({ query, niche: n, city: c });
          added++;
          if (added >= (TIER_BUDGET[t] ?? 4) || queries.length >= MAX_QUERIES) break outer;
        }
      }
    });

    // ── SPEC-269: 'queries' mode returns the built slice and stops — no search,
    // no lead writes. Everything ABOVE (committed kill-switch, fresh self-stop,
    // per-(category×metro) caps, quarantine/promote housekeeping) already ran, so
    // the relay can only ever be handed queries a crawl run would have run itself.
    if (MODE === 'queries') {
      await logAgentRun(db, 'creator-harvest', {
        started, raw_found: 0, rows_written: 0, status: 'ok',
        meta: { mode: 'queries', queries: queries.length, spin },
      });
      return json({ ok: true, mode: 'queries', queries, spin, ms: Date.now() - started });
    }
    // ── SPEC-269: 'ingest' mode swaps the work list for the relay's POSTED items,
    // validated hard: city must be a CITY_STATE key and the category a targetable
    // one (an unknown city would geo-verify against nothing and an off-target
    // category is quarantine bait — drop both at the door), results bounded to
    // 12/query and items to MAX_QUERIES. Every downstream gate re-runs unchanged.
    type RelayItem = { query: string; niche: { q: string; category: string }; city: string; results?: SearchHit[] };
    const workItems: RelayItem[] = MODE === 'ingest'
      ? (Array.isArray(reqBody.items) ? reqBody.items : [])
          .filter((it: any) => it && typeof it.query === 'string'
            && it.niche && typeof it.niche.q === 'string' && typeof it.niche.category === 'string'
            && typeof it.city === 'string' && CITY_STATE[it.city] !== undefined
            && TARGET_CATEGORIES.includes(it.niche.category))
          .slice(0, MAX_QUERIES)
          .map((it: any): RelayItem => ({
            query: String(it.query).slice(0, 200),
            niche: { q: String(it.niche.q).slice(0, 80), category: String(it.niche.category) },
            city: String(it.city),
            results: (Array.isArray(it.results) ? it.results : [])
              .filter((r: any) => r && typeof r.url === 'string' && /^https?:\/\//i.test(r.url))
              .slice(0, 12)
              .map((r: any): SearchHit => ({ url: String(r.url).slice(0, 600), title: String(r.title || '').slice(0, 300), snippet: String(r.snippet || '').slice(0, 1200) })),
          }))
      : queries;

    const seen = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let siteFetches = 0;
    // Skip-reason tally so the watchdog can see WHY a run found nothing new.
    const skips = { known_handle: 0, no_handle: 0, no_contact_no_link: 0, blocked: 0, suppressed: 0, non_creator: 0, geo_unverified: 0, business: 0 };

    // SPEC-265 — worker pool over the query list (was a sequential for..of). The
    // per-query body is UNCHANGED; only the driver fans out. Defined INSIDE the
    // handler on purpose: it closes over handler-scoped db/gdb/seen/rows (SPEC-166
    // class — a module-level helper must never close over handler consts). Every
    // check-then-act on shared state (seen.has→add, the siteFetches cap) sits in a
    // synchronous block, so concurrent processors cannot double-take a handle or
    // overrun the fetch cap under the single-threaded event loop.
    const processQuery = async (item: RelayItem): Promise<void> => {
      const query = item.query;
      const niche = item.niche;
      const city  = item.city;
      stage = 'search';
      // SPEC-269: ingest items carry the relay's results — searched from a runner
      // IP the engines actually serve. Crawl mode searches the ladder itself.
      const results = MODE === 'ingest' && Array.isArray(item.results)
        ? item.results
        : await ddgSearch(query, engineTally);
      dbg.raw_results += results.length;
      if (results.length) { dbg.queries_with_results++; if (dbg.first_urls.length < 5) dbg.first_urls.push(...results.slice(0, 2).map(r => r.url)); }

      for (const r of results) {
        if (Date.now() - started > DEADLINE_MS) break;
        // SPEC-264 EXTRACT — a "top 25 ..." result block names SEVERAL creators:
        // instagram.com/<handle> links AND bare @handles in the title/snippet.
        // v1 took exactly one handle per block, so a listicle of 25 yielded 1.
        // The PRIMARY handle (result URL first, then first in text) keeps the
        // block's snippet email; the extra handles become contactless rows with
        // the block's non-IG URL as external_url, which the */15 site-enrich cron
        // then finishes — attributing one block's email to every handle in it
        // would be fabrication (SPEC-86: never fabricate).
        const blockText = r.snippet + ' ' + r.title;
        const isIG = /instagram\.com/i.test(r.url);
        let primary = igHandle(r.url) || igHandle(blockText) || atHandle(blockText);
        const blockHandles: string[] = [];
        for (const h of [primary, ...allIgHandles(blockText), ...allAtHandles(blockText)]) {
          if (h && !blockHandles.includes(h)) blockHandles.push(h);
        }

        // Contact from the snippet/title first (free, no fetch).
        let email = firstEmail(blockText);
        let phone = firstPhone(blockText);
        // FOLLOWERS (founder: "also crawl the # of followers so we rank") — a
        // snippet's "123K followers" parsed K/M → integer, or null. Never faked.
        const blockFollowers = parseFollowers(blockText);

        // ONE inline site fetch of the block's non-IG page when a contact or a
        // handle is still missing — the site-enrich shape: 5s timeout, junk
        // filter (firstEmail carries it — welded to site-enrich's list by gate
        // #264b), one hop. Rows the budget skips keep external_url set and
        // site_enriched_at NULL, so the */15 site-enrich cron finishes the job.
        let pageText = '';
        if ((!primary || (!email && !phone)) && !isIG && siteFetches < MAX_SITEFETCH) {
          siteFetches++;
          pageText = (await fetchText(r.url, 5000)) || '';
          if (pageText) {
            if (!email) email = firstEmail(pageText);
            if (!phone) phone = firstPhone(pageText);
            const mined = igHandle(pageText);          // creator's IG link on their linktree/site
            if (mined && !blockHandles.includes(mined)) { blockHandles.unshift(mined); if (!primary) primary = mined; }
          }
        }
        if (!blockHandles.length) { skips.no_handle++; continue; }
        // VOLUME MODE: keep a creator if we have a contact OR a mineable link
        // (their non-IG site / linktree). Contactless-with-link rows get their
        // contacts filled by site-enrich (*/15) / enrich-influencers → then gated.
        const ext = isIG ? null : r.url;   // their own site/linktree = enrich can mine it
        if (!email && !phone && !ext) { skips.no_contact_no_link++; continue; }

        // Suppression guard before persisting an email we'd contact.
        if (email) {
          stage = 'suppression';
          const { data: s, error: sErr } = await db.from('outreach_suppressions')
            .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
          if (!sErr && s) { email = null; skips.suppressed++; }   // ignore suppression-table errors, don't abort the run
        }

        for (const handle of blockHandles.slice(0, 5)) {   // bounded per block
          const key = handle.toLowerCase();
          const first = handle === primary;
          if (seen.has(key)) { skips.known_handle++; continue; }
          seen.add(key);
          // QUALITY GATE (Forensic Auditor 2026-07-08): a creator row MUST have a
          // real IG handle. leads_influencers.ig_handle is NOT NULL, so handle-less
          // rows were (a) throwing a not-null violation that failed the WHOLE upsert
          // chunk (upserted:0 despite 68 candidates, creators frozen 55h) and (b)
          // letting non-creator emails in (e.g. billing@wordfence.com, business
          // front desks). The 2..30 length guard — IG's own bounds — lives inside
          // igHandle/atHandle (SPEC-264), so an off-bounds "handle" never gets here.
          // NON-CREATOR GUARD (Forensic Auditor 2026-07-08): listicles & news
          // pages link to media-outlet / wiki / aggregator IG handles
          // (foxbusiness, eatermiami, tampabaytimes, thefashionspot, wikipedia…).
          // Those are NOT individual creators and were polluting the sendable
          // pool ~20-25%. enrich/gate can't fix identity, so drop at the source.
          if (isBadHandle(handle)) { skips.non_creator++; continue; }
          // ── QUALITY GATE at the SOURCE (SPEC-86): no fabrication, verified geo,
          //    individual-only, and NEVER sendable until vetted/promoted. ──
          const geoText = `${r.snippet} ${r.title} ${pageText}`;
          if (!cityVerified(city, geoText)) { skips.geo_unverified++; continue; }   // kills wrong-geo (Utah-for-Miami)
          if (isBusinessLike(handle, r.title)) { skips.business++; continue; }        // kills business-as-creator
          if (isBlockedContent(handle, r.title, ext, r.snippet)) { skips.blocked++; continue; } // kills med-spa/aesthetic/SHAFT leak at source
          const id = `harv:${handle.replace(/[^a-z0-9]+/gi, '').slice(0, 60).toLowerCase()}`;
          rows.push({
            id, ig_handle: handle, display_name: cleanTitle(r.title),
            category: niche.category,
            email: first ? email : null,             // only a real, un-suppressed email, on the PRIMARY handle only (never fanned out)
            phone: null,                             // creators are reached by IG/email — NEVER a scraped phone (no fabrication; site-enrich's fill-only tel: path is the phone lane)
            followers: first ? blockFollowers : null, // parsed "123K followers" belongs to the block's primary creator
            external_url: ext,
            city, state: CITY_STATE[city] ?? null,   // mapped, NEVER hardcoded 'FL'
            is_business: false,
            discovered_via: tag,
            outreach_status: 'pending_review',       // NON-sendable until it passes the gate + (initial batches) human vet
            created_at: new Date().toISOString(),
            fetched_at: new Date().toISOString(),    // the column every FRESH count reads (SPEC-264)
          });
        }
      }
    };
    let qCursor = 0;
    await Promise.all(Array.from({ length: HARVEST_POOL }, async () => {
      while (qCursor < workItems.length) {
        if (Date.now() - started > DEADLINE_MS) break;
        const item = workItems[qCursor++];   // synchronous pick — a query is claimed exactly once
        await processQuery(item);
      }
    }));

    // Dedupe by PRIMARY KEY before upserting. Two distinct handles can collapse
    // to the SAME id after stripping non-alphanumerics + slicing to 60 chars,
    // which puts duplicate ids in one chunk → Postgres "ON CONFLICT DO UPDATE
    // command cannot affect row a second time", aborting the whole chunk
    // (Forensic Auditor 2026-07-08 — creator_harvest_last_error). Keep first.
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of rows) { const k = r.id as string; if (!byId.has(k)) byId.set(k, r); }
    let uniqueRows = [...byId.values()];

    // SPEC-264 — DEDUPE AGAINST EXISTING ROWS BY ig_handle, CASE-INSENSITIVE,
    // before insert. The id upsert only collides with rows THIS harvester minted
    // (harv:<handle>); the same creator discovered by ig-scraper-user-search or
    // the modash seeds carries a DIFFERENT id, so without this check one creator
    // becomes two rows and the founder's 100 double-counts. ilike with no
    // wildcard is case-insensitive equality; handles are sanitized to [a-z0-9._]
    // upstream so the or() expression cannot be injected through.
    if (uniqueRows.length) {
      stage = 'handle-dedupe';
      const existing = new Set<string>();
      const hs = uniqueRows.map((r) => String(r.ig_handle));
      for (let i = 0; i < hs.length; i += 40) {
        const orExpr2 = hs.slice(i, i + 40).map((h) => `ig_handle.ilike.${h.replace(/[^A-Za-z0-9._]/g, '')}`).join(',');
        const { data: ex, error: exErr } = await gdb.from('leads_influencers').select('ig_handle').or(orExpr2).limit(200);
        if (exErr) continue;   // dedupe read failed → keep the rows; the id upsert still prevents self-duplicates
        for (const e of ex || []) existing.add(String((e as { ig_handle?: string }).ig_handle || '').toLowerCase());
      }
      const before = uniqueRows.length;
      uniqueRows = uniqueRows.filter((r) => !existing.has(String(r.ig_handle).toLowerCase()));
      skips.known_handle += before - uniqueRows.length;
    }

    let inserted = 0; let upsertError: string | null = null;
    if (uniqueRows.length) {
      stage = 'upsert';
      // Insert in small chunks; capture (don't throw) so one bad row can't abort all.
      for (let i = 0; i < uniqueRows.length; i += 25) {
        const chunk = uniqueRows.slice(i, i + 25);
        const { error } = await gdb.from('leads_influencers')
          .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
        if (error) {
          upsertError = serr(error);
          // Chunk upsert is atomic, so one bad row zeroes 25 good ones. Retry the
          // chunk row-by-row so a single bad row can no longer abort the batch
          // (Forensic Auditor 2026-07-08 — the resilience the old comment claimed).
          for (const one of chunk) {
            const { error: e1 } = await gdb.from('leads_influencers')
              .upsert([one], { onConflict: 'id', ignoreDuplicates: false });
            if (!e1) inserted += 1;
          }
        } else { inserted += chunk.length; }
      }
    }

    stage = 'gate';
    try { await db.rpc('cergio_grade_creators'); } catch (_e) { /* non-fatal */ }
    try { await db.rpc('cergio_ops_audit'); } catch (_e) { /* non-fatal */ }

    stage = 'count';
    const { count: sendable } = await gdb.from('leads_influencers')
      .select('id', { count: 'exact', head: true }).eq('outreach_status', 'queued');

    // Log EVERY run so a no-op can never look like success again.
    try {
      await db.from('harvest_runs').insert({
        tag, queries: queries.length, raw_results: dbg.raw_results,
        candidates: rows.length, upserted: inserted, ms: Date.now() - started,
      });
    } catch (_e) { /* table may not exist yet on first deploy */ }

    // BACKBONE: unified agent_runs ledger — success = rows written, not sent.
    // 'empty' when we found raw results but wrote nothing OR found nothing.
    const harvestStatus = dbg.raw_results > 0 && inserted === 0 ? 'empty'
      : (inserted === 0 ? 'empty' : 'ok');
    await logAgentRun(db, 'creator-harvest', {
      started, raw_found: dbg.raw_results, rows_written: inserted,
      status: harvestStatus, error: upsertError,
      // skips explains WHY a run wrote nothing new so the watchdog can tell a
      // dedupe no-op (known_handle high) from a discovery miss (no_handle high).
      meta: { tag, mode: MODE, queries: workItems.length, candidates: rows.length, site_fetches: siteFetches, skips, spin, engines: engineTally },
    });

    return json({
      ok: true, tag, mode: MODE,
      // SPEC-264 diagnosable shape: what was asked, what was found, what landed,
      // how reachable it is, and whether site-enrich has follow-up work.
      queried: workItems.length, found: rows.length, inserted,
      with_contact: uniqueRows.filter((r) => r.email || r.phone).length,
      with_site: uniqueRows.filter((r) => r.external_url).length,
      elapsed_ms: Date.now() - started,
      // legacy keys the earlier dashboards/scripts read — kept, same meanings.
      queries: workItems.length, site_fetches: siteFetches,
      candidates_with_contact: rows.length, upserted: inserted, upsert_error: upsertError,
      creators_sendable_total: sendable ?? null, skips, dbg, engines: engineTally,
      ms: Date.now() - started,
      sample: uniqueRows.slice(0, 8).map(r => ({ h: r.ig_handle, c: r.email || r.phone, f: r.followers })),
    });
  } catch (e) {
    // BACKBONE: log the crash so the watchdog sees status='error', not a stall.
    await logAgentRun(dbRef, 'creator-harvest', {
      started, raw_found: dbg.raw_results, rows_written: 0,
      status: 'error', error: serr(e), meta: { stage },
    });
    return json({ error: serr(e), stage, dbg, ms: Date.now() - started }, 500);
  }
});

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws (a
// logging failure must never break or mask the worker's real outcome).
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
  } catch (_e) { /* logging is best-effort; swallow */ }
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

// ---- Keyless web search — TRANSPORT LADDER (SPEC-268) ----
// MEASURED 2026-08-07 via the SPEC-267 runs surface: every run built 52 queries and
// got raw_results=0 with EVERY skip counter 0 and site_fetches 0 — BOTH DuckDuckGo
// endpoints return nothing to the Supabase egress IP, while the SAME query from a
// residential browser returns 10 organic results. An IP-class bot-wall, not an
// extraction defect (extraction never ran; site-enrich fetches arbitrary sites from
// this egress fine). DDG stays FIRST — best parser when unwalled, and gate #264b
// pins the lite fallback — then the ladder falls through to Bing HTML and Mojeek:
// independent indexes, keyless, $0 (the founder's order is verbatim "not paid! IG").
// Per-engine telemetry lands in agent_runs.meta.engines EVERY run, so which
// transport works from the edge is MEASURED from now on, never guessed again.
const ENGINE_COOLDOWN_MS = 600000;    // fetch-FAILED engines sit out 10 min (warm-worker scoped)
const _engineDeadUntil: Record<string, number> = {};
type SearchHit = { url: string; title: string; snippet: string };
type SearchEngine = { name: string; build: (q: string) => string; parse: (html: string) => SearchHit[] };
const SEARCH_ENGINES: SearchEngine[] = [
  { name: 'ddg-html', build: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parse: parseDdgHtml },
  { name: 'ddg-lite', build: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, parse: parseDdgLite },
  { name: 'bing',     build: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,       parse: parseBing },
  { name: 'mojeek',   build: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,     parse: parseMojeek },
];
async function ddgSearch(query: string, tally?: Record<string, { tried: number; got: number }>): Promise<SearchHit[]> {
  for (const eng of SEARCH_ENGINES) {
    // COOLDOWN is for FETCH failures only (timeout / HTTP error) — a dead engine
    // costs one 8s timeout per 10-min window instead of 8s × every query × every
    // run. 0 PARSED results is a soft miss (thin query, changed markup) and never
    // benches an engine: benching on soft misses would silently shrink the ladder
    // to whichever engine answered last.
    if ((_engineDeadUntil[eng.name] || 0) > Date.now()) continue;
    let t = tally?.[eng.name];
    if (tally && !t) t = tally[eng.name] = { tried: 0, got: 0 };
    if (t) t.tried++;
    const html = await fetchText(eng.build(query), 8000);
    if (!html) { _engineDeadUntil[eng.name] = Date.now() + ENGINE_COOLDOWN_MS; continue; }
    const out = eng.parse(html).slice(0, 12);
    if (t) t.got += out.length;
    if (out.length) return out;
  }
  return [];
}
// html endpoint: result blocks with result__a (link+title) and result__snippet.
function parseDdgHtml(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    const url = decodeDdg(m[1]);
    if (!url) continue;
    out.push({ url, title: stripTags(m[2] || ''), snippet: stripTags(m[3] || '') });
  }
  return out;
}
// lite endpoint: plain anchors + adjacent text.
function parseDdgLite(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const re2 = /<a[^>]*href="(https?:\/\/[^"]+|\/l\/\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m2: RegExpExecArray | null;
  while ((m2 = re2.exec(html)) && out.length < 12) {
    const url = decodeDdg(m2[1]);
    if (!url || /duckduckgo\.com/i.test(url)) continue;
    out.push({ url, title: stripTags(m2[2] || ''), snippet: '' });
  }
  return out;
}
// Bing wraps organic hrefs in /ck/a redirects whose u= param is 'a1' + base64url of
// the real URL. Decode it or every downstream isIG/igHandle/external_url reads
// bing.com and the engine "works" while harvesting nothing — a wall with extra steps.
function decodeBing(href: string): string | null {
  try {
    if (/bing\.com\/ck\/a/i.test(href) || href.startsWith('/ck/a')) {
      const u = new URL(href.startsWith('http') ? href : 'https://www.bing.com' + href);
      const p = u.searchParams.get('u') || '';
      if (p.startsWith('a1')) {
        const b64 = p.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const dec = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
        if (/^https?:\/\//i.test(dec)) return dec;
      }
      return null;
    }
    return /^https?:\/\//i.test(href) ? href : null;
  } catch { return null; }
}
function parseBing(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    const url = decodeBing(m[1].replace(/&amp;/g, '&'));
    if (!url || /(^|\.)bing\.com$|(^|\.)microsoft\.com$/i.test(searchHost(url))) continue;
    out.push({ url, title: stripTags(m[2] || ''), snippet: stripTags(m[3] || '') });
  }
  return out;
}
function parseMojeek(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const re = /<h2>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>[\s\S]*?(?:<p[^>]*class="s"[^>]*>([\s\S]*?)<\/p>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    if (/mojeek\.com/i.test(m[1])) continue;
    out.push({ url: m[1], title: stripTags(m[2] || ''), snippet: stripTags(m[3] || '') });
  }
  return out;
}
function searchHost(u: string): string { try { return new URL(u).hostname; } catch { return ''; } }

function decodeDdg(href: string): string | null {
  try {
    if (href.startsWith('//duckduckgo.com/l/') || href.startsWith('/l/') || href.includes('duckduckgo.com/l/')) {
      const u = new URL(href.startsWith('//') ? 'https:' + href : (href.startsWith('/') ? 'https://duckduckgo.com' + href : href));
      const target = u.searchParams.get('uddg');
      return target ? decodeURIComponent(target) : null;
    }
    if (href.startsWith('http')) return href;
    return null;
  } catch { return null; }
}

function igHandle(url: string): string | null {
  const m = url.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  if (['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts'].includes(h)) return null;
  if (h.length < 2 || h.length > 30) return null;   // SPEC-264: IG's own handle bounds — anything outside is parse noise, not an account
  return h;
}
// SPEC-264 — EVERY instagram.com/<handle> link in a result block, not just the
// first: a "top 25" listicle block links several accounts, and v1's single-handle
// take made 25 named creators yield one row.
function allIgHandles(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/instagram\.com\/([A-Za-z0-9._]+)/gi)) {
    const h = igHandle(`instagram.com/${m[1]}`);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}
// SPEC-264 — bare @handles in titles/snippets ("... follow @petsofmiami for ...").
// Same 2..30 bounds; a trailing dot is sentence punctuation, not the handle.
function atHandle(s: string): string | null { return allAtHandles(s)[0] ?? null; }
function allAtHandles(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/(?:^|[^A-Za-z0-9._])@([A-Za-z0-9._]{2,30})\b/g)) {
    const h = m[1].toLowerCase().replace(/\.+$/, '');
    if (h.length < 2 || h.length > 30) continue;
    if (h.includes('.') && /\.(com|net|org|io|co|ai)$/.test(h)) continue;   // that's an email domain fragment, not a handle
    if (!out.includes(h)) out.push(h);
  }
  return out;
}
// SPEC-264 — FOLLOWERS from result text ("also crawl the # of followers so we
// rank"): "12,400 followers" / "123K followers" / "1.2M followers" → integer.
// No match → null, NEVER a guess (SPEC-86: no fabrication).
function parseFollowers(s: string): number | null {
  const m = s.match(/([\d][\d.,]*)\s*([KkMm])?\s*followers/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const mult = /[Kk]/.test(m[2] || '') ? 1_000 : /[Mm]/.test(m[2] || '') ? 1_000_000 : 1;
  return Math.round(base * mult);
}

// Media outlets / publications / wikis / directories whose IG handle shows up on
// listicles and news results but is NOT an individual creator we can onboard.
// (Forensic Auditor 2026-07-08 — the 386 sendable pool was ~20-25% these.)
const BAD_HANDLE = /(news|nytimes|thetimes|herald|gazette|tribune|magazine|eater|thrillist|timeout|refinery29|buzzfeed|voguemagazine|foxbusiness|foxnews|^fox\d|cnn|nbc|abcnews|cbsnews|msnbc|wikipedia|wikimedia|tampabay|miamiherald|miaminewtimes|thefashionspot|forbes|businessinsider|bloomberg|reuters|yelp|tripadvisor|thumbtack|nextdoor|groupon|realtor|zillow|apartments|official_?news|dot_?com)/i;
function isBadHandle(h: string | null): boolean {
  if (!h) return true;
  if (h.length < 3) return true;      // too short to be a real handle
  if (/^\d+$/.test(h)) return true;   // purely numeric = not a creator handle
  return BAD_HANDLE.test(h);
}

function cleanTitle(t: string): string {
  return t.replace(/\s*[•|(].*$/, '').replace(/on instagram.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Creator';
}
function rotate<T>(arr: T[], n: number): T[] { const k = ((n % arr.length) + arr.length) % arr.length; return arr.slice(k).concat(arr.slice(0, k)); }
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim(); }

async function fetchText(url: string, timeout = 6000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal, headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    } });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).slice(0, 250000);
  } catch { return null; }
}

// Directory/aggregator + infra domains whose email is NOT the creator's.
const BAD_EMAIL_DOMAIN = /(feedspot|modash|inbeat|snappr|superprof|peerspace|theknot|partyslate|wezoree|yelp|tripadvisor|thumbtack|nextdoor|takeachef|cookingenie|flytographer|lifetime|sentry|wixpress|example\.com|domain\.com|yourdomain|godaddy|squarespace|wix\.com|cloudflare|shopify|mailchimp|sentry\.io)/;
// Placeholder / role local-parts that aren't a real person to contact.
const BAD_EMAIL_LOCAL = /^(user|name|email|your|youremail|example|test|firstname|lastname|hello|admin|webmaster|noreply|no-reply|donotreply)$/;
function firstEmail(s: string): string | null {
  const m = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const e of m) {
    const x = e.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(x)) continue;
    if (BAD_EMAIL_DOMAIN.test(x)) continue;
    const local = x.split('@')[0];
    if (BAD_EMAIL_LOCAL.test(local)) continue;
    return x;
  }
  return null;
}
function firstPhone(s: string): string | null {
  const m = s.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+1\d{10}/g) || [];
  for (const p of m) {
    const digits = p.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }
  return null;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
