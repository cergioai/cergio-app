// Deterministic unit test for isScheduledWhen. Run: node scripts/whenHorizon.test.mjs
import { isScheduledWhen } from '../src/lib/whenHorizon.js';

// Fixed reference clock: Wednesday, 2026-07-08, 14:00 local.
const NOW = new Date(2026, 6, 8, 14, 0, 0, 0);

let pass = 0, fail = 0;
function check(when, expected) {
  const got = isScheduledWhen(when, NOW);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  scheduled=${got}\texpect=${expected}\t"${when}"`);
}

// --- INSTANT (near-term) ---
check('now', false);
check('right now', false);
check('asap', false);
check('today', false);
check('tonight', false);
check('this evening', false);
check('tomorrow', false);
check('tomorrow at 3pm', false);
check('thursday', false);        // Wed→Thu ≈ 22h out → instant (boundary handled)
check('this friday', true);      // Wed 14:00 → Fri noon ≈ 46h > 32h → scheduled
check('', false);

// --- SCHEDULED (far-future, previously MISSED) ---
check('next week', true);
check('next month', true);
check('in two weeks', true);
check('in 3 days', true);
check('a couple weeks', true);
check('august 5th', true);       // ~28 days out
check('aug 5', true);
check('on august 12', true);
check('5th of august', true);
check('on the 20th', true);      // still July → ~12 days out
check('next friday', true);      // >1 week out
check('this weekend', true);     // Wed→Sat ≈ 74h → scheduled
check('the weekend', true);

// A weekday just over the 32h line vs under it:
check('friday', true);           // Wed 14:00 → Fri noon ≈ 46h → scheduled
check('january 5th', true);      // next year

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
