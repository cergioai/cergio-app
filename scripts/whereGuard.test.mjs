// Unit tests for src/lib/whereGuard.js — the "is this actually an address?" guard.
//
// Two duties, and BOTH must hold at once:
//   1) The 2026-07-05 guarantee: an explicit typed street address ALWAYS wins
//      (this is what stopped the founder-visible "134 Henry St → Miami Beach"
//      address revert). Regressing this re-opens that bug.
//   2) The 2026-07-13 fix (A1c): a BUDGET or a DATE is never an address. The old
//      matcher captured "200 this tuesday" out of "deep cleaning under $200 this
//      tuesday", overwrote the real address, and made the request unroutable.
//
// Run: node scripts/whereGuard.test.mjs
import { extractTypedAddress as ex } from '../src/lib/whereGuard.js';

let pass = 0, fail = 0;
const t = (input, expected, note) => {
  const got = ex(input);
  const ok = expected === null ? got === null : got === expected;
  if (ok) { pass++; console.log(`PASS  ${JSON.stringify(input)} → ${JSON.stringify(got)}`); }
  else { fail++; console.log(`FAIL  ${JSON.stringify(input)} → got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}${note ? '  (' + note + ')' : ''}`); }
};

console.log('— addresses must STILL be captured (the 07-05 anti-revert guarantee) —');
// Note: capture stops at the comma — same as the original matcher (the comma is
// not in its char class). Deliberate parity: "134 Henry St" is what the live app
// geocoded to "134, Henry Street, Two Bridges, Manhattan". Don't "fix" this.
// The CITY is part of the address: a bare street geocodes against Google's own
// bias and can silently land in the wrong city (the A1 "address reverted" bug).
t('134 Henry St, New York', '134 Henry St, New York');
t('5701 collins ave, miami beach tomorrow', '5701 collins ave, miami beach');
t('134 Henry St, this tuesday', '134 Henry St');   // a WHEN is never the city
t('134 Henry St, cleaning', '134 Henry St');       // the job is never the city
t('cleaning at 134 henry st new york', '134 henry st new york');
t('5701 collins ave miami', '5701 collins ave miami');
t('1145 Broadway', '1145 Broadway');
t('plumber at 350 5th Ave apt 12', '350 5th Ave apt 12');
t('need a dog walker, 22 Prince Street', '22 Prince Street');

console.log('\n— budgets must NEVER become addresses (the live A1c bug) —');
t('deep cleaning under $200 this tuesday', null, 'the exact live repro');
t('deep cleaning under 200 this tuesday', null);
t('house cleaning max $150 friday', null);
t('babysitter Tuesday night under $55', null);
t('dog walker after 5pm under $40', null);
t('need a plumber, budget of 300, tomorrow', null);
t('haircut up to 80 bucks', null);

console.log('\n— dates/times must NEVER become addresses —');
t('house cleaning on August 5th', null);
t('cleaner this weekend', null);
t('sitter 3 pm friday', null);
t('massage in 2 weeks', null);

console.log('\n— address + budget/date in one message: address survives, tail trimmed —');
t('deep cleaning at 134 Henry St under $200 this tuesday', '134 Henry St');
t('plumber 5701 collins ave tomorrow', '5701 collins ave');

console.log('\n— nothing to find —');
t('', null);
t('need a cleaner', null);
t(null, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
