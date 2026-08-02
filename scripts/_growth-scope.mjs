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
