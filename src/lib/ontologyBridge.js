// CERGIO-GUARD — ONTOLOGY BRIDGE (SPEC-80). The permanent class-fix for the
// search↔listing type-mismatch near-miss.
//
// THE PROBLEM (live, founder-hit): a "french tutor" LISTING was typed
// "Language Immersion" (the cloud parser's granular node) while a "french
// tutor" / "tutor" SEARCH resolved to "Tutor". Both are correct labels for the
// SAME real-world service, but the matcher compared them for (case-insensitive)
// EQUALITY on taxonomy_provider_type / category — so they never matched and the
// request never reached the listed provider. Tutors are only the first symptom:
// the same near-miss exists for Nail Tech vs Nail Technician, Hairstylist vs
// Hair Stylist, House Cleaner vs Housekeeper, Driver vs Personal Driver, Music
// Teacher vs Piano/Guitar Teacher — anywhere the frontend canonical string and
// the backend/category string are siblings in one ontology class.
//
// THE FIX: a curated set of FAMILIES. Every family is a semantically TIGHT
// class whose members are interchangeable for matching (a search for any member
// should reach a listing typed as any other member). Two operations:
//
//   canonicalType(t)   — collapse a member to its family PARENT (deterministic
//                        canonicalization; applied in resolveProviderTypeLocal
//                        so a phrase resolves to one stable parent).
//   bridgeAllowSet(t)  — expand a searched type into its whole family (the
//                        allow-set used by getProvidersForNotify + listServices
//                        so a "Tutor" search's allow-set includes Language
//                        Immersion / Math Tutor / Language Tutor …).
//
// INVARIANTS:
//   • Dependency-free (pure data + string ops) so qa.mjs can import it via the
//     Node CLI without pulling in React/Vite — same contract as serviceTaxonomy.
//   • Families are TIGHT: full-family expansion must never surface a service a
//     user would consider a different category. When in doubt, leave a type
//     OUT (an un-familied type bridges only to itself — never a regression).
//   • BLOCKED categories (massage / tattoo / makeup / personal chef / SHAFT /
//     DJ-nightclub, SPEC-71.5) are NEVER placed in a family — the bridge can
//     only widen a match among in-scope, bookable types.
//
// Grow this file family-by-family. Adding a member is additive and reversible.

// Each family: { parent, members[] }. The parent MUST also appear in members.
export const FAMILIES = [
  // ── Tutoring & education. "french tutor"→Language Immersion (listing) vs
  //    "Tutor" (search) was the live near-miss that motivated the bridge. ──
  {
    parent: 'Tutor',
    members: [
      'Tutor', 'Math Tutor', 'Reading Tutor', 'Test Prep Tutor',
      'Language Tutor', 'Language Immersion', 'ESL Tutor', 'Academic Tutor',
      'Science Tutor', 'Homework Helper', 'Academic Support',
      'Educational Support', 'Home Education', 'Learning Differences',
      'Heritage Language Tutor',
    ],
  },
  // ── Music instruction — a "music teacher" / "music lessons" search should
  //    reach piano & guitar teachers (children of the same class). ──
  {
    parent: 'Music Teacher',
    members: [
      'Music Teacher', 'Piano Teacher', 'Guitar Teacher', 'Music Instruction',
      'Voice Teacher', 'Vocal Coach', 'Violin Teacher', 'Drum Teacher',
      'Singing Teacher',
    ],
  },
  // ── Nails — frontend canonical 'Nail Tech' vs backend 'Nail Technician'. ──
  { parent: 'Nail Tech', members: ['Nail Tech', 'Nail Technician'] },
  // ── House cleaning — 'House Cleaner' vs 'Housekeeper'. SPECIALIZED cleaners
  //    (Airbnb / Post-Construction / Window / Carpet) are deliberately OUT. ──
  {
    parent: 'House Cleaner',
    members: [
      'House Cleaner', 'Housekeeper', 'House Cleaning', 'Home Cleaner',
      'Maid', 'Cleaning Service',
    ],
  },
  // ── Hair — 'Hairstylist' vs 'Hair Stylist' / 'Hair Colourist'. Barber is
  //    intentionally SEPARATE (distinct service). ──
  {
    parent: 'Hairstylist',
    members: [
      'Hairstylist', 'Hair Stylist', 'Hair Colourist', 'Hair Colorist',
      'Hairdresser',
    ],
  },
  // ── People-driving — 'Driver' vs Personal/Private/Designated/Senior Driver
  //    + Chauffeur. Delivery/Courier/Moving-Truck (goods) are OUT. ──
  {
    parent: 'Driver',
    members: [
      'Driver', 'Personal Driver', 'Private Driver', 'Chauffeur',
      'Designated Driver', 'Senior Driver',
    ],
  },
];

const norm = (s) => String(s || '').trim().toLowerCase();

// member(normalized) → its family. Built once at module load.
const _familyByMember = new Map();
for (const fam of FAMILIES) {
  const membersLC = new Set(fam.members.map(norm));
  membersLC.add(norm(fam.parent));
  fam._membersLC = membersLC;
  for (const m of membersLC) {
    if (!_familyByMember.has(m)) _familyByMember.set(m, fam);
  }
}

/** The family a provider type belongs to, or null when it stands alone. */
export function familyOf(type) {
  return _familyByMember.get(norm(type)) || null;
}

/**
 * Collapse a member to its family PARENT so a phrase resolves to ONE stable
 * canonical type. Idempotent on parents and on un-familied types (returns the
 * input unchanged), so it is safe to wrap every resolver return.
 */
export function canonicalType(type) {
  if (!type) return type;
  const f = _familyByMember.get(norm(type));
  return f ? f.parent : type;
}

/**
 * Expand a searched provider type into its whole family (the allow-set). The
 * input is always included first; an un-familied type returns just itself, so
 * this can never NARROW a match — it only widens it among class siblings.
 * Casing of family members is preserved; de-duped case-insensitively.
 */
export function bridgeAllowSet(type) {
  if (!type) return [];
  const f = _familyByMember.get(norm(type));
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const k = norm(v);
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  };
  push(type);
  if (f) { push(f.parent); for (const m of f.members) push(m); }
  return out;
}

/** Lowercased Set form of bridgeAllowSet — convenient for filter predicates. */
export function bridgeAllowSetLC(type) {
  return new Set(bridgeAllowSet(type).map(norm));
}

/**
 * Union the bridge allow-sets of several types (e.g. a base type plus a
 * caller-supplied allowlist). Preserves order + first casing, de-duped.
 */
export function expandAllowlist(types) {
  const out = [];
  const seen = new Set();
  for (const t of (types || [])) {
    for (const v of bridgeAllowSet(t)) {
      const k = norm(v);
      if (v && !seen.has(k)) { seen.add(k); out.push(v); }
    }
  }
  return out;
}

/** True when two provider types sit in the same bridge family. */
export function sameFamily(a, b) {
  const fa = _familyByMember.get(norm(a));
  const fb = _familyByMember.get(norm(b));
  return !!fa && fa === fb;
}
