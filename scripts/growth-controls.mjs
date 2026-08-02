// SPEC-207 — push the committed crawl controls into the edge-function runtime.
//
// Why a file and not just a secret: the answer to "are we crawling right now, and what?"
// used to live only in Supabase edge secrets. Invisible in git, unreviewable, and
// unreadable from the sandbox — so the honest answer to that question was always "I
// cannot see". Now the state is a committed file, the change is a diff, and CI is the
// only thing that writes it.
import fs from 'node:fs';
const MGMT = 'https://api.supabase.com/v1';
const REF = process.env.PRODUCT_PROJECT_REF || 'vjmwnbftfquyquwaklue';
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK) { console.error('SUPABASE_ACCESS_TOKEN missing — cannot set edge secrets'); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(new URL('../growth-controls.json', import.meta.url), 'utf8'));
// Keys starting with _ are documentation for the reader, never sent anywhere.
const payload = Object.entries(cfg).filter(([k]) => !k.startsWith('_')).map(([name, value]) => ({ name, value: String(value) }));

console.log('pushing crawl controls to the edge runtime:');
for (const { name, value } of payload) console.log(`  ${name.padEnd(20)} = ${value === '' ? '(empty — feature locked)' : value}`);

const r = await fetch(`${MGMT}/projects/${REF}/secrets`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const body = await r.text();
console.log(`edge secrets -> HTTP ${r.status}${r.ok ? '' : ' ' + body.slice(0, 300)}`);
// Fail LOUD. A silent failure here means the controls read one way in git and another in
// production, which is worse than not having the file at all.
if (!r.ok) process.exit(1);
