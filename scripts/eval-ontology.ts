// Ontology coverage + precision gate. THE STANDARD: run after every supplement
// batch. Two hard rules:
//   1. ZERO confident-wrong — any case that resolves ≥0.60 to the WRONG type
//      fails the build (a confident wrong answer is the cardinal sin).
//   2. Coverage — % of labeled phrases that resolve LOCALLY (≥0.60) to the
//      right type. Misses (<0.60) are OK: they route to Claude. We track the %.
// Run:  node --experimental-strip-types scripts/eval-ontology.ts
import { resolveQuery } from '../supabase/functions/chat-parse/resolver.ts';

// [phrase, expectedProviderType]. expectedType '' = should NOT match locally
// (genuinely out of scope → must go to Claude / return nothing).
const CASES: [string, string][] = [
  // grooming / beauty
  ['beard trim','Barber'],['hot towel shave','Barber'],['fade haircut','Barber'],['line up','Barber'],
  ['kids haircut','Barber'],['mens haircut','Barber'],['haircut','Hair Stylist'],['balayage','Hair Stylist'],
  ['blowout','Hair Stylist'],['gel manicure','Nail Technician'],['pedicure','Nail Technician'],
  ['facial','Esthetician'],['lash lift','Esthetician'],['eyebrow threading','Esthetician'],['spray tan','Spray Tan Artist'],
  ['makeup artist','Makeup Artist'],
  // home / trades
  ['change a lightbulb','Handyman'],['mount my tv','Handyman'],['hang pictures','Handyman'],['furniture assembly','Handyman'],
  ['replace outlet','Electrician'],['install ceiling fan','Electrician'],['install light fixture','Electrician'],
  ['clogged drain','Plumber'],['toilet replacement','Plumber'],['leaky faucet','Plumber'],['water heater','Plumber'],
  ['interior painting','Painter'],['patch drywall','Drywall Contractor'],['pressure washing','Exterior Maintenance'],
  // appliance / hvac
  ['ac not cooling','HVAC Technician'],['furnace repair','HVAC Technician'],['dryer not heating','Appliance Repair Technician'],
  ['dishwasher repair','Appliance Repair Technician'],['fridge not cooling','Appliance Repair Technician'],
  // auto
  ['oil change','Lube Technician'],['mobile car wash','Car Wash Technician'],['car detailing','Auto Detailer'],
  // pets
  ['dog grooming','Dog Groomer'],['dog walking','Dog Walker'],['cat sitting','Pet Sitter'],['dog training','Dog Trainer'],
  // outdoor
  ['lawn mowing','Landscaper'],['tree trimming','Landscaper'],['leaf removal','Landscaper'],['pool cleaning','Pool Technician'],
  // events / creative
  ['wedding dj','DJ'],['event photographer','Event Photographer'],['photographer','Photographer'],['balloon artist','Balloon Artist'],
  // wellness / home services
  ['personal trainer','Personal Trainer'],['prenatal massage','Prenatal Massage Therapist'],['massage','Massage Therapist'],
  ['house cleaning','Housekeeper'],['move out cleaning','Housekeeper'],['junk removal','Junk Removal Specialist'],
  ['babysitter','Babysitter'],['math tutoring','Math Tutor'],['personal chef','Personal Chef'],['caterer','Caterer'],
  // misspellings (curated/edit-distance — may resolve or go to Claude; never WRONG)
  ['plummer','Plumber'],['electrican','Electrician'],
  // multilingual (ES/PT in the ontology)
  ['plomero','Plumber'],['niñera','Nanny'],['jardinero','Landscaper'],['limpieza de casa','Housekeeper'],
  ['fontanero','Plumber'],['chef a domicilio','Personal Chef'],
  // batch 2 domains
  ['locked out','Locksmith'],['rekey locks','Locksmith'],['car key replacement','Locksmith'],
  ['bed bugs','Pest Control Technician'],['termite treatment','Pest Control Technician'],['exterminator','Pest Control Technician'],
  ['window cleaning','Window Cleaner'],['carpet cleaning','Carpet Cleaner'],['rug cleaning','Carpet Cleaner'],
  ['brake replacement','Mobile Mechanic'],['check engine light','Mobile Mechanic'],
  ['hem pants','Tailor'],['dress alterations','Seamstress'],['bartender','Bartender'],
  ['wedding planner','Wedding Planner'],['event planner','Event Planner'],['interior designer','Interior Designer'],
  ['tax preparation','Tax Preparer'],['bookkeeping','Bookkeeper'],['build a website','Web Developer'],['logo design','Graphic Designer'],
];

let correct = 0, miss = 0, wrong = 0;
const wrongs: string[] = [], misses: string[] = [];
for (const [q, want] of CASES) {
  const r = resolveQuery(q);
  const local = r.confidence >= 0.60;
  const got = r.provider_type || '';
  if (local && want && got === want) correct++;
  else if (local && want && got !== want) { wrong++; wrongs.push(`"${q}" -> ${got} (want ${want}) @${r.confidence.toFixed(2)}`); }
  else { miss++; misses.push(`"${q}" -> ${got || '—'} @${r.confidence.toFixed(2)} (→Claude)`); }
}
const n = CASES.length;
console.log(`\nONTOLOGY EVAL — ${n} cases`);
console.log(`  correct (local):   ${correct}  (${Math.round(100*correct/n)}%)`);
console.log(`  →Claude (miss):    ${miss}`);
console.log(`  CONFIDENT-WRONG:   ${wrong}`);
if (misses.length) { console.log('\n  misses (acceptable, route to Claude):'); misses.forEach(m => console.log('    · ' + m)); }
if (wrong > 0) {
  console.log('\n  ❌ CONFIDENT-WRONG (build fails):');
  wrongs.forEach(w => console.log('    ✗ ' + w));
  process.exit(1);
}
console.log('\n  ✅ ZERO confident-wrong.');
