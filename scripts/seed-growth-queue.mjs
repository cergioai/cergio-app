// Seed the GROWTH crawl queue directly over REST.
//
// Why this exists: after the cutover the growth database started EMPTY, and
// nothing can crawl an empty queue — "the crawls are dead" is the expected
// symptom until crawl_requests has rows. The seeders are edge functions on
// pg_cron, which adds two failure modes (cron not firing, missing edge env),
// neither visible from off-Mac. This path needs neither: just the growth URL +
// service key CI already holds.
//
// Idempotent: an OPEN job for the same (city, service_type, source) is skipped,
// so re-running TOPS UP the queue instead of duplicating it.
// SPEC-144 — MEASURED: PGRST125 "Invalid path specified in request URL". The
// secret carries a TRAILING SLASH, so every call built "…//rest/v1/…" and the
// seed failed while the auth check (which accepted 404 as success) passed green.
// Normalise once, here, so no caller can hit it again.
const URL_G = (process.env.GROWTH_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.GROWTH_SERVICE_ROLE_KEY;
if (!URL_G || !KEY) { console.error('GROWTH_SUPABASE_URL / GROWTH_SERVICE_ROLE_KEY not set'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Phase 1 only — Miami + NYC, per the frozen spec. No other DMA is seeded.
const CITIES = [
  ['New York', 'NY'], ['Manhattan', 'NY'], ['Brooklyn', 'NY'], ['Queens', 'NY'],
  ['Bronx', 'NY'], ['Staten Island', 'NY'],
  ['Miami', 'FL'], ['Miami Beach', 'FL'], ['Brickell', 'FL'], ['Wynwood', 'FL'],
  ['Coral Gables', 'FL'], ['Doral', 'FL'],
];
// Blocked categories deliberately absent (no massage/tattoo/makeup/personal chef,
// no medical/peptide/med-spa, no SHAFT).
const TYPES = [
  'dog trainer', 'pet sitter', 'personal trainer', 'nutritionist', 'tutor',
  'housekeeper', 'plumber', 'electrician', 'handyman', 'contractor', 'babysitter',
  'driver', 'personal assistant', 'life coach', 'photographer', 'home organizer',
  'barber', 'mover', 'house cleaning', 'landscaping', 'locksmith',
  'appliance repair', 'dog walker', 'hair stylist', 'window cleaning',
  'pressure washing', 'junk removal', 'painter',
];
const SOURCES = [
  ['yelp', 240], ['craigslist', 1000], ['gmaps_apify', 60], ['yellowpages_apify', 1000],
  ['google_lsa', 1000], ['google_sponsored', 50], ['osm', 100], ['ig_services', 200],
];

const existing = new Set();
try {
  const r = await fetch(
    `${URL_G}/rest/v1/crawl_requests?select=city,service_type,source&status=in.(new,crawling)&limit=20000`,
    { headers: H });
  if (r.ok) for (const j of await r.json()) existing.add(`${j.city}|${j.service_type}|${j.source}`);
} catch { /* first run: nothing open yet */ }
console.log(`open jobs already queued: ${existing.size}`);

const rows = [];
for (const [source, depth] of SOURCES)
  for (const [city, state] of CITIES)
    for (const t of TYPES) {
      if (existing.has(`${city}|${t}|${source}`)) continue;
      rows.push({ kind: 'services', city, state, service_type: t, source, status: 'new', target_count: depth });
    }
console.log(`seeding ${rows.length} new job(s) — ${SOURCES.length} sources x ${CITIES.length} metros x ${TYPES.length} types`);

let ok = 0, fail = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const r = await fetch(`${URL_G}/rest/v1/crawl_requests`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(chunk),
  });
  if (r.ok) { ok += chunk.length; continue; }
  // one bad row must never cost the other 199
  for (const row of chunk) {
    const rr = await fetch(`${URL_G}/rest/v1/crawl_requests`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row),
    });
    if (rr.ok) ok++; else fail++;
  }
}
console.log(`queued ${ok} · failed ${fail}`);
if (ok === 0 && rows.length > 0) { console.error('seeded NOTHING — the queue cannot grow'); process.exit(1); }
