// SPEC-218 — a kept fix becomes a PULL REQUEST. Never a push to main, never auto-merge.
//
// Every past outage on this project reached production through an automatic merge. A PR
// waiting for Tarik cannot. The branch carries the agent id, so a bad change is one revert
// attributable to exactly one owner.
//
// This lives in a script, not inline in YAML: the first version was inline and broke the
// workflow file outright. A shell heredoc inside YAML inside a matrix is three quoting
// regimes deep, and a workflow that will not parse runs nothing at all — the loudest
// possible version of an agent going dark.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const id = process.argv[2];
const sh = (c) => execSync(c, { stdio: 'pipe', encoding: 'utf8' });

let w = null;
try { w = JSON.parse(fs.readFileSync(`reports/${id}.work.json`, 'utf8')); } catch {}
if (!w || w.state !== 'FIXED') { console.log(`${id}: no kept fix this run — nothing to open`); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const br = `agent/${id}/${stamp}`;
const title = String(w.finding || 'fix').slice(0, 70);

const body = [
  `Opened by the \`${id}\` CI subagent, unattended.`, '',
  `**Finding.** ${w.finding}`, '',
  w.evidence ? `**Evidence.** \`${String(w.evidence).slice(0, 400)}\`` : '', '',
  `**Why it was kept.** All three hard checks passed AFTER the edit: the full qa gate`,
  `suite, the production build, and the scope guard proving the change never left this`,
  `agent's wall. A fix that cannot prove itself is reverted and reported as an attempt.`, '',
  `**Not auto-merged, deliberately.** Every past outage here reached production through an`,
  `automatic merge. Read it before you take it.`,
].filter((x) => x !== undefined).join('\n');

try {
  sh(`git config user.email "t@cergio.ai"`);
  sh(`git config user.name "Cergio CI subagent (${id})"`);
  sh(`git checkout -b ${JSON.stringify(br)}`);
  // Reports and the morning page belong to the fleet branch, not to a code PR.
  sh(`git add -A ":!reports" ":!MORNING-REPORT.md"`);
  sh(`git commit -q -m ${JSON.stringify(`fix(${id}): ${title}`)} -m ${JSON.stringify(body)}`);
  sh(`git push -q origin ${JSON.stringify(br)}`);
  sh(`gh pr create --base main --head ${JSON.stringify(br)} --title ${JSON.stringify(`[${id}] ${title}`)} --body ${JSON.stringify(body)}`);
  console.log(`${id}: opened PR on ${br}`);
} catch (e) {
  // Never fail the job for this. A PR that could not be opened must be REPORTED, not
  // hidden behind a red job nobody reads.
  console.log(`${id}: could not open PR — ${String(e.stdout || e.message).slice(0, 300)}`);
}
