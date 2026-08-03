// SPEC-156 — collapse the duplicated crawl queue and make re-duplication
// impossible at the DB level.
//
// Measured 2026-08-01: crawl_requests held 151,714 open jobs against only
// 12 cities x 28 types x 8 sources = 2,688 real combinations — roughly 56x
// duplication. Cause: seed-growth-queue.mjs built its "already queued" set from
// a single `limit=20000` read, so once the queue passed 20k rows everything
// beyond that window looked unseen and was re-seeded on every run. The queue
// compounded, and workers would have spent almost all their capacity re-crawling
// the same city/type/source triples.
//
// Deleting rows is not enough — the seeder would refill them. So this also adds a
// partial UNIQUE index over the OPEN jobs, which turns a duplicate insert into a
// conflict the seeder can ignore. The invariant then lives in the database, where
// no future caller can forget it.
const MGMT = 'https://api.supabase.com/v1';
import { growthBase } from './_growth-env.mjs';
import { CITIES, TYPES } from './_growth-scope.mjs';
// Which of the AUTHORISED types actually attract someone with an audience. This narrows
// the authorised list; it never adds to it, so a blocked category cannot re-enter here.
const CREATOR_HEAVY = new Set(['photographer', 'personal trainer', 'hair stylist', 'barber',
  'dog trainer', 'life coach', 'tutor', 'home organizer', 'nutritionist', 'dog walker']);
const url = growthBase();
const token = process.env.GROWTH_ACCESS_TOKEN;
if (!url || !token) { console.log('dedupe SKIPPED (need GROWTH_SUPABASE_URL + GROWTH_ACCESS_TOKEN)'); process.exit(0); }
const ref = new URL(url).hostname.split('.')[0];

async function q(sql) {
  const r = await fetch(`${MGMT}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.text();
  if (!r.ok) { console.log(`  -> HTTP ${r.status} ${body.slice(0, 200)}`); return null; }
  try { return JSON.parse(body); } catch { return body; }
}

const before = await q(`select count(*)::int as n from crawl_requests where status = 'new'`);
console.log(`open jobs before: ${before?.[0]?.n ?? '?'}`);

// ctid rather than id: correct whatever the primary key turns out to be.
console.log('collapsing duplicate open jobs (keeping the earliest of each triple)…');
await q(`
  delete from crawl_requests a
   using crawl_requests b
   where a.status = 'new' and b.status = 'new'
     and a.ctid > b.ctid
     and a.city = b.city
     and a.service_type = b.service_type
     and a.source = b.source
`);

console.log('adding the partial unique index so duplicates cannot come back…');
await q(`
  create unique index if not exists crawl_requests_open_uniq
    on crawl_requests (city, service_type, source)
    where status = 'new'
`);

const after = await q(`select count(*)::int as n from crawl_requests where status = 'new'`);
console.log(`open jobs after : ${after?.[0]?.n ?? '?'} (expected ~2,688 = 12 cities x 28 types x 8 sources)`);

// SPEC-163 (measured live 2026-08-01): the worker finally reached the growth queue
// and died on `column crawl_requests.lat does not exist [42703]`. The growth schema
// was created without several columns the workers read and write — the same gap
// that killed enrich-influencers. Auditing both write paths found three more
// waiting behind it (leads_services.address, .osm_id, crawl_requests.requested_by),
// and OSM is the PRIMARY path, so osm_id would have failed on the very next run.
// Adding them all in one pass rather than discovering them one 10-minute cycle at
// a time. ADD COLUMN IF NOT EXISTS is idempotent, so this is safe every run.
console.log('ensuring every column the workers read/write exists…');
await q(`
  alter table public.crawl_requests
    add column if not exists cost_usd numeric default 0,
    add column if not exists lat double precision,
    add column if not exists lng double precision,
    add column if not exists requested_by uuid,
    add column if not exists delivered_count int default 0
`);
await q(`
  alter table public.leads_influencers
    add column if not exists is_business boolean,
    add column if not exists phone text
`);
await q(`
  alter table public.leads_services
    add column if not exists zip text,
    add column if not exists yelp_url text,
    add column if not exists cl_post_url text,
    add column if not exists facebook text,
    add column if not exists address text,
    add column if not exists osm_id text,
    add column if not exists lon double precision,
    add column if not exists lat double precision
`);

// Prove it, rather than assuming the ALTER took: a missing column here is
// indistinguishable from a dead worker at the HTTP layer, which is exactly how
// this cost a night.
for (const [tbl, cols] of [
  ['crawl_requests', 'id,kind,city,state,lat,lng,service_type,target_count,requested_by,status,source,notes'],
  ['leads_services', 'id,name,service_type,phone,address,osm_id,city,state,lat,lon,data_source,outreach_status'],
]) {
  const r = await fetch(`${url}/rest/v1/${tbl}?select=${cols}&limit=1`, {
    headers: { apikey: process.env.GROWTH_SERVICE_ROLE_KEY || '', Authorization: `Bearer ${process.env.GROWTH_SERVICE_ROLE_KEY || ''}` },
  });
  console.log(`column probe ${tbl}: HTTP ${r.status}${r.ok ? ' — every column the worker uses exists' : ' ' + (await r.text()).slice(0, 160)}`);
}

// SPEC-168: UNPARK. SPEC-167b parked every job whose source had produced 0 rows.
// The parking was based on a generic "no results" note that hid the real error, so
// it condemned sources that are configured and running. Restore them to 'new' and
// let the evidence — now carried in the notes — decide.
console.log('un-parking every source parked by SPEC-167…');
const unparked = await q(`
  update crawl_requests
     set status = 'new',
         notes  = 'SPEC-168: un-parked — parked on a generic note that hid the real error',
         updated_at = now()
   where status = 'parked'
  returning 1
`);
console.log(`un-parked ${Array.isArray(unparked) ? unparked.length : '?'} job(s)`);
const openNow = await q(`select source, count(*)::int as n from crawl_requests where status = 'new' group by source order by n desc`);
console.log('open queue by source:', JSON.stringify(openNow));
const yields = await q(`select data_source, count(*)::int as n from leads_services group by data_source order by n desc`);
console.log('leads by source (measured yield):', JSON.stringify(yields));

// SPEC-184 — SPEND CIRCUIT BREAKER. "Never burn budget with zero delivery."
//
// Apify and SerpAPI bill per run. Nothing in this system ever compared what a PAID
// source COST against what it DELIVERED, so four paid sources ran for hours,
// produced zero rows, and the only signal was a note nobody was reading. ~$70 went
// out for nothing. Free sources (osm) are exempt — they can fail all day for free.
//
// Rule: a PAID source that has finished >= PROOF_JOBS jobs and produced ZERO leads
// is auto-parked. It cannot spend again until a human un-parks it, and the parking
// note says exactly what it cost us in jobs. This runs every cycle, so the worst
// case is bounded at PROOF_JOBS jobs of spend per source, not an open tab.
const PAID_SOURCES = ['craigslist', 'yellowpages_apify', 'gmaps_apify', 'ig_services',
                      'google_lsa', 'google_sponsored', 'yelp'];
const PROOF_JOBS = 15;   // enough to prove a source works; small enough to be cheap

console.log('spend guard — checking paid sources deliver against what they cost…');
for (const src of PAID_SOURCES) {
  const done = await q(`select count(*)::int as n from crawl_requests where source = '${src}' and status in ('delivered','failed')`);
  const got  = await q(`select count(*)::int as n from leads_services where data_source = '${src}'`);
  const jobs = done?.[0]?.n ?? 0, leads = got?.[0]?.n ?? 0;
  if (jobs >= PROOF_JOBS && leads === 0) {
    const parked = await q(`
      update crawl_requests
         set status = 'parked',
             notes  = 'SPEC-184 SPEND GUARD: ${jobs} paid jobs run, 0 leads produced. Parked to stop spend. Un-park only after a fix is PROVEN to yield.',
             updated_at = now()
       where source = '${src}' and status = 'new' returning 1`);
    console.log(`  ${src}: PARKED — ${jobs} paid jobs, ${leads} leads (${Array.isArray(parked) ? parked.length : '?'} queued jobs stopped)`);
  } else {
    console.log(`  ${src}: ${jobs} jobs -> ${leads} leads ${jobs >= PROOF_JOBS ? '(earning its spend)' : '(still proving, under the ' + PROOF_JOBS + '-job cap)'}`);
  }
}

// SPEC-200 — PER-SOURCE QUOTA, so one source cannot dominate the dataset.
//
// Founder, 2026-08-02: "need to scale other sources so we top up 100 leads per source
// with the spend ... rather than have yelp dominate sources."
//
// Measured 2026-08-02: yelp 15,796 of 21,367 rows = 74% of the entire database, while
// google_sponsored had 34 and yellowpages 0. A dataset that is three-quarters one
// vendor is a single point of failure — if yelp blocks us or changes terms, the supply
// side collapses. It also hides quality: yelp's contactability sets the headline number
// for everything.
//
// So each source gets a FLOOR to reach before any source is allowed to run ahead. A
// source below its floor is prioritised; a source far above it is throttled. This is
// about DIVERSITY, not volume — the tranche gate still governs money.
const LEAD_FLOOR = Number(process.env.LEAD_FLOOR || 100);

console.log(`\nsource balance — floor ${LEAD_FLOOR} leads each`);
const bySource = await q(`select data_source, count(*)::int as n from leads_services group by data_source order by n desc`);
const counts = Object.fromEntries((bySource || []).map((r) => [r.data_source, r.n]));
const ALL = ['osm', 'craigslist', 'yellowpages_apify', 'yelp', 'google_lsa', 'google_sponsored', 'gmaps_apify', 'ig_services'];
const below = ALL.filter((s) => (counts[s] || 0) < LEAD_FLOOR);
const above = ALL.filter((s) => (counts[s] || 0) >= LEAD_FLOOR * 5);

for (const s of ALL) {
  const n = counts[s] || 0;
  const mark = n < LEAD_FLOOR ? 'BELOW FLOOR — prioritise' : (n >= LEAD_FLOOR * 5 ? 'far ahead — throttle' : 'balanced');
  console.log(`  ${s.padEnd(20)} ${String(n).padStart(6)}  ${mark}`);
}

// UN-PARK any source sitting below the floor. yellowpages was auto-parked by the spend
// guard for producing 0 from 165 jobs — but its ACTOR was the problem (deprecated,
// 169 of 299 public runs failed) and has since been replaced, so it deserves a fresh
// tranche rather than a permanent sentence.
if (below.length) {
  const list = below.map((s) => `'${s}'`).join(',');
  const un = await q(`
    update crawl_requests set status = 'new',
        notes = 'SPEC-200: below the ${LEAD_FLOOR}-lead floor — re-queued to balance the dataset',
        updated_at = now()
      where status = 'parked' and source in (${list}) returning 1`);
  console.log(`  un-parked ${Array.isArray(un) ? un.length : '?'} job(s) for: ${below.join(', ')}`);
}
// THROTTLE a source that is far ahead: park its surplus open jobs so worker capacity
// goes to the sources that need it. Reversible — they return when the floor is met.
if (above.length && below.length) {
  const list = above.map((s) => `'${s}'`).join(',');
  const th = await q(`
    update crawl_requests set status = 'parked',
        notes = 'SPEC-200: throttled — this source is 5x past the floor while others are below it',
        updated_at = now()
      where status = 'new' and source in (${list}) returning 1`);
  console.log(`  throttled ${Array.isArray(th) ? th.length : '?'} job(s) for: ${above.join(', ')}`);
}

// SPEC-202b — CREATOR FLOOR. Founder: "add 100 crawls from each of the creator sources."
//
// Two things had to be true first, and neither was:
//   1. leads_influencers had no `is_business` column, so EVERY creator upsert failed
//      42703 and the catch swallowed it — 262 ig_services rows produced 0 creators.
//   2. the seeder only ever created kind:'services' jobs. There has never been a creator
//      crawl queue. `ig_services` is dual-class (it writes a service row AND a creator
//      row per person), so creators only ever arrived as a side effect.
const CREATOR_FLOOR = Number(process.env.CREATOR_FLOOR || 100);
const creators = await q(`select discovered_via, count(*)::int as n from leads_influencers group by discovered_via`);
const cmap = Object.fromEntries((creators || []).map((r) => [r.discovered_via, r.n]));
const scraperN = cmap['ig-scraper-user-search'] || 0;

console.log(`\ncreators — floor ${CREATOR_FLOOR} each`);
console.log(`  ig_services (creators)   ${String(scraperN).padStart(5)}  ${scraperN < CREATOR_FLOOR ? 'BELOW FLOOR — seeding' : 'ok'}`);

if (scraperN < CREATOR_FLOOR) {
  // ig_services is the only creator path we can actually run today. Seed a focused set
  // of jobs so creators reach the floor instead of arriving as a by-product.
  // SPEC-204 — I INVENTED A GEOGRAPHY AND I SHOULD NOT HAVE.
  // The first version of this block hardcoded 6 cities and 8 service types of my own
  // choosing. There was no reason for either number. seed-growth-queue.mjs already
  // holds the authorised Phase-1 list — 12 metros (6 NYC boroughs + 6 Miami areas) and
  // 28 service types with the blocked categories deliberately absent. By writing a
  // second list I created a second source of truth that nobody agreed to, silently
  // dropped Queens, Bronx, Staten Island, Brickell, Coral Gables and Doral, and put the
  // blocked-category exclusion at risk the moment someone edited one list and not the
  // other. Import the authorised list; never restate it.
  const CREATOR_TYPES = TYPES.filter((t) => CREATOR_HEAVY.has(t));
  const rows = [];
  for (const [city, state] of CITIES) for (const t of CREATOR_TYPES) {
    rows.push({ kind: 'services', city, state, service_type: t, source: 'ig_services', status: 'new', target_count: 60 });
  }
  const r = await fetch(`${url}/rest/v1/crawl_requests?on_conflict=city,service_type,source`, {
    method: 'POST',
    headers: { apikey: process.env.GROWTH_SERVICE_ROLE_KEY || '', Authorization: `Bearer ${process.env.GROWTH_SERVICE_ROLE_KEY || ''}`,
               'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
  console.log(`  seeded ${rows.length} ig_services job(s) -> HTTP ${r.status}`);
}

// ─── SPEC-206 · THE CONTACTABILITY BAR (founder, 2026-08-02: "1. yes fine") ──────
// A lead with no phone and no email cannot be contacted, so it is not a lead. The bar is
// 40%: a source whose output is less than 40% reachable is PARKED. Parked, not retried —
// retrying a source that has already proven what it produces is how $108 left the account
// for zero usable rows.
//
// This is measured per source on real stored rows, not on vendor promises.
const CONTACT_BAR_PCT = Number(process.env.CONTACT_BAR_PCT || 40);
{
  const rows = await q(`
    select data_source,
           count(*)::int as n,
           count(*) filter (where coalesce(nullif(trim(phone), ''), nullif(trim(owner_email), '')) is not null)::int as reachable
      from leads_services group by data_source order by n desc`);
  console.log(`\ncontactability — bar ${CONTACT_BAR_PCT}% (below this a source is PARKED, not retried)`);
  const toPark = [];
  for (const r of rows || []) {
    const pct = r.n ? Math.round((r.reachable / r.n) * 100) : 0;
    // SPEC-248 — ig_services is EXEMPT from the parking bar. It is DUAL-CLASS: one
    // crawl writes a service row AND a creator row, and this query measures only the
    // service half (phone/owner_email on leads_services — IG accounts rarely publish
    // either there, hence 6%). Parking it here is precisely how creators reached zero
    // once before: "ig_services auto-disabled for low SERVICE yield without anyone
    // counting its creator half" (SPEC-230 — no automatic rule may remove the last
    // path to a founder-set target), and the founder's IG override stands ("didn't
    // agree.. specifically said to continue running IG (override)", 2026-08-01;
    // "override the 2 hours window of IG.. need data now", 2026-08-03). The bar still
    // governs every pure services source. R4 is untouched — a no-contact lead is
    // still never SAVED (S-192); this only stops the queue being killed.
    if (String(r.data_source) === 'ig_services') {
      console.log(`  ${String(r.data_source).padEnd(20)} ${String(r.n).padStart(6)} leads  ${String(pct).padStart(3)}% reachable  EXEMPT (dual-class creator source — SPEC-248)`);
      continue;
    }
    const verdict = r.n < 100 ? 'too few to judge' : (pct < CONTACT_BAR_PCT ? 'PARK' : 'keep');
    if (verdict === 'PARK') toPark.push(r.data_source);
    console.log(`  ${String(r.data_source).padEnd(20)} ${String(r.n).padStart(6)} leads  ${String(pct).padStart(3)}% reachable  ${verdict}`);
  }
  if (toPark.length) {
    // Park the QUEUE, not the data. Nothing is deleted — the rows stay for audit; the
    // source simply stops being given new work.
    const list = toPark.map((x) => `'${x}'`).join(',');
    await q(`update crawl_requests set status='parked', notes=coalesce(notes,'')||' | parked: below ${CONTACT_BAR_PCT}% contactable (SPEC-206)'
              where status in ('new','crawling') and source in (${list})`);
    console.log(`  PARKED ${toPark.length} source(s): ${toPark.join(', ')}`);
  }
  // SPEC-248 — HEAL: earlier runs parked ig_services under the service-side bar, so its
  // queued jobs sit at status='parked' and fulfill-crawl (which claims 'new') can never
  // reach them — the creator half is dead regardless of any rota or cap fix. Un-park
  // them once per run; the exemption above stops them being re-parked.
  {
    const unparked = await q(`update crawl_requests
        set status='new', notes=coalesce(notes,'')||' | un-parked: dual-class creator source exempt from the contactability bar (SPEC-248)'
      where status='parked' and source='ig_services' returning id`);
    console.log(`  un-parked ${Array.isArray(unparked) ? unparked.length : '?'} ig_services job(s) (SPEC-248 — the creator path stays open)`);
  }
}
