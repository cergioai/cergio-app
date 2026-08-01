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
// SPEC-148: accept ANY form of the project URL. Measured: the secret was
// 'https://<ref>.supabase.co/rest/v1' (48 chars), so calls became
// '…/rest/v1/rest/v1/' -> 404. Reduce to scheme://host and discard the rest.
const URL_G = (() => {
  const raw = (process.env.GROWTH_SUPABASE_URL || '').trim();
  try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, ''); }
})();
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

// SPEC-156: this read was capped at limit=20000. Once the queue passed 20k rows,
// every job beyond that window looked unseen and was re-seeded on EVERY run — the
// queue compounded to 151,714 jobs against 2,688 real combinations (~56x), so
// workers would have burned nearly all their capacity re-crawling the same
// triples. Page until the source is exhausted; a truncated dedupe set is worse
// than none, because it silently looks like it worked.
const existing = new Set();
try {
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(
      `${URL_G}/rest/v1/crawl_requests?select=city,service_type,source&status=in.(new,crawling)`,
      { headers: { ...H, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok) break;
    const page = await r.json();
    for (const j of page) existing.add(`${j.city}|${j.service_type}|${j.source}`);
    if (page.length < PAGE) break;
  }
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
  // Prefer resolution=ignore-duplicates pairs with the SPEC-156 partial unique
  // index: even if the dedupe set above is somehow stale, the DB refuses the
  // duplicate instead of growing the queue.
  const r = await fetch(`${URL_G}/rest/v1/crawl_requests?on_conflict=city,service_type,source`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(chunk),
  });
  if (r.ok) { ok += chunk.length; continue; }
  // one bad row must never cost the other 199
  for (const row of chunk) {
    const rr = await fetch(`${URL_G}/rest/v1/crawl_requests`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(row),
    });
    if (rr.ok) ok++; else fail++;
  }
}
console.log(`queued ${ok} · failed ${fail}`);
if (ok === 0 && rows.length > 0) { console.error('seeded NOTHING — the queue cannot grow'); process.exit(1); }
