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

// CERGIO-GUARD (2026-05-28): expanded to cover synonyms, verb forms,
// conversational phrasing ("my toilet is clogged"), Spanish keywords
// (Miami launch context), and plurals. Combined with the fuzzy fallback
// in resolveProviderTypeLocal, every realistic typo of these keys also
// routes correctly. qa.mjs #29 locks 50+ test phrases.
export const PROVIDER_TYPE_MAP = [
  // ── home cleaning ────────────────────────────────────────────────────
  ['deep cleaning',        'House Cleaner'],
  ['deep clean',           'House Cleaner'],
  ['move-out clean',       'House Cleaner'],
  ['move out clean',       'House Cleaner'],
  ['weekly cleaning',      'House Cleaner'],
  ['housekeeper',          'House Cleaner'],
  ['housekeeping',         'House Cleaner'],
  ['house cleaner',        'House Cleaner'],
  ['cleaning service',     'House Cleaner'],
  ['cleaning lady',        'House Cleaner'],
  ['maid service',         'House Cleaner'],
  ['maid',                 'House Cleaner'],
  ['cleaner',              'House Cleaner'],
  ['cleaning',             'House Cleaner'],
  // Spanish (Miami launch — large Spanish-speaking market)
  ['limpieza',             'House Cleaner'],
  ['limpiadora',           'House Cleaner'],
  ['mucama',               'House Cleaner'],
  // Conversational verbs — token "clean" alone is too short for the
  // fuzzy gate (≤5 chars → dist 1), so we anchor on phrases.
  ['clean my house',       'House Cleaner'],
  ['clean my place',       'House Cleaner'],
  ['clean my apartment',   'House Cleaner'],
  ['clean my home',        'House Cleaner'],

  // ── plumbing ─────────────────────────────────────────────────────────
  ['unclog toilet',        'Plumber'],
  ['unclog drain',         'Plumber'],
  ['unclog sink',          'Plumber'],
  ['unclog',               'Plumber'],
  ['clogged toilet',       'Plumber'],
  ['clogged drain',        'Plumber'],
  ['clogged sink',         'Plumber'],
  ['toilet clogged',       'Plumber'],
  ['toilet is clogged',    'Plumber'],
  ['leaky faucet',         'Plumber'],
  ['leaking faucet',       'Plumber'],
  ['leaky sink',           'Plumber'],
  ['leaky pipe',           'Plumber'],
  ['leak',                 'Plumber'],
  ['leaking',              'Plumber'],
  ['water heater',         'Plumber'],
  ['pipe burst',           'Plumber'],
  ['broken pipe',          'Plumber'],
  ['plumber',              'Plumber'],
  ['plumbing',             'Plumber'],
  ['plomero',              'Plumber'],   // Spanish
  ['fontanero',            'Plumber'],   // Spanish

  // ── pet / personal ───────────────────────────────────────────────────
  ['dog walker',           'Dog Walker'],
  ['dog walking',          'Dog Walker'],
  ['walk my dog',          'Dog Walker'],
  ['pet sitter',           'Pet Sitter'],
  ['cat sitter',           'Pet Sitter'],
  ['dog sitter',           'Pet Sitter'],
  ['pet sitting',          'Pet Sitter'],
  ['dog groomer',          'Pet Groomer'],
  ['dog grooming',         'Pet Groomer'],
  ['pet groomer',          'Pet Groomer'],
  ['pet grooming',         'Pet Groomer'],
  ['groomer',              'Pet Groomer'],

  // ── childcare — distinguish nanny vs babysitter (different commitment)
  ['live-in nanny',        'Live-In Nanny'],
  ['live in nanny',        'Live-In Nanny'],
  ['nanny',                'Nanny'],
  ['babysitter',           'Babysitter'],
  ['baby sitter',          'Babysitter'],
  ['babysitting',          'Babysitter'],
  ['sitter',               'Babysitter'],
  ['daycare',              'Babysitter'],
  ['childcare',            'Babysitter'],
  ['kids care',            'Babysitter'],
  ['niñera',               'Nanny'],     // Spanish
  ['ninera',               'Nanny'],     // unaccented variant

  // ── mobility ─────────────────────────────────────────────────────────
  ['airport pickup',       'Driver'],
  ['airport drop',         'Driver'],
  ['airport ride',         'Driver'],
  ['driver',               'Driver'],
  ['chauffeur',            'Driver'],
  ['ride',                 'Driver'],

  // ── handyman / installation ──────────────────────────────────────────
  ['handyman',             'Handyman'],
  ['handy man',            'Handyman'],
  ['repair',               'Handyman'],
  ['fix-it',               'Handyman'],
  ['tv mount',             'Handyman'],
  ['furniture assembly',   'Handyman'],
  ['assemble furniture',   'Handyman'],
  ['ikea',                 'Handyman'],
  ['mount tv',             'Handyman'],
  ['hang shelves',         'Handyman'],

  // ── electrical ──────────────────────────────────────────────────────
  ['electrician',          'Electrician'],
  ['electrical',           'Electrician'],
  ['rewire',               'Electrician'],
  ['wiring',               'Electrician'],
  ['electricista',         'Electrician'], // Spanish

  // ── hvac ─────────────────────────────────────────────────────────────
  ['hvac',                 'HVAC Technician'],
  ['ac repair',            'HVAC Technician'],
  ['ac broken',            'HVAC Technician'],
  ['air conditioning',     'HVAC Technician'],
  ['air conditioner',      'HVAC Technician'],
  ['heating repair',       'HVAC Technician'],
  ['furnace',              'HVAC Technician'],

  // ── beauty ───────────────────────────────────────────────────────────
  ['hairstylist',          'Hairstylist'],
  ['hair stylist',         'Hairstylist'],
  ['hairdresser',          'Hairstylist'],
  ['hair cut',             'Hairstylist'],
  ['haircut',              'Hairstylist'],
  ['blowout',              'Hairstylist'],
  ['hair',                 'Hairstylist'],
  ['barber',               'Barber'],
  ['barbershop',           'Barber'],
  ["men's haircut",        'Barber'],
  ['manicure',             'Nail Tech'],
  ['pedicure',             'Nail Tech'],
  ['nails',                'Nail Tech'],
  ['nail',                 'Nail Tech'],
  ['makeup',               'Makeup Artist'],
  ['make-up',              'Makeup Artist'],
  ['glam',                 'Makeup Artist'],
  // CERGIO-GUARD (2026-06-03): 'massage' / 'masseuse' mappings REMOVED —
  // Massage Therapist is now an out-of-scope provider type per Tarik
  // (lives in OUT_OF_SCOPE_PROVIDER_TYPES in data/providerTypes.js).

  // ── fitness / wellness ───────────────────────────────────────────────
  // CERGIO-GUARD (2026-07-14, QA live walk — SPEC-67c confident-wrong):
  // "need dog trainer tuesday" resolved to Personal Trainer (the bare
  // 'trainer' key), so a dog-training request notified gym trainers and no
  // dog trainer ever saw it. 'Dog Trainer' / 'Puppy Trainer' are real
  // provider types (src/data/providerTypes.js) — the longer key wins the
  // longest-match pass, so these must sit alongside the generic one.
  ['dog trainer',          'Dog Trainer'],
  ['dog training',         'Dog Trainer'],
  ['puppy trainer',        'Dog Trainer'],
  ['puppy training',       'Dog Trainer'],
  ['train my dog',         'Dog Trainer'],
  ['obedience training',   'Dog Trainer'],
  ['personal trainer',     'Personal Trainer'],
  ['trainer',              'Personal Trainer'],
  ['fitness trainer',      'Personal Trainer'],
  ['gym trainer',          'Personal Trainer'],
  ['yoga teacher',         'Yoga Instructor'],
  ['yoga instructor',      'Yoga Instructor'],
  ['yoga class',           'Yoga Instructor'],
  ['yoga',                 'Yoga Instructor'],
  ['pilates instructor',   'Pilates Instructor'],
  ['pilates',              'Pilates Instructor'],

  // ── food / events — "Personal Chef" not "Chef" (matches seed) ────────
  ['personal chef',        'Personal Chef'],
  ['private chef',         'Personal Chef'],
  ['in-home chef',         'Personal Chef'],
  ['dinner party chef',    'Personal Chef'],
  ['chef',                 'Personal Chef'],
  ['catering',             'Caterer'],
  ['caterer',              'Caterer'],
  ['cater',                'Caterer'],
  ['bartender',            'Bartender'],
  ['bartending',           'Bartender'],

  // ── photo / video ────────────────────────────────────────────────────
  ['photographer',         'Photographer'],
  ['photo shoot',          'Photographer'],
  ['videographer',         'Videographer'],
  ['video shoot',          'Videographer'],

  // ── outdoor ──────────────────────────────────────────────────────────
  ['gardener',             'Gardener'],
  ['gardening',            'Gardener'],
  ['landscaper',           'Landscaper'],
  ['lawn care',            'Landscaper'],
  ['lawn',                 'Landscaper'],
  ['jardinero',            'Gardener'],   // Spanish
  ['pool cleaner',         'Pool Cleaner'],
  ['pool cleaning',        'Pool Cleaner'],
  ['pool service',         'Pool Cleaner'],

  // ── moving ───────────────────────────────────────────────────────────
  ['movers',               'Mover'],
  ['mover',                'Mover'],
  ['moving help',          'Mover'],

  // ── tutoring ─────────────────────────────────────────────────────────
  ['math tutor',           'Tutor'],
  ['tutor',                'Tutor'],
  ['tutoring',             'Tutor'],
  ['piano lesson',         'Music Teacher'],
  ['piano teacher',        'Music Teacher'],
  ['guitar lesson',        'Music Teacher'],
  ['guitar teacher',       'Music Teacher'],
  ['music teacher',        'Music Teacher'],
  ['music lesson',         'Music Teacher'],
];

// Longest matching key wins so "deep cleaning" beats "cleaning" and
// "unclog toilet" beats "unclog". Returns null when no key matches —
// callers must then either fall back to Claude (semantic) OR show an
// honest empty state. Never invent a match.
//
// CERGIO-GUARD (2026-05-28): we ALSO try a fuzzy fallback so common
// typos like "clenaing" / "cleening" still route to House Cleaner.
// Pattern: any meaningful token (≥4 chars) in the user's text within
// edit distance 2 of a token in any taxonomy key counts as a hit. We
// pick the longest key whose tokens ALL fuzzy-match at least one
// user token. Conservative — never overrides an exact-substring hit.
export function resolveProviderTypeLocal(text) {
  const l = String(text || '').toLowerCase();

  // CERGIO-GUARD (2026-06-03): out-of-scope short-circuit. If the user's
  // text mentions an out-of-scope category (massage, dance, DJ, food/
  // drink venues, etc.), return null up-front so we never route those
  // requests through the marketplace.
  // eslint-disable-next-line global-require
  // Local import to avoid a circular dep cycle.
  const OUT_OF_SCOPE_KEYWORDS = [
    'massage', 'masseuse', 'dance', 'ballet', 'ballroom',
    'dj ', ' dj', 'restaurant', 'cafe', 'coffee shop',
    'brewery', 'winery', 'wine bar', 'cocktail bar',
    'sports bar', 'food truck', 'food cart', 'distillery', 'pub',
  ];
  for (const kw of OUT_OF_SCOPE_KEYWORDS) {
    if (l.includes(kw)) return null;
  }

  // Pass 1: exact-substring match (canonical, fast path).
  let bestKey = null;
  for (const [k, v] of PROVIDER_TYPE_MAP) {
    if (l.includes(k) && (bestKey === null || k.length > bestKey[0].length)) {
      bestKey = [k, v];
    }
  }
  if (bestKey) return bestKey[1];

  // Pass 2: fuzzy fallback. Tokenize the user's text + each taxonomy
  // key, then a key matches if ALL its meaningful tokens (≥4 chars)
  // are within edit-distance 2 of SOME user token. ≤3-char tokens
  // (e.g. "ac" in "ac repair") must match exactly to avoid false
  // positives. Longest matching key wins, same as pass 1.
  const userTokens = l.match(/[a-z]+/g) || [];
  if (userTokens.length === 0) return null;

  let bestFuzzy = null;
  for (const [k, v] of PROVIDER_TYPE_MAP) {
    const keyTokens = k.match(/[a-z]+/g) || [];
    if (keyTokens.length === 0) continue;
    const allMatch = keyTokens.every(kt => {
      // Threshold scales with token length so longer words tolerate more
      // typos. "clenaings" vs "cleaning" is dist 3, so we need ≥3 for the
      // 8-char tier. ≤3-char tokens still require exact match (no false
      // positives on "ac", "tv", etc.).
      const minDist = kt.length <= 3 ? 0
                    : kt.length <= 5 ? 1
                    : kt.length <= 7 ? 2
                    :                  3;
      return userTokens.some(ut => editDistance(kt, ut) <= minDist);
    });
    if (allMatch && (bestFuzzy === null || k.length > bestFuzzy[0].length)) {
      bestFuzzy = [k, v];
    }
  }
  return bestFuzzy ? bestFuzzy[1] : null;
}

// Levenshtein distance — small enough that a full DP table is fine.
// Used only in the fuzzy fallback; never on the hot path. Cap input
// length at 24 so a pathological query string can't DOS the matcher.
function editDistance(a, b) {
  if (a === b) return 0;
  a = String(a).slice(0, 24);
  b = String(b).slice(0, 24);
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let cur  = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(
        prev[j]     + 1,        // deletion
        cur[j - 1]  + 1,        // insertion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[bl];
}

// Canonical plurals — used in user-facing copy. "Looking for [plural]…"
// Most provider_types end in -er/-or/-ist/-ant so naïve +s would work,
// but we keep an explicit map for words like "Personal Chef" → "Personal
// Chefs" vs "Live-In Nanny" → "Live-In Nannies" etc. Anything not here
// falls back to type + "s" via pluralProviderTypeLocal below.
const PROVIDER_TYPE_PLURALS = {
  'House Cleaner':         'House Cleaners',
  'Plumber':               'Plumbers',
  'Dog Walker':            'Dog Walkers',
  'Pet Sitter':            'Pet Sitters',
  'Live-In Nanny':         'Live-In Nannies',
  'Nanny':                 'Nannies',
  'Babysitter':            'Babysitters',
  'Driver':                'Drivers',
  'Handyman':              'Handymen',
  'Electrician':           'Electricians',
  'HVAC Technician':       'HVAC Technicians',
  'Hairstylist':           'Hairstylists',
  'Barber':                'Barbers',
  'Nail Tech':             'Nail Techs',
  'Makeup Artist':         'Makeup Artists',
  'Massage Therapist':     'Massage Therapists',
  'Personal Trainer':      'Personal Trainers',
  'Yoga Instructor':       'Yoga Instructors',
  'Pilates Instructor':    'Pilates Instructors',
  'Personal Chef':         'Personal Chefs',
  'Caterer':               'Caterers',
  'Bartender':             'Bartenders',
  'Photographer':          'Photographers',
  'Videographer':          'Videographers',
  'Tutor':                 'Tutors',
  'Music Teacher':         'Music Teachers',
};

export function pluralProviderTypeLocal(provider_type) {
  if (!provider_type) return null;
  if (PROVIDER_TYPE_PLURALS[provider_type]) return PROVIDER_TYPE_PLURALS[provider_type];
  // Generic fallback: ends in -y → -ies; ends in -s/-x/-ch/-sh → +es;
  // else +s. Keeps decent grammar for novel types Claude returns until
  // we add them to PROVIDER_TYPE_PLURALS above.
  if (/y$/i.test(provider_type)) return provider_type.replace(/y$/i, 'ies');
  if (/(s|x|ch|sh)$/i.test(provider_type)) return provider_type + 'es';
  return provider_type + 's';
}
