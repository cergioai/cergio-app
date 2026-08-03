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
//
// SPEC-245 — THE FOUNDER'S TIERED LIST (2026-08-02, recorded verbatim in
// specs/CERGIO-CRAWL-LISTS.md — that file is the source of truth; this is its
// encoding). Tier order IS crawl order: the seeder emits Tier 1 first, so Tier-1 jobs
// carry the oldest created_at and the FIFO priority queue drains them before Tier 2,
// and Tier 2 before Tier 3. The founder marked four Tier-3 entries BLOCKED (sports
// massage, private chef, DJ, makeup artist) — they are deliberately ABSENT here and
// gate #245 runs every entry against fulfill-crawl's blocklist so a blocked type can
// never ride in on a list edit. The PHASE 3 list is FORTHCOMING from the founder —
// do not invent it; these lists are complete until it arrives.
export const TYPES_T1 = [
  'personal trainer', 'dog walker', 'dog trainer', 'babysitter', 'house cleaning',
  'handyman', 'hair stylist', 'photographer', 'tutor', 'mover', 'pet sitter',
  'home organizer',
];
export const TYPES_T2 = [
  'nutritionist', 'life coach', 'personal assistant', 'driver', 'housekeeper',
  'plumber', 'electrician', 'contractor', 'painter', 'landscaping', 'locksmith',
  'appliance repair', 'window cleaning', 'pressure washing', 'junk removal', 'barber',
];
export const TYPES_T3 = [
  'carpet cleaning', 'upholstery cleaning', 'gutter cleaning', 'roof repair', 'HVAC',
  'air duct cleaning', 'pest control', 'pool cleaning', 'tile and grout',
  'drywall repair', 'flooring', 'carpentry', 'furniture assembly', 'tv mounting',
  'smart home installation', 'car detailing', 'mobile mechanic', 'bike repair',
  'computer repair', 'phone repair', 'laundry and dry cleaning pickup',
  'errand runner', 'senior companion', 'night nurse', 'postpartum doula',
  'newborn care specialist', 'nanny', 'after-school care', 'music teacher',
  'language tutor', 'test prep tutor', 'swim instructor', 'tennis coach',
  'golf coach', 'yoga instructor', 'pilates instructor', 'run coach',
  'physical therapist', 'stretch therapist', 'meal prep', 'bartender for hire',
  'event server', 'event planner', 'wedding planner', 'florist', 'videographer',
  'photo booth', 'live musician', 'balloon and decor', 'face painter',
  'kids entertainer', 'pet groomer', 'mobile vet', 'dog boarding', 'cat sitter',
  'aquarium maintenance', 'plant care', 'interior designer', 'home stager',
  'closet designer', 'handywoman', 'junk hauling', 'moving labor',
  'packing service', 'storage organizer', 'estate cleanout',
  'pressure wash driveway', 'window tinting', 'solar panel cleaning',
  'holiday lighting', 'snow removal', 'lawn mowing', 'tree trimming',
  'irrigation repair', 'fence repair', 'deck staining', 'garage door repair',
  'locksmith emergency', 'security camera install', 'notary', 'bookkeeper',
  'tax preparer', 'resume writer', 'career coach', 'business coach',
  'social media manager', 'web designer', 'brand photographer', 'hair braider',
  'barber home visit', 'nail technician', 'lash technician', 'brow artist',
  'spray tan', 'personal stylist', 'tailor and alterations', 'shoe repair',
  'dry cleaner delivery',
];
// TYPES is DERIVED — tier order is the one definition of crawl order. Nothing may
// restate these lists (Part-6: two copies is a defect on its own).
export const TYPES = [...TYPES_T1, ...TYPES_T2, ...TYPES_T3];

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
//
// SPEC-244 — KEYED BY NIELSEN DMA, NOT BY STATE (founder, 2026-08-03, verbatim: "THE
// DMA is technically held by it's own DMA definition (that's unrelated to state)...
// orlando is also a key DMA in FL... NYC DMA includes Jersey City (state of new
// jersey)... this is standard DMA ... use a standard DMA definition / boundary").
// The old keys were the state column ('NY'/'FL') used as a proxy — WRONG per founder:
// a state is not a DMA (Florida holds Miami-Ft. Lauderdale AND Orlando AND Tampa; the
// New York DMA reaches into NJ and CT). Keys are now Nielsen DMA codes: 501 = New York,
// 528 = Miami-Ft. Lauderdale (Nielsen 2024-25 Local Television Market Universe
// Estimates — the same source as the household counts behind the quota formula).
// Jersey City and Newark are in the 501 bucket because the founder named them; other
// NJ/CT locations inside the New York DMA are TODO — add each one against the Nielsen
// county list when it appears in real data, never from memory (south NJ belongs to the
// Philadelphia DMA 504, so a blanket NJ rule would be wrong in both directions).
export const DMA_LOCATIONS = {
  '501': ['New York', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island',
          'Jersey City', 'Newark'],
  '528': ['Miami', 'Miami Beach', 'Brickell', 'Wynwood', 'Coral Gables', 'Doral',
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
    // SPEC-244: membership is by LOCATION → DMA (the committed grouping above), never
    // by the state column — Jersey City is an NJ location inside the New York DMA.
    const cities = PHASE1.filter(([c]) => short.some((dma) => (DMA_LOCATIONS[dma] || []).includes(c)));
    return { cities, phase: 1, reason: `${short.map((d) => `DMA ${d} ${dmaTotals[d]}/${PHASE1_DMA_QUOTA[d] ?? '?'}`).join(', ')} below DMA quota` };
  }
  return { cities: [...PHASE1, ...PHASE2], phase: 2, reason: `every Phase-1 DMA at quota (${Object.entries(dmaTotals).map(([d, n]) => `${d} ${n}/${PHASE1_DMA_QUOTA[d]}`).join(', ')}) — Phase 2 unlocked` };
}
