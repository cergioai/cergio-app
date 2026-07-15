// ─────────────────────────────────────────────────────────────────────────────
// Cergio — wire the E2E journeys into the FINDINGS LEDGER.
//
// A red CI check is a notification; a FINDING is a thing the system chases. The
// live suites (qa-live.mjs, the qa-suite edge fn) already open/resolve findings
// via cergio_qa_check, and cergio-watchdog escalates any finding that stays open
// past the window (#75). Without this, a broken user journey would be the one
// class of defect the machine could not see — a red X on a commit page and
// nothing else.
//
// Contract (identical to qa-live.mjs): cergio_qa_check(p_area, p_check, p_sev,
// p_count, p_detail) OPENS the finding when p_count > 0 and RESOLVES it when 0.
// So a passing run actively CLOSES a previously-open journey finding — the loop
// re-arms itself.
//
// Runs on push-to-main only (the ledger records what is true of SHIPPED code).
// No secrets → no-op with a clear message, never a crash and never a false green.
//
// Node built-ins only. Reversible: delete this file + the ci.yml job.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUPA_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// The e2e job's conclusion, handed down by the workflow ('success' | 'failure' | …).
const JOB_RESULT = String(process.env.E2E_RESULT || '').toLowerCase();

const CHECK_NAME = 'qa_e2e_journeys';

/** Per-spec detail, when Playwright's JSON reporter left us its output. */
function readSpecOutcomes() {
  const p = path.join(REPO_ROOT, 'e2e-results.json');
  if (!fs.existsSync(p)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(p, 'utf8'));
    const failed = [];
    const walk = (suites = []) => {
      for (const s of suites) {
        for (const spec of s.specs || []) if (spec.ok === false) failed.push(spec.title);
        walk(s.suites);
      }
    };
    walk(report.suites);
    return { failed, total: Number(report.stats?.expected || 0) + Number(report.stats?.unexpected || 0) };
  } catch {
    return null;
  }
}

async function rpc(fn, params) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  if (!JOB_RESULT) {
    console.error('e2e-ledger: no E2E_RESULT in the environment — refusing to record an outcome I do not know.');
    process.exit(0);
  }
  if (!SUPA_URL || !SERVICE_KEY) {
    console.error('e2e-ledger: no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — journeys ran, ledger not written.');
    process.exit(0);
  }

  const green = JOB_RESULT === 'success';
  const outcomes = readSpecOutcomes();
  const detail = green
    ? `[e2e] all behavioural journeys green${outcomes ? ` (${outcomes.total} specs)` : ''} — search→results (address holds, no false paid banner), instant-vs-scheduled, request→accept→confirmed`
    : `[e2e] BROKEN USER JOURNEY — ${outcomes?.failed?.length
        ? outcomes.failed.slice(0, 5).join(' | ')
        : 'the e2e job failed (see the CI run + uploaded trace)'}`;

  // count > 0 opens the finding; count = 0 resolves it.
  await rpc('cergio_qa_check', {
    p_area: 'qa',
    p_check: CHECK_NAME,
    p_sev: 'critical', // a broken journey is what the user actually hits
    p_count: green ? 0 : Math.max(1, outcomes?.failed?.length || 1),
    p_detail: detail.slice(0, 500),
  });

  console.error(`e2e-ledger: ${green ? 'RESOLVED' : 'OPENED'} finding ${CHECK_NAME} — ${detail}`);
}

main().catch((e) => {
  // Never fail the build on a LEDGER problem — the e2e job itself is the gate.
  console.error('e2e-ledger: could not write the ledger:', e?.message || e);
  process.exit(0);
});
