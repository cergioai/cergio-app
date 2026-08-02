// SPEC-213 — the one page to read at breakfast. Failures first, always.
import fs from 'node:fs';
const fleet = JSON.parse(fs.readFileSync('agents/fleet.json', 'utf8'));
const rs = fleet.agents.map((a) => {
  try { return JSON.parse(fs.readFileSync(`reports/${a.id}.json`, 'utf8')); }
  catch { return { id: a.id, title: a.title, priority: a.priority, verdict: 'DID NOT RUN', gates: [], defects: a.defects, green_when: a.green_when, at: null }; }
});
// Failures first (feedback_never_retype_report_failures_first): an agent that did not run
// is the most alarming state of all, because its silence reads like success.
const rank = (v) => (v === 'DID NOT RUN' ? 0 : v === 'NEEDS WORK' ? 1 : 2);
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
