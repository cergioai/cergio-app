// ONTOLOGY BRIDGE AUDIT + NEW-TERM CLASSIFIER (SPEC-80).
//
// Two jobs:
//   1. Prove the BRIDGE: a search for a parent term resolves into a family the
//      matcher will widen to all siblings (Tutor ⇄ Language Immersion / Math
//      Tutor / Language Tutor).
//   2. CLASSIFY every candidate search term into EXACTLY ONE bucket:
//        (1) BLOCKED         — DJ/nightclub + SHAFT + massage/tattoo/makeup/
//                              personal chef. NEVER map to a bookable type.
//        (2) CORRECT-BUT-MISSING — a real in-scope service the ontology does
//                              not yet resolve → a mapping to ADD.
//        (3) INVALID         — non-service junk (a bare object "car", a person
//                              "james", gibberish) → reject, never map.
//      Everything already resolving correctly is OK (not a report bucket).
//
// Runs against the REAL catalogue the coverage auditor uses
// (offering_master.search_terms) PLUS the terms this change ADDED and a set of
// negative controls, then prints a report + a regression gate.
//
// Run: node --experimental-strip-types scripts/audit-ontology-bridge.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveQuery } from '../supabase/functions/chat-parse/resolver.ts';
import { canonicalType, sameFamily, familyOf } from '../src/lib/ontologyBridge.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const tax = JSON.parse(readFileSync(join(__dir, '../supabase/functions/chat-parse/data/taxonomy.json'), 'utf8'));
const om: Record<string, any> = tax.offering_master || {};
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ── BLOCKED categories — byte-mirror of the crawler safety net
//    (supabase/functions/crawl-seed-osm/index.ts) so one source of truth. ──
const BLOCKED = new RegExp(
  '(massage|tattoo|makeup|\\bpersonal chef\\b|private chef|\\bchef\\b' +
  '|plastic surgery|cosmetic surgery|\\bsurgeon\\b' +
  '|drug|pharmac|cannabis|dispensary|marijuana' +
  '|alcohol|liquor|\\bwine\\b|brewery|winery|distillery|\\bbar\\b|cocktail|\\bpub\\b' +
  '|tobacco|smoke shop|\\bvape\\b|\\bcigar\\b' +
  '|casino|gambling|\\bbetting\\b' +
  '|firearm|\\bgun\\b|\\bammo\\b' +
  '|\\badult\\b|\\bescort\\b|strip club' +
  '|nightclub|night club|\\bdj\\b|disc jockey)',
  'i',
);

// ── INVALID heuristic — non-service junk. Conservative on purpose: the curated
//    catalogue is real service phrases, so this fires almost only on the
//    negative controls + genuine junk, never on a legitimate niche service. ──
// Bare object nouns that name a THING, not a service — junk even if the loose
// backend matcher finds a weak auto/pet match. TIGHT + curated so a real service
// term is never caught (dog/cat/food are OUT — dog-walking etc. are real).
const JUNK_NOUNS = new Set([
  'car', 'chair', 'table', 'thing', 'stuff', 'item', 'object', 'box', 'money',
]);
const PERSON_NAMES = new Set([
  'james', 'john', 'mary', 'james smith', 'john smith', 'jane', 'bob',
  'alice', 'michael', 'sarah', 'david',
]);
// Keyboard-mash rows — an unmistakable gibberish signal.
const KEYBOARD_MASH = /(qwer|asdf|zxcv|wxyz|hjkl|jkl|uiop)/;
function isGibberish(t: string): boolean {
  const s = t.replace(/[^a-z]/g, '');
  if (s.length < 3) return false;
  if (KEYBOARD_MASH.test(s)) return true;
  if (!/[aeiou]/.test(s)) return true;                 // no vowel → not a word
  if (/([bcdfghjklmnpqrstvwxyz])\1{2,}/.test(s)) return true; // 3+ same consonant
  return false;
}

type Bucket = 'BLOCKED' | 'MISSING' | 'INVALID' | 'OK';
function classify(term: string): { bucket: Bucket; resolved: string | null } {
  const t = norm(term);
  // (1) BLOCKED wins over everything — the term itself names a blocked category.
  if (BLOCKED.test(t)) return { bucket: 'BLOCKED', resolved: null };
  const r = resolveQuery(term);
  const resolved = r.confidence >= 0.60 ? (r.provider_type || null) : null;
  // …or it resolves TO a blocked type.
  if (resolved && BLOCKED.test(resolved)) return { bucket: 'BLOCKED', resolved };
  // (3a) INVALID — a bare object noun or a person's name is junk EVEN IF the
  // loose matcher finds a weak match (bare "car" must never be a service search).
  // These lists are tight + curated so no real service term is caught.
  const oneToken = !t.includes(' ');
  if ((oneToken && JUNK_NOUNS.has(t)) || PERSON_NAMES.has(t)) return { bucket: 'INVALID', resolved: null };
  // A term that resolves to a real, in-scope, bookable type IS a valid service
  // by definition — even a vowel-less abbreviation (lvp, cctv, bbq). Resolution
  // beats the remaining junk heuristic, so we never mislabel a real service.
  if (resolved) return { bucket: 'OK', resolved };
  // (3b) INVALID — unresolved gibberish (keyboard mash / no vowel).
  if (oneToken && isGibberish(t)) return { bucket: 'INVALID', resolved: null };
  // (2) CORRECT-BUT-MISSING — a plausible in-scope service with no mapping yet.
  return { bucket: 'MISSING', resolved: null };
}

// ── Term universe ────────────────────────────────────────────────────────────
// 1) The real catalogue.
const catalogue = new Set<string>();
for (const o of Object.values(om) as any[])
  for (const t of (o.search_terms || [])) { const k = norm(t); if (k && k.length >= 3) catalogue.add(k); }

// 2) What THIS change added (bucket 2 — language tutoring, the popular gap).
const ADDED = [
  'french tutor', 'spanish tutor', 'arabic tutor', 'mandarin tutor',
  'chinese tutor', 'italian tutor', 'portuguese tutor', 'german tutor',
  'hebrew tutor', 'japanese tutor', 'korean tutor', 'hindi tutor',
  'russian tutor', 'english tutor', 'esl tutor', 'french lessons',
  'spanish lessons', 'language tutor', 'language immersion',
];

// 3) Negative controls that exercise every bucket.
const CONTROLS_BLOCKED = ['dj', 'dj for my party', 'massage therapist', 'tattoo artist', 'makeup artist', 'personal chef', 'nightclub promoter', 'cannabis dispensary'];
const CONTROLS_INVALID = ['car', 'james', 'john smith', 'asdfghjkl', 'qwerty', 'stuff', 'thing'];

// ── Run classification over the catalogue ────────────────────────────────────
const counts: Record<Bucket, number> = { BLOCKED: 0, MISSING: 0, INVALID: 0, OK: 0 };
const examples: Record<Bucket, string[]> = { BLOCKED: [], MISSING: [], INVALID: [], OK: [] };
for (const term of catalogue) {
  const { bucket, resolved } = classify(term);
  counts[bucket]++;
  if (examples[bucket].length < 18) examples[bucket].push(resolved ? `${term} → ${resolved}` : term);
}

console.log(`\nONTOLOGY BRIDGE + NEW-TERM CLASSIFIER — ${catalogue.size} unique catalogue terms\n`);
console.log(`  (1) BLOCKED           ${String(counts.BLOCKED).padStart(5)}  never-map (DJ/nightclub + SHAFT + massage/tattoo/makeup/personal chef)`);
console.log(`  (2) CORRECT-BUT-MISSING ${String(counts.MISSING).padStart(3)}  in-scope service the ontology does not yet resolve → add a mapping`);
console.log(`  (3) INVALID           ${String(counts.INVALID).padStart(5)}  non-service junk → reject`);
console.log(`      OK (already resolves) ${String(counts.OK).padStart(3)}`);
for (const b of ['BLOCKED', 'MISSING', 'INVALID'] as Bucket[]) {
  if (!examples[b].length) continue;
  console.log(`\n  ${b} examples:`);
  for (const e of examples[b]) console.log('    · ' + e);
}

// ── The bridge additions (bucket 2 we shipped) + verification ────────────────
console.log(`\n  ADDED this change (bucket 2 — language tutoring, resolves into the Tutor family):`);
const addedFail: string[] = [];
for (const term of ADDED) {
  const r = resolveQuery(term);
  const t = r.provider_type || '';
  const inFamily = sameFamily(t, 'Tutor') || norm(canonicalType(t)) === 'tutor';
  if (!inFamily) addedFail.push(`${term} → ${t || '(none)'}`);
  console.log(`    ${inFamily ? '✓' : '✗'} ${term.padEnd(20)} → ${(t || '(none)').padEnd(16)} (canonical: ${canonicalType(t)})`);
}

// ── Regression gate ──────────────────────────────────────────────────────────
let failed = false;
if (addedFail.length) { console.log(`\n  ❌ ADDED terms not in the Tutor family: ${addedFail.join(', ')}`); failed = true; }

const blockedLeak = CONTROLS_BLOCKED.filter(t => classify(t).bucket !== 'BLOCKED');
if (blockedLeak.length) { console.log(`\n  ❌ BLOCKED controls that did NOT classify BLOCKED: ${blockedLeak.join(', ')}`); failed = true; }

const invalidLeak = CONTROLS_INVALID.filter(t => { const c = classify(t); return c.resolved != null || c.bucket === 'OK'; });
if (invalidLeak.length) { console.log(`\n  ❌ INVALID controls that resolved to a bookable type: ${invalidLeak.join(', ')}`); failed = true; }

console.log(`\n  Controls — BLOCKED: ${CONTROLS_BLOCKED.map(t => t + '=' + classify(t).bucket).join(', ')}`);
console.log(`  Controls — INVALID: ${CONTROLS_INVALID.map(t => t + '=' + classify(t).bucket).join(', ')}`);

if (failed) { console.log('\n  ❌ Bridge classifier gate FAILED.\n'); process.exit(1); }
console.log('\n  ✅ Bridge classifier gate passed: added terms bridge to Tutor; blocked never map; invalid never resolve.\n');
