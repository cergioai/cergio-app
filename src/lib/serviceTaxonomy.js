// CERGIO-GUARD: THE local taxonomy from the spec.
//
// User phrase → canonical provider_type. Services register themselves
// under one of these provider_type strings (matches
// `services.taxonomy_provider_type` in Supabase). `listServices`
// filters STRICTLY by provider_type. If a phrase isn't in this map,
// the Claude chat-parse edge function takes over (semantic fallback).
// If neither resolves, the search returns honest empty — never fuzzy.
//
// This file is intentionally dependency-free so:
//   1. qa.mjs invariant #13 (canonical-query-resolves) can import it
//      via Node CLI without pulling in React/Vite paths, and
//   2. Edits to this map are mechanically reviewed against the seed.
//
// Source of truth: values here + the `provider_type` strings the seed
// scripts (Seed E2E Test Data.command, future onboarding flows) write
// MUST be IDENTICAL. Any drift is a HARD FAIL in qa.mjs #13.

export const PROVIDER_TYPE_MAP = [
  // home cleaning
  ['deep clean',           'House Cleaner'],
  ['deep cleaning',        'House Cleaner'],
  ['housekeeper',          'House Cleaner'],
  ['house cleaner',        'House Cleaner'],
  ['cleaning service',     'House Cleaner'],
  ['cleaner',              'House Cleaner'],
  ['cleaning',             'House Cleaner'],
  // plumbing
  ['unclog toilet',        'Plumber'],
  ['unclog drain',         'Plumber'],
  ['unclog',               'Plumber'],
  ['leaky faucet',         'Plumber'],
  ['leaking faucet',       'Plumber'],
  ['leak',                 'Plumber'],
  ['water heater',         'Plumber'],
  ['plumber',              'Plumber'],
  ['plumbing',             'Plumber'],
  // pet / personal
  ['dog walker',           'Dog Walker'],
  ['dog walking',          'Dog Walker'],
  ['pet sitter',           'Pet Sitter'],
  ['cat sitter',           'Pet Sitter'],
  ['pet sitting',          'Pet Sitter'],
  // childcare — distinguish nanny vs babysitter (different commitment)
  ['live-in nanny',        'Live-In Nanny'],
  ['nanny',                'Nanny'],
  ['babysitter',           'Babysitter'],
  ['babysitting',          'Babysitter'],
  // mobility
  ['driver',               'Driver'],
  ['chauffeur',            'Driver'],
  ['airport pickup',       'Driver'],
  ['ride',                 'Driver'],
  // handyman / installation
  ['handyman',             'Handyman'],
  ['repair',               'Handyman'],
  ['tv mount',             'Handyman'],
  ['furniture assembly',   'Handyman'],
  ['ikea',                 'Handyman'],
  // electrical
  ['electrician',          'Electrician'],
  ['electrical',           'Electrician'],
  // hvac
  ['hvac',                 'HVAC Technician'],
  ['ac repair',            'HVAC Technician'],
  ['air conditioning',     'HVAC Technician'],
  // beauty
  ['hairstylist',          'Hairstylist'],
  ['hair',                 'Hairstylist'],
  ['barber',               'Barber'],
  ['nail',                 'Nail Tech'],
  ['makeup',               'Makeup Artist'],
  ['massage',              'Massage Therapist'],
  // fitness / wellness
  ['personal trainer',     'Personal Trainer'],
  ['trainer',              'Personal Trainer'],
  ['yoga',                 'Yoga Instructor'],
  ['pilates',              'Pilates Instructor'],
  // food / events — match seed: "Personal Chef" not "Chef" (the
  // seeded provider registers as "Personal Chef" because they cook
  // in clients' homes, not a restaurant).
  ['personal chef',        'Personal Chef'],
  ['private chef',         'Personal Chef'],
  ['chef',                 'Personal Chef'],
  ['catering',             'Caterer'],
  ['cater',                'Caterer'],
  ['bartender',            'Bartender'],
  ['photographer',         'Photographer'],
  ['videographer',         'Videographer'],
  // tutoring
  ['tutor',                'Tutor'],
  ['piano lesson',         'Music Teacher'],
  ['guitar lesson',        'Music Teacher'],
];

// Longest matching key wins so "deep cleaning" beats "cleaning" and
// "unclog toilet" beats "unclog". Returns null when no key matches —
// callers must then either fall back to Claude (semantic) OR show an
// honest empty state. Never invent a match.
export function resolveProviderTypeLocal(text) {
  const l = String(text || '').toLowerCase();
  let bestKey = null;
  for (const [k, v] of PROVIDER_TYPE_MAP) {
    if (l.includes(k) && (bestKey === null || k.length > bestKey[0].length)) {
      bestKey = [k, v];
    }
  }
  return bestKey ? bestKey[1] : null;
}
