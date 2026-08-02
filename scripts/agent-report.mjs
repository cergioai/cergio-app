// SPEC-213 — one agent, one report, with evidence. Runs in CI, so it runs with the Mac off.
//
// This deliberately VERIFIES and does not edit. Every serious outage on this project came
// from an unattended change that passed static checks: a blank homepage, a white /auth,
// every crawled row silently discarded. A wrong report costs a minute of reading. A wrong
// unattended edit costs a morning.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const id = process.argv[2];
const fleet = JSON.parse(fs.readFileSync('agents/fleet.json', 'utf8'));
const a = fleet.agents.find((x) => x.id === id);
if (!a) { console.error(`no agent "${id}" in the fleet`); process.exit(1); }

const now = new Date().toISOString();
const L = [];
const say = (s = '') => L.push(s);

// 1. THE WALL — prove this agent only sees its own files.
let wall = 'not built';
try {
  // Build the cell from THIS agent's owned paths — that is what proves the wall is real
  // rather than declared. agent-cell.mjs refuses to hand over a cell that is not isolating.
  const owns = a.owns.map((f) => JSON.stringify(f)).join(' ');
  const out = execSync(`node scripts/agent-cell.mjs create ${id} ${owns} 2>&1 || true`, { encoding: 'utf8' });
  const m = out.match(/hid (\d+) of (\d+)/i) || out.match(/(\d+)\s*\/\s*(\d+)\s*hidden/i);
  wall = m ? `${m[1]} of ${m[2]} repo files hidden` : out.trim().split('\n').slice(-1)[0];
} catch (e) { wall = `cell build failed: ${String(e).slice(0, 120)}`; }

// 2. THE GATES — run the real suite, then report THIS agent's gates by id.
let suite = { pass: 0, fail: 0, raw: '' };
try {
  const out = execSync('npm run qa 2>&1 || true', { encoding: 'utf8', maxBuffer: 40e6 });
  suite.raw = out.replace(/\x1b\[[0-9;]*m/g, '');
  suite.pass = (suite.raw.match(/^\s*PASS\s/gm) || []).length;
  suite.fail = (suite.raw.match(/^\s*FAIL\s/gm) || []).length;
} catch (e) { suite.raw = String(e).slice(0, 400); }

const mine = a.gates.map((g) => {
  const re = new RegExp(`^\\s*(PASS|FAIL)\\s+\\${g}\\s`, 'm');
  const m = suite.raw.match(re);
  return { id: g, state: m ? m[1] : 'NOT FOUND' };
});
const missing = mine.filter((g) => g.state === 'NOT FOUND');
const failed = mine.filter((g) => g.state === 'FAIL');

// 3. BUILD
let build = 'not run';
try { execSync('npm run build >/dev/null 2>&1'); build = 'clean'; }
catch { build = 'FAILED'; }

// A gate that cannot be FOUND is worse than one that fails: it means the thing this agent
// claims to guard has no guard at all, and the green suite is describing something else.
const verdict = (failed.length || missing.length || build === 'FAILED' || a.defects.length) ? 'NEEDS WORK' : 'GREEN';

say(`# ${a.title}`);
say();
say(`**agent** \`${a.id}\` · **priority** ${a.priority} · **${verdict}** · ${now}`);
say();
say(`> **Green when:** ${a.green_when}`);
say();
say('## Its gates');
say();
say('| gate | state |');
say('|---|---|');
for (const g of mine) say(`| ${g.id} | ${g.state === 'PASS' ? 'pass' : `**${g.state}**`} |`);
say();
say(`Whole suite: ${suite.pass} pass · ${suite.fail} fail. Build: ${build}. Wall: ${wall}.`);
say();

if (missing.length) {
  say('## Gates that DO NOT EXIST');
  say();
  say('These are listed as this area\'s guards but the suite has no such gate. That is worse');
  say('than a failing gate: the behaviour has no guard at all, and a green suite is');
  say('describing something else.');
  say();
  for (const g of missing) say(`- \`${g.id}\` — not found in the suite`);
  say();
}

say('## Open defects it is accountable for');
say();
if (!a.defects.length) say('None recorded.');
for (const d of a.defects) say(`- ${d}`);
say();
say('## What this report does NOT prove');
say();
say('The suite is a STATIC gate — it reads source, it makes no network calls. It cannot');
say('see production. So a green report here means "the code says the right thing and the');
say('guards are in place", never "this works live". Anything requiring live proof is named');
say('above as an open defect and stays open until an artifact exists.');

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync(`reports/${a.id}.md`, L.join('\n') + '\n');
fs.writeFileSync(`reports/${a.id}.json`, JSON.stringify({
  id: a.id, title: a.title, priority: a.priority, verdict, at: now, build, wall,
  gates: mine, suite: { pass: suite.pass, fail: suite.fail }, defects: a.defects, green_when: a.green_when,
}, null, 1));
console.log(`${a.id}: ${verdict} (${mine.filter(g=>g.state==='PASS').length}/${mine.length} own gates pass, ${a.defects.length} open defect(s))`);
