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
