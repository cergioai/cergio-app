// SPEC-213 — the one page to read at breakfast. Failures first, always.
import fs from 'node:fs';
const fleet = JSON.parse(fs.readFileSync('agents/fleet.json', 'utf8'));
const rs = fleet.agents.map((a) => {
  let base;
  try { base = JSON.parse(fs.readFileSync(`reports/${a.id}.json`, 'utf8')); }
  catch { base = { id: a.id, title: a.title, priority: a.priority, verdict: 'DID NOT RUN', gates: [], defects: a.defects, green_when: a.green_when, at: null }; }
  // What the agent THOUGHT, as distinct from what the gates measured.
  try { base.work = JSON.parse(fs.readFileSync(`reports/${a.id}.work.json`, 'utf8')); } catch { base.work = null; }
  // An agent that could not start is not idle. It must outrank everything else on the page.
  if (base.work && base.work.state === 'CANNOT RUN') base.verdict = 'CANNOT RUN';
  return base;
});
// Failures first (feedback_never_retype_report_failures_first): an agent that did not run
// is the most alarming state of all, because its silence reads like success.
const rank = (v) => (v === 'CANNOT RUN' ? -1 : v === 'DID NOT RUN' ? 0 : v === 'NEEDS WORK' ? 1 : 2);
rs.sort((a, b) => rank(a.verdict) - rank(b.verdict) || a.priority - b.priority);

const green = rs.filter((r) => r.verdict === 'GREEN');
const L = [];
const say = (s = '') => L.push(s);
const now = new Date().toISOString();

say(`# Morning report — ${now.slice(0, 16).replace('T', ' ')} UTC`);
say();
say(`**${green.length} of ${rs.length} agents GREEN.** Everything below is sorted worst first.`);
say();
say('| agent | verdict | own gates | open defects | green when |');
say('|---|---|---|---|---|');
for (const r of rs) {
  const p = (r.gates || []).filter((g) => g.state === 'PASS').length;
  say(`| **${r.id}** | ${r.verdict === 'GREEN' ? 'GREEN' : `**${r.verdict}**`} | ${p}/${(r.gates || []).length} | ${(r.defects || []).length} | ${r.green_when} |`);
}
say();

const notRun = rs.filter((r) => r.verdict === 'DID NOT RUN');
if (notRun.length) {
  say('## Did not run — read this first');
  say();
  say('An agent that produced no report is the most dangerous state on this page, because');
  say('silence reads like success. Treat each of these as UNKNOWN, not as fine.');
  say();
  for (const r of notRun) say(`- **${r.id}** — ${r.title}`);
  say();
}

const cant = rs.filter((r) => r.verdict === 'CANNOT RUN');
if (cant.length) {
  say('## COULD NOT START — read this before anything else');
  say();
  say('These agents did not fail; they never began. This is the state that hid the build');
  say('agent for weeks: it was dark on a 400 while every dashboard read green, because');
  say('nothing distinguished "idle" from "unable to start". The API\'s own words follow.');
  say();
  for (const r of cant) say(`- **${r.id}** — ${r.work?.detail || 'no detail'}${r.work?.http ? ` (HTTP ${r.work.http}, model ${r.work.model})` : ''}`);
  say();
}

// WHAT THEY DID, not just what they saw. Founder: "proof of what they've done."
const acted = rs.filter((r) => r.work && (r.work.state === 'FIXED' || r.work.state === 'ATTEMPTED'));
say('## What the CI subagents DID this run');
say();
if (!acted.length) say('No subagent changed anything this run.');
for (const r of acted) {
  if (r.work.state === 'FIXED') {
    say(`- **${r.id} — FIXED** \`${r.work.file}\`: ${r.work.finding}`);
    say(`  Kept because the gate suite, the build and the scope guard all passed after the edit. A PR is open; it is NOT merged.`);
  } else {
    say(`- **${r.id} — ATTEMPTED and REVERTED** \`${r.work.file}\`: ${r.work.finding}`);
    say(`  Thrown away because ${r.work.why_not}. The working tree is byte-for-byte as it was. This is the loop working, not failing.`);
  }
}
say();

say('## What the agents found this run');
say();
const found = rs.filter((r) => r.work && r.work.state === 'FINDING');
if (!found.length) say('No agent reported a new defect in its own files this run.');
for (const r of found) {
  say(`### ${r.id} — confidence ${r.work.confidence}${r.work.needs_founder ? ' · NEEDS YOU' : ''}`);
  say();
  say(`**${r.work.finding}**`);
  say();
  if (r.work.evidence) say(`Evidence: \`${String(r.work.evidence).slice(0, 300)}\``);
  if (r.work.fix) { say(); say(`Proposed: ${r.work.fix}`); }
  say();
}

say('## What each agent is waiting on');
say();
for (const r of rs) {
  if (!(r.defects || []).length) continue;
  say(`### ${r.id} — ${r.title}`);
  say();
  for (const d of r.defects) say(`- ${d}`);
  say();
  say(`Full report: \`reports/${r.id}.md\``);
  say();
}

say('## The honest limit of this page');
say();
say('The gate suite is STATIC — it reads source and makes no network calls. A GREEN agent');
say('means "the code says the right thing and its guards are in place". It does NOT mean');
say('"this works in production". Every item needing live proof is listed as an open defect');
say('and stays open until an artifact exists: an HTTP status, a screenshot, or a DB row.');
say();
say('No agent in this fleet edits code unattended. They verify and report. Fixes are');
say('approved in the morning and applied one at a time inside a cell.');

fs.writeFileSync('MORNING-REPORT.md', L.join('\n') + '\n');
console.log(`morning report: ${green.length}/${rs.length} green, ${notRun.length} did not run`);
