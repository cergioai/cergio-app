// SPEC-252 (founder, 2026-08-03, verbatim: "close and verify back to back no hourly
// wait.."). GitHub cron cannot fire faster than hourly, so the fleet RELAUNCHES ITSELF:
// when a run finishes and open FW work remains, the morning job dispatches the next run
// immediately (workflow_dispatch is GitHub's sanctioned exception to the no-cascade rule).
//
// TWO STOPS, so this can never become a runaway:
//   1. ALL GREEN — zero open FW defects on active agents → no relaunch, loop ends.
//   2. DEAD KEY — every agent CANNOT RUN (API key/billing) → relaunching burns runs to
//      learn nothing; stop and let the cron + merges resume it when the key is back.
// The night-fleet concurrency group (queue, no cancel) bounds parallelism to 1+1.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const fleet = JSON.parse(fs.readFileSync('agents/fleet.json', 'utf8'));
const CLOSED = /RESOLVED|FIXED|CLOSED|NOT-A-DEFECT/i;
const open = [];
for (const a of fleet.agents) {
  if (a.suspended) continue;
  for (const d of a.defects || []) if (/^FW-/.test(d) && !CLOSED.test(d)) open.push(`${a.id}:${d.slice(0, 40)}`);
}
let anyRan = false;
try {
  for (const f of fs.readdirSync('reports')) {
    if (!f.endsWith('.work.json')) continue;
    const w = JSON.parse(fs.readFileSync(`reports/${f}`, 'utf8'));
    if (w.state && w.state !== 'CANNOT RUN') { anyRan = true; break; }
  }
} catch { /* no reports dir = nothing ran */ }

if (!open.length) { console.log('ALL GREEN on FW items — loop ends here.'); process.exit(0); }
if (!anyRan) { console.log(`${open.length} FW open but every agent CANNOT RUN — not relaunching a dead fleet (check the API key/billing).`); process.exit(0); }
console.log(`${open.length} FW item(s) still open — relaunching the fleet back-to-back.`);
try { execSync('gh workflow run night-fleet.yml --ref main', { stdio: 'inherit' }); }
catch (e) { console.log('relaunch dispatch failed (non-fatal): ' + String(e.message).slice(0, 200)); }
