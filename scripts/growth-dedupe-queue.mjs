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
    add column if not exists lat double precision,
    add column if not exists lng double precision,
    add column if not exists requested_by uuid,
    add column if not exists delivered_count int default 0
`);
await q(`
  alter table public.leads_services
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

// SPEC-167b: the queue still holds thousands of OPEN jobs for sources measured at
// zero (see the seeder for the per-source evidence). Leaving them 'new' means the
// workers grind through dead combinations before reaching osm — the seeder change
// alone only stops NEW ones being added. Park them: reversible (a single UPDATE
// back to 'new'), auditable via the note, and never a delete — these are jobs, but
// the no-hard-delete habit is the right one to keep.
console.log('parking queued jobs for sources with zero measured yield…');
const parked = await q(`
  update crawl_requests
     set status = 'parked',
         notes  = 'SPEC-167: parked — source produced 0 rows in 8h of live running. Reversible: set status back to new.',
         updated_at = now()
   where status = 'new'
     and source in ('craigslist','yellowpages_apify','google_lsa','yelp','gmaps_apify','google_sponsored','ig_services')
  returning 1
`);
console.log(`parked ${Array.isArray(parked) ? parked.length : '?'} dead-source job(s)`);
const openNow = await q(`select source, count(*)::int as n from crawl_requests where status = 'new' group by source order by n desc`);
console.log('open queue by source now:', JSON.stringify(openNow));
