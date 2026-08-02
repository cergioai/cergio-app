// SPEC-220 — push this run's report into the product DB so the dashboard has live numbers
// without anyone opening GitHub.
import fs from 'node:fs';
const URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const id = process.argv[2];
if (!URL || !KEY) { console.log(`${id}: publish SKIPPED (no product URL/key on this runner)`); process.exit(0); }

let r = null, w = null;
try { r = JSON.parse(fs.readFileSync(`reports/${id}.json`, 'utf8')); } catch {}
if (!r) { console.log(`${id}: nothing to publish`); process.exit(0); }
try { w = JSON.parse(fs.readFileSync(`reports/${id}.work.json`, 'utf8')); } catch {}

const row = {
  agent: r.id, title: r.title, priority: r.priority,
  verdict: w?.state === 'CANNOT RUN' ? 'CANNOT RUN' : r.verdict,
  gates_pass: (r.gates || []).filter((g) => g.state === 'PASS').length,
  gates_total: (r.gates || []).length,
  defects: (r.defects || []).length,
  build: r.build, wall: r.wall, green_when: r.green_when,
  work_state: w?.state || null, finding: w?.finding || null,
  evidence: w?.evidence ? String(w.evidence).slice(0, 2000) : null,
  fix: w?.fix || null, file_changed: w?.file || null,
  why_not: w?.why_not || (w?.detail ? String(w.detail).slice(0, 500) : null),
};
const res = await fetch(`${URL}/rest/v1/ci_subagent_runs`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify([row]),
});
// Fail loud in the log, never fail the job — a publish problem must not hide the report.
console.log(`${id}: publish -> HTTP ${res.status}${res.ok ? '' : ' ' + (await res.text()).slice(0, 200)}`);
