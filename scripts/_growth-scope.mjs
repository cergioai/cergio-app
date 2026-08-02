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

// PHASE 2 — the rest of the top-10 US metros by population.
//
// NOTE, AND I AM NOT GUESSING PAST IT: you said "the next 9 cities from top 10". The
// top 10 US metros minus New York and Miami is EIGHT, listed below. Either the 9th is a
// metro you have in mind that I do not, or the intended list is top 11. Phase 2 is
// locked regardless (see below), so this costs nothing today — but I am not inventing a
// 9th city to make the number match, which is exactly the mistake that produced the
// 6-city list.
export const PHASE2 = [
  ['Los Angeles', 'CA'], ['Chicago', 'IL'], ['Dallas', 'TX'], ['Houston', 'TX'],
  ['Washington', 'DC'], ['Philadelphia', 'PA'], ['Atlanta', 'GA'], ['Phoenix', 'AZ'],
];

// THE QUOTA IS NOT MINE TO PICK. No per-city quota exists anywhere in the spec, so there
// is no default here: unset means Phase 2 stays locked forever. Fail-closed. A default
// invented by me would silently authorise a national crawl.
export const PHASE1_CITY_QUOTA = Number(process.env.PHASE1_CITY_QUOTA || 0);

// Returns the cities that may be crawled RIGHT NOW.
// countsByCity: { 'Miami': 412, 'Brooklyn': 88, ... }
export function activeCities(countsByCity = {}) {
  if (!PHASE1_CITY_QUOTA) return { cities: PHASE1, phase: 1, reason: 'PHASE1_CITY_QUOTA unset — Phase 2 locked (founder must set the quota)' };
  const short = PHASE1.filter(([c]) => (countsByCity[c] || 0) < PHASE1_CITY_QUOTA);
  if (short.length) return { cities: short, phase: 1, reason: `${short.length} of ${PHASE1.length} Phase-1 metros below quota ${PHASE1_CITY_QUOTA}` };
  return { cities: [...PHASE1, ...PHASE2], phase: 2, reason: `all ${PHASE1.length} Phase-1 metros at quota ${PHASE1_CITY_QUOTA} — Phase 2 unlocked` };
}
