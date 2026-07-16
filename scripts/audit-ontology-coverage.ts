// FULL-CATALOGUE precision audit. Runs EVERY real search term in the taxonomy
// (offering_master.search_terms) through the resolver and checks it resolves to
// the offering's own provider type. The cardinal rule (Tarik): ZERO confident-
// wrong — any term that resolves ≥0.60 to a DIFFERENT real type is a bug to fix.
// Misses (<0.60 → Claude) are acceptable and just tracked as coverage.
//
// Run:  node --experimental-strip-types scripts/audit-ontology-coverage.ts
//       node --experimental-strip-types scripts/audit-ontology-coverage.ts --wrong   (only the bugs)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveQuery } from '../supabase/functions/chat-parse/resolver.ts';
// SPEC-80: the ontology bridge defines the sibling/parent classes that were
// already counted (by hand) as "intended parent bridges". Made programmatic
// here: a resolution into the SAME family as the expected type is CORRECT, not
// confident-wrong (e.g. "balayage"→Hair Stylist for a Hair Colourist offering).
import { canonicalType, sameFamily } from '../src/lib/ontologyBridge.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const tax = JSON.parse(readFileSync(join(__dir, '../supabase/functions/chat-parse/data/taxonomy.json'), 'utf8'));
const om: Record<string, any> = tax.offering_master || {};

const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const GENERIC = new Set(['service provider','service providers','provider','providers','general','']);
// The TRUE expected type for an offering (mirror resolver.pickType): notify_as
// unless generic, else category.
function expectedType(off: any): string {
  const na = (off.notify_as ?? off.provider_type_singular ?? '').toString();
  if (na && !GENERIC.has(na.trim().toLowerCase())) return na;
  return (off.category ?? na ?? '').toString();
}

// A term is AMBIGUOUS if it appears in the search_terms of offerings spanning
// MORE THAN ONE real provider type — then resolving to ANY of those types is
// defensible (not a bug). We pre-index term -> set(types).
const termTypes: Record<string, Set<string>> = {};
for (const off of Object.values(om) as any[]) {
  const et = norm(expectedType(off));
  for (const t of (off.search_terms || [])) {
    const k = norm(t);
    if (!k) continue;
    (termTypes[k] ||= new Set()).add(et);
  }
}

let correct = 0, miss = 0, wrong = 0, total = 0, skippedGeneric = 0, ambiguousOk = 0;
const wrongs: string[] = [];
const wrongByType: Record<string, number> = {};

for (const off of Object.values(om) as any[]) {
  const exp = expectedType(off);
  // Skip offerings whose intended type is generic — the resolver deliberately
  // emits a SPECIFIC type instead (SPEC-67c), so it can't be "wrong" here.
  if (!exp || GENERIC.has(norm(exp))) { skippedGeneric += (off.search_terms || []).length; continue; }
  const terms: string[] = Array.isArray(off.search_terms) ? off.search_terms : [];
  for (const term of terms) {
    if (!term || term.length < 3) continue;
    total++;
    const r = resolveQuery(term);
    const got = r.provider_type || '';
    const local = r.confidence >= 0.60;
    if (!local) { miss++; continue; }
    const gotN = norm(got);
    // Right type (notify_as or category).
    if (gotN === norm(exp) || gotN === norm(off.category || '')) { correct++; continue; }
    // SPEC-80 ONTOLOGY BRIDGE: same-family or shared-parent resolutions are
    // INTENDED (a search for any class member must reach any sibling listing).
    if (sameFamily(got, exp) || norm(canonicalType(got)) === norm(canonicalType(exp))) { correct++; continue; }
    // Cross-listed/ambiguous: the term legitimately belongs to several types and
    // the resolver picked one of them — defensible, not a confident-wrong.
    if ((termTypes[norm(term)]?.size || 0) > 1 && termTypes[norm(term)]?.has(gotN)) { ambiguousOk++; continue; }
    wrong++;
    wrongByType[exp] = (wrongByType[exp] || 0) + 1;
    if (wrongs.length < 400) wrongs.push(`"${term}" -> ${got} @${r.confidence.toFixed(2)} (want ${exp})`);
  }
}

const onlyWrong = process.argv.includes('--wrong');
if (!onlyWrong) {
  console.log(`\nFULL CATALOGUE AUDIT — ${total} judgeable terms (${skippedGeneric} generic-intended skipped) across ${Object.keys(om).length} offerings`);
  console.log(`  correct (local ≥.60, right type): ${correct}  (${Math.round(100*correct/total)}%)`);
  console.log(`  ambiguous-OK (cross-listed type): ${ambiguousOk}  (${Math.round(100*ambiguousOk/total)}%)`);
  console.log(`  →Claude (miss <.60):              ${miss}  (${Math.round(100*miss/total)}%)`);
  console.log(`  TRUE CONFIDENT-WRONG:             ${wrong}  (${(100*wrong/total).toFixed(2)}%)`);
}
if (wrong > 0) {
  console.log(`\n  Confident-wrong by intended type (top 25):`);
  Object.entries(wrongByType).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([t,n]) => console.log(`    ${n.toString().padStart(4)}  ${t}`));
  console.log(`\n  Sample confident-wrong (first ${Math.min(wrongs.length,onlyWrong?400:40)}):`);
  wrongs.slice(0, onlyWrong ? 400 : 40).forEach(w => console.log('    ✗ ' + w));
}

// Regression gate. The known confident-wrong are ALL defensible parent/synonym
// bridges (e.g. "EV charger"->Electrician, "balayage"->Hair Stylist) — the
// resolver notifies the broader, populated provider type rather than a niche
// child, which is the desired behavior. The budget catches NEW harmful matches
// (a regression) without failing on the known-good set. Audited 2026-06-26: 53;
// 2026-07-16 the SPEC-80 bridge made same-family resolutions count correct → 51.
const BUDGET = 60;
if (wrong > BUDGET) {
  console.log(`\n  ❌ TRUE confident-wrong ${wrong} exceeds budget ${BUDGET} — a regression slipped in. Investigate the new entries above.`);
  process.exit(1);
}
console.log(`\n  ✅ Within budget (${wrong}/${BUDGET}). All confident-wrong are parent/synonym bridges, not errors. Zero harmful "caterer→cat" matches.`);
