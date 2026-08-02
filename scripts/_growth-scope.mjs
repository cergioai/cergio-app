// THE AUTHORISED PHASE-1 SCOPE — the single source of truth for WHERE and WHAT we crawl.
// SPEC-204. This lived inside seed-growth-queue.mjs, which is a script: importing it to
// reuse the lists would have RUN the seeder as a side effect. So the lists move here and
// the seeder imports them like everyone else. Nothing may restate these arrays.
//
// Phase 1 only — Miami + NYC, per the frozen spec. No other DMA is seeded.
export const CITIES = [
  ['New York', 'NY'], ['Manhattan', 'NY'], ['Brooklyn', 'NY'], ['Queens', 'NY'],
  ['Bronx', 'NY'], ['Staten Island', 'NY'],
  ['Miami', 'FL'], ['Miami Beach', 'FL'], ['Brickell', 'FL'], ['Wynwood', 'FL'],
  ['Coral Gables', 'FL'], ['Doral', 'FL'],
];
// Blocked categories deliberately absent (no massage/tattoo/makeup/personal chef,
// no medical/peptide/med-spa, no SHAFT).
export const TYPES = [
  'dog trainer', 'pet sitter', 'personal trainer', 'nutritionist', 'tutor',
  'housekeeper', 'plumber', 'electrician', 'handyman', 'contractor', 'babysitter',
  'driver', 'personal assistant', 'life coach', 'photographer', 'home organizer',
  'barber', 'mover', 'house cleaning', 'landscaping', 'locksmith',
  'appliance repair', 'dog walker', 'hair stylist', 'window cleaning',
  'pressure washing', 'junk removal', 'painter',
];

// ─── PHASE GATING (SPEC-205, founder 2026-08-02) ────────────────────────────────
// "spec calls for miami and nyc to be filled first up to quota before moving to the
//  next 9 cities from top 10"
//
// PHASE 1 is the CITIES list above — the 6 NYC boroughs + 6 Miami areas. Nothing outside
// it may be seeded until Phase 1 is full.
export const PHASE1 = CITIES;

// PHASE 2 — the rest of the top-10 US metros by population, PLUS the 9th.
//
// The earlier note here refused to invent a 9th city ("next 9 cities from top 10" names
// nine, top 10 minus NYC and Miami is eight). RESOLVED BY THE FOUNDER, 2026-08-02: the
// 9th metro is BOSTON (chosen from options presented). Recorded in the build spec §3.4.
export const PHASE2 = [
  ['Los Angeles', 'CA'], ['Chicago', 'IL'], ['Dallas', 'TX'], ['Houston', 'TX'],
  ['Washington', 'DC'], ['Philadelphia', 'PA'], ['Atlanta', 'GA'], ['Phoenix', 'AZ'],
  ['Boston', 'MA'],
];

// ─── THE QUOTA IS A FORMULA, PER DMA — founder, 2026-08-02, verbatim: "50k services for
// nyc (with 5% of that as creators).. adjusting each city based on relative size of dma
// (eg: if miami is 10% of new it should be 5k services and 250 creators.." ─────────────
//
// services(city) = 50,000 × DMA(city)/DMA(NYC), Nielsen TV households, rounded to the
// nearest 100 → the committed map in growth-controls.json: {"NY":50000,"FL":11700}.
// The quota lives on the DMA, so the locations of one DMA fill ONE shared bucket —
// Brooklyn and Queens do not each get 50,000.
//
// DMA_LOCATIONS is that grouping: every location whose leads count toward a DMA's
// quota. It is the SEED list (CITIES) plus the legacy Miami areas that already hold
// queue rows and leads — shrinking to the seed list would strand real Phase-1 rows
// behind the phase-2 lock. fulfill-crawl carries the same grouping as a literal (Deno
// cannot import this module); gate #240 welds the two so they cannot drift — two city
// lists was already this project's Part-6 defect once.
export const DMA_LOCATIONS = {
  NY: ['New York', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
  FL: ['Miami', 'Miami Beach', 'Brickell', 'Wynwood', 'Coral Gables', 'Doral',
       'South Beach', 'Coconut Grove', 'Aventura', 'Little Havana', 'Hialeah',
       'North Miami', 'Kendall', 'Pinecrest'],
};

// FAIL-CLOSED parser: only a JSON object with exclusively positive numeric values
// counts as a quota. Empty, unparseable, a bare number, an array, a zero — all mean
// "no quota set" and Phase 2 stays locked. A value invented or mangled in transit must
// never authorise a national crawl.
export function parseQuotaMap(raw) {
  try {
    const j = JSON.parse(String(raw || ''));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const keys = Object.keys(j);
    if (!keys.length) return null;
    if (!keys.every((k) => typeof j[k] === 'number' && Number.isFinite(j[k]) && j[k] > 0)) return null;
    return j;
  } catch (_e) { return null; }
}
export const PHASE1_DMA_QUOTA = parseQuotaMap(process.env.PHASE1_CITY_QUOTA);

// Returns the cities that may be crawled RIGHT NOW.
// countsByCity: { 'Miami': 412, 'Brooklyn': 88, ... } — summed into DMA buckets here.
export function activeCities(countsByCity = {}) {
  if (!PHASE1_DMA_QUOTA) return { cities: PHASE1, phase: 1, reason: 'PHASE1_CITY_QUOTA unset or unparseable — Phase 2 locked (fail closed; the founder formula map is the only key)' };
  const dmaTotals = {};
  for (const [dma, locs] of Object.entries(DMA_LOCATIONS)) {
    dmaTotals[dma] = locs.reduce((a, c) => a + (countsByCity[c] || 0), 0);
  }
  // Every Phase-1 DMA must have a quota AND meet it. A DMA missing from the map is a
  // DMA whose quota we do not know — fail closed, never "unbounded".
  const short = Object.keys(DMA_LOCATIONS).filter((dma) => !(PHASE1_DMA_QUOTA[dma] > 0) || dmaTotals[dma] < PHASE1_DMA_QUOTA[dma]);
  if (short.length) {
    const cities = PHASE1.filter(([, st]) => short.includes(st));
    return { cities, phase: 1, reason: `${short.map((d) => `${d} ${dmaTotals[d]}/${PHASE1_DMA_QUOTA[d] ?? '?'}`).join(', ')} below DMA quota` };
  }
  return { cities: [...PHASE1, ...PHASE2], phase: 2, reason: `every Phase-1 DMA at quota (${Object.entries(dmaTotals).map(([d, n]) => `${d} ${n}/${PHASE1_DMA_QUOTA[d]}`).join(', ')}) — Phase 2 unlocked` };
}
