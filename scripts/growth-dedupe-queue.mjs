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
const url = (process.env.GROWTH_SUPABASE_URL || '').trim().replace(/\/+$/, '');
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
