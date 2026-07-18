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
import { execSync } from 'node:child_process';

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

  // Firewalled audit agents can't read Supabase; commit a live KPI snapshot to git.
  await snapshotOps();
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE KPI SNAPSHOT → committed to git so the (Supabase-firewalled) audit agents
// read live truth WITHOUT a DB read and WITHOUT a founder click. Runs in the
// e2e-ledger CI job (push-to-main, on GitHub's network, service-role creds).
// FULLY GUARDED: any failure logs and returns — it never affects the ledger
// outcome, never fails the build, never triggers another workflow ([skip ci]).
// Reversible: delete this function + its one call site.
// ─────────────────────────────────────────────────────────────────────────────
async function snapshotOps() {
  try {
    if (!SUPA_URL || !SERVICE_KEY) return;

    // 1) Authoritative dashboard snapshot (same source ops-metrics serves).
    let dashboard = null, dashboard_error = null;
    try {
      const r = await fetch(`${SUPA_URL}/functions/v1/ops-metrics?nc=${Date.now()}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (r.ok) dashboard = await r.json();
      else dashboard_error = `${r.status} ${(await r.text()).slice(0, 120)}`;
    } catch (e) { dashboard_error = String(e?.message || e); }

    // 2) RAW ground-truth counts straight off REST — these BYPASS the snapshot
    //    RPC, so an audit run can detect when the dashboard lies (e.g. a green
    //    garbage_in_queued while dupes exist, or a headline booking count that is
    //    all seed rows). Each probe is independent and non-fatal.
    const raw_counts = {};
    async function count(table, qs, label) {
      try {
        const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${qs}`, {
          method: 'HEAD',
          headers: {
            apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
            Prefer: 'count=exact', Range: '0-0',
          },
        });
        const cr = r.headers.get('content-range') || '';
        raw_counts[label] = cr.includes('/') ? Number(cr.split('/')[1]) : null;
      } catch { raw_counts[label] = null; }
    }
    await count('services', 'select=id', 'services_total');
    await count('services', 'select=id&lat=not.is.null', 'services_geocoded_visible');
    await count('services', 'select=id&lat=is.null', 'services_null_latlng_invisible');
    await count('leads_services', 'select=id', 'leads_services_total');
    await count('crawl_requests', 'select=id&kind=eq.services&status=eq.open', 'crawl_requests_services_open');
    await count('bookings', 'select=id', 'bookings_total');

    const snapshot = {
      captured_at: new Date().toISOString(),
      captured_by: 'ci:e2e-ledger (push-to-main)',
      commit: process.env.GITHUB_SHA || null,
      e2e_result: JOB_RESULT || null,
      dashboard,
      dashboard_error,
      raw_counts,
      note: 'Committed by CI so firewalled audit agents read live KPIs via git fetch. raw_counts bypass the snapshot RPC = ground truth; compare against dashboard to catch a lying tile.',
    };

    fs.writeFileSync(path.join(REPO_ROOT, 'ops-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');

    // Commit ONLY this file, [skip ci] so it never retriggers a workflow, and
    // never fail the job if the GITHUB_TOKEN is read-only or the push races a merge.
    const sh = (c) => execSync(c, { cwd: REPO_ROOT, stdio: 'pipe' }).toString();
    try {
      sh('git config user.email "ops-bot@cergio.ai"');
      sh('git config user.name "cergio-ops-bot"');
      sh('git add ops-snapshot.json');
      try { sh('git diff --cached --quiet'); console.error('e2e-ledger/snapshot: no KPI change — nothing to commit'); return; } catch { /* staged changes exist → proceed */ }
      sh('git commit -m "chore(ops): live KPI snapshot [skip ci]"');
      sh('git push origin HEAD:main');
      console.error('e2e-ledger/snapshot: committed ops-snapshot.json to main');
    } catch (e) {
      console.error('e2e-ledger/snapshot: could not commit (likely read-only GITHUB_TOKEN — flip repo Actions perms to read/write):', String(e?.message || e).slice(0, 200));
    }
  } catch (e) {
    console.error('e2e-ledger/snapshot: skipped —', String(e?.message || e).slice(0, 200));
  }
}

main().catch((e) => {
  // Never fail the build on a LEDGER problem — the e2e job itself is the gate.
  console.error('e2e-ledger: could not write the ledger:', e?.message || e);
  process.exit(0);
});
