// ─────────────────────────────────────────────────────────────────────────────
// Cergio — AUTONOMOUS FEATURE-BUILD PIPELINE ("the builder in CI").
//
// The other half of the self-healing loop. scripts/auto-fix.mjs can only PATCH
// existing code against an EXISTING failing test — so a requirement whose feature
// does not exist yet (status captured/built, never verified) can never be closed
// by it. This script builds those: one OPEN requirement per run, spec-test first.
//
// THE FLOW (per run, exactly ONE requirement — never batched):
//
//   1. SELECT — read `requirements` where status in ('captured','built') and not
//      verified. Skip anything flagged off-spec / needs-approval (those are the
//      founder's, not the machine's) and anything that already has a spec-test in
//      scripts/qa.mjs. Prefer the smallest, on-spec, non-sensitive one.
//
//   2. SPEC-DERIVED ACCEPTANCE TEST FIRST  ← THIS IS THE CORE SAFETY (anti-circularity)
//      Claude is asked to author the acceptance test from the FROZEN_SPEC excerpt +
//      the requirement text ONLY. It is NOT shown the implementation, and it is NOT
//      shown the contents of ANY source file (it gets the file-PATH tree and the
//      harness helper signatures — never a line of app code). The test therefore
//      encodes what the SPEC says, not what the code happens to do.
//      The test is injected into scripts/qa.mjs and RUN. It MUST go RED on current
//      code. If it is GREEN we ABORT and revert: either the requirement is already
//      met, or the test is vacuous — and a test that cannot fail proves nothing.
//      (SPEC-72: never claim verified without evidence. A green-on-arrival test is
//      not evidence, so it is never allowed to flip the ledger.)
//
//   3. IMPLEMENT — with the RED test as the target, Claude writes the MINIMAL
//      on-spec implementation, following the existing patterns + design-spec. It is
//      shown the test, the spec, and the current contents of the files the test
//      names. It may NEVER edit the test that is grading it (hard rail: any patch
//      touching scripts/qa.mjs / qa-live.mjs is DISCARDED, not reviewed).
//
//   4. GATE — the new test must go GREEN and every previously-green test must stay
//      green (baseline diff). Any regression → the whole build is reverted from
//      disk and reported. The workflow then re-runs `npm ci && npm run build &&
//      node scripts/qa.mjs` independently before it pushes anything.
//
//   5. CLOSE THE LOOP — the requirement is NOT flipped by this script's optimism.
//      `--verify-ledger` (run by the workflow on push to main, i.e. AFTER the PR
//      actually merged) re-runs qa.mjs on main and flips `spec-<reqId>` → verified
//      via cergio_verify_requirement ONLY for tests that are green on main; any
//      spec-test that is red re-opens its requirement (cergio_reopen_requirement).
//      Verification is therefore always a machine-checked test result on main —
//      never a claim.
//
// WHAT AUTO-MERGES vs WHAT GOES TO THE FOUNDER (hard rails, pure functions, proven
// offline by --self-check):
//   • AUTO-MERGE (mode=auto) — on-spec, small (≤ MAX_BUILD_FILES / MAX_BUILD_LINES),
//     non-UX, non-sensitive, spec-test RED→GREEN, zero regressions.
//   • FOUNDER APPROVAL (mode=review — branch + PR opened, auto-merge NEVER armed,
//     coo_proposal requires_approval=true) — payments/Stripe/escrow, auth/RLS/
//     tokens/sessions, secrets, access control, data-altering migrations, ANY UX
//     change (screens/components/styles), anything off-spec, and anything over the
//     size caps (a comms system / admin engine is decomposed into micro-requirements
//     instead of merged in one shot).
//   • DISCARD (nothing written, nothing pushed) — a patch that touches the grading
//     test, the CI config, the frozen spec, package/build files, or is destructive
//     (drop/truncate/delete-from, auth.admin, service-role keys); a spec-test that
//     does not go RED; any existing-test regression.
//
// It does NOT commit, push, or merge. The workflow (.github/workflows/
// autonomous-build.yml) gates + pushes; GitHub auto-merge fires only after the real
// required checks (ci.yml) go green under branch protection.
//
// Node built-ins only. Fully reversible: delete this file + the workflow.
//
// ENV: SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
//
// Usage:
//   node scripts/auto-build.mjs                  # build ONE open requirement
//   node scripts/auto-build.mjs --req=<id>        # force a specific requirement
//   node scripts/auto-build.mjs --dry             # select + plan only (no model, no write)
//   node scripts/auto-build.mjs --self-check      # prove the rails offline (no secrets)
//   node scripts/auto-build.mjs --verify-ledger   # on main: flip green spec-tests → verified
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── env ───────────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(REPO_ROOT, '.env.local');
  const e = { ...process.env };
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (e[m[1]] == null) e[m[1]] = v; // real env wins over the file
    }
  }
  return e;
}
const env = loadEnv();
const SUPA_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || '';
const MODEL = env.AUTO_BUILD_MODEL || 'claude-opus-4-8';

const argv = process.argv.slice(2);
const args = new Set(argv);
const DRY = args.has('--dry');
const SELF_CHECK = args.has('--self-check');
const VERIFY_LEDGER = args.has('--verify-ledger');
const FORCE_REQ = (argv.find(a => a.startsWith('--req=')) || '').slice(6) || null;

const MAX_BUILD_FILES = Number(env.MAX_BUILD_FILES || 5);
const MAX_BUILD_LINES = Number(env.MAX_BUILD_LINES || 300);
const MIN_SPEC_ASSERTS = Number(env.MIN_SPEC_ASSERTS || 3);
const MIN_E2E_EXPECTS = Number(env.MIN_E2E_EXPECTS || 2);

const RED='\x1b[31m',GRN='\x1b[32m',YEL='\x1b[33m',GRY='\x1b[90m',RST='\x1b[0m';
const log = (...a) => console.error(...a); // human log → stderr; machine plan → stdout

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY RAILS — pure functions, so `--self-check` proves them with no secrets.
// ─────────────────────────────────────────────────────────────────────────────

// The grading test + the gate + the spec itself. An autonomous writer may NEVER
// touch these — not even behind a review PR. A patch that does is DISCARDED, because
// a builder that can edit its own exam, its own CI, or its own spec has no gate at all.
const PATH_DISCARD = [
  /^scripts\/qa\.mjs$/, /^scripts\/qa-live\.mjs$/,      // the grader
  /^e2e\//, /^playwright\.config\./,                     // the BEHAVIOURAL grader
  /^scripts\/auto-(build|fix)\.mjs$/,                    // itself
  /^scripts\/expand-coverage\.mjs$/,
  /(^|\/)\.github\//,                                    // the CI gate
  /^FROZEN_SPEC\.md$/i, /^MARKETPLACE_SPEC\.md$/i,       // the law
  /(^|\/)\.env/i,
  /^package(-lock)?\.json$/, /^vite\.config/, /^tailwind\.config/, /^postcss\.config/,
  /(^|\/)node_modules\//,
];

// Content that is never acceptable from an autonomous writer, even in a review PR.
const CONTENT_DISCARD = [
  /\bdrop\s+(table|column|policy|function|schema)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /supabase\.auth\.admin/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /ANTHROPIC_API_KEY/i,
];

// Where a build may legally write at all. Anything else is out of bounds → discard.
const PATH_ALLOWED_ROOTS = [
  /^src\/[A-Za-z0-9_\-/.]+\.(jsx?|tsx?|css)$/,
  /^supabase\/functions\/[A-Za-z0-9_-]+\/index\.ts$/,
  /^supabase\/migrations\/\d{8,}_[a-z0-9_]+\.sql$/,
];

// Money / auth / access-control / schema surfaces. Legal to BUILD, never to
// auto-merge: branch + PR + founder approval, always.
const PATH_SENSITIVE = [
  /(^|\/)supabase\/migrations\//i,
  /stripe/i, /payment/i, /payout/i, /escrow/i, /release-funds/i, /charge/i, /refund/i, /checkout/i, /webhook/i,
  /\bauth\b/i, /login/i, /signin/i, /signup/i, /session/i, /token/i, /rls/i, /policy/i,
  /security/i, /permission/i, /\bgrant\b/i, /secret/i,
];

// Anything the user can SEE. The founder reserves UX approval for himself, so a UX
// change is built + PR'd but never auto-merged.
const PATH_UX = [
  /^src\/screens\//, /^src\/components\//, /^src\/App\.jsx$/,
  /\.css$/, /^src\/theme/, /^src\/styles/,
];

// Content that is legal but must be human-reviewed before it merges.
const CONTENT_SENSITIVE = [
  /\bstripe\b/i, /\bservice_role\b/i, /process\.env\.[A-Z_]*KEY/i, /\bescrow\b/i,
];

// Requirement text that means "this touches money / identity / the database shape".
const REQ_SENSITIVE = [
  /payment|stripe|escrow|payout|charge|refund|checkout|funds|money|price|billing/i,
  /\bauth\b|login|sign[- ]?in|sign[- ]?up|session|token|rls|policy|permission|access control|role/i,
  /secret|api key|service[- ]role|credential/i,
  /migration|schema|column|table|index\b/i,
];

// Requirement text that means "the founder already owns this decision".
const REQ_FLAGGED = /off-?spec|needs[- ]approval|requires[- ]approval|founder[- ]approval|do[- ]not[- ]auto|manual only|hold for review/i;

const rel = p => String(p || '').replace(/^\.\//, '');
const anyMatch = (res, s) => res.some(re => re.test(s));

function pathDiscarded(p)  { return anyMatch(PATH_DISCARD, rel(p)); }
function pathAllowed(p)    { return anyMatch(PATH_ALLOWED_ROOTS, rel(p)); }
function pathSensitive(p)  { return anyMatch(PATH_SENSITIVE, rel(p)); }
function pathUx(p)         { return anyMatch(PATH_UX, rel(p)); }

// Conservative symmetric line-diff (over-counts rather than under-counts → the size
// cap fails safe).
function changedLineCount(before, after) {
  const a = (before || '').split('\n');
  const b = (after || '').split('\n');
  const ca = new Map(); for (const l of a) ca.set(l, (ca.get(l) || 0) + 1);
  const cb = new Map(); for (const l of b) cb.set(l, (cb.get(l) || 0) + 1);
  let removed = 0, added = 0;
  for (const [l, n] of ca) removed += Math.max(0, n - (cb.get(l) || 0));
  for (const [l, n] of cb) added += Math.max(0, n - (ca.get(l) || 0));
  return removed + added;
}

/**
 * Is this requirement one the machine may pick up at all?
 *   selectable=false → the founder owns it (flagged off-spec / needs-approval), or
 *                      it is already verified.
 *   sensitive=true   → it may be BUILT, but only ever as a review PR.
 */
function classifyRequirement(req) {
  const text = `${req.instruction || ''} ${req.spec_ref || ''} ${req.suite || ''} ${req.evidence || ''}`;
  const reasons = [];
  let selectable = true;
  if (req.status === 'verified') { selectable = false; reasons.push('already verified'); }
  if (REQ_FLAGGED.test(text)) { selectable = false; reasons.push('flagged off-spec / needs founder approval'); }
  const sensitive = anyMatch(REQ_SENSITIVE, text);
  if (sensitive) reasons.push('sensitive surface (payments/auth/access/schema) → review PR only, never auto-merge');
  return { selectable, sensitive, reasons };
}

/** Order: non-sensitive first, then smallest instruction (prefer small + on-spec). */
function rankRequirements(reqs, qaSrc) {
  return reqs
    .map(r => ({ r, c: classifyRequirement(r) }))
    .filter(({ r, c }) => c.selectable && !hasSpecTest(qaSrc, r.id))
    .sort((x, y) =>
      (x.c.sensitive ? 1 : 0) - (y.c.sensitive ? 1 : 0) ||
      String(x.r.instruction || '').length - String(y.r.instruction || '').length ||
      String(x.r.id).localeCompare(String(y.r.id)))
    .map(({ r, c }) => ({ ...r, _sensitive: c.sensitive, _reasons: c.reasons }));
}

const specTestId = reqId => `spec-${reqId}`;
function hasSpecTest(qaSrc, reqId) {
  return String(qaSrc || '').includes(`test('${specTestId(reqId)}'`);
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOURAL ACCEPTANCE — the mitigation for the shape-satisfying-stub risk.
//
// A qa.mjs spec-test is a CODE-INVARIANT test: it greps for the shape of the fix.
// That is a real gate, but it has an honest hole — a well-shaped STUB passes it.
// `isScheduledWhen(when)` can be imported, referenced, and still render the wrong
// sentence; the paid-fallback banner can exist in the source and still show while
// a free option sits right there on screen.
//
// So when a requirement is USER-JOURNEY-SHAPED ("the user sees…", "clicking X
// confirms…", "the banner must not show when…"), the builder now ALSO authors a
// Playwright spec that drives the real app in a real browser and asserts on what
// is RENDERED and what the app actually WROTE. The grep proves the code has the
// right shape; the journey proves it has the right behaviour. Both ship, both are
// regression guards, and — critically — the implementer may never edit either
// (e2e/ is in PATH_DISCARD alongside scripts/qa.mjs).
// ─────────────────────────────────────────────────────────────────────────────

// Requirement text that describes something a USER does or SEES. These are the
// requirements a grep cannot honestly close.
const REQ_JOURNEY = [
  /\buser\b|\bconsumer\b|\bprovider\b|\bconnector\b|\bfounder\b/i,
  /\bsees?\b|\bshown?\b|\bdisplays?\b|\brenders?\b|\bvisible\b|\bcopy\b|\bmessage\b|\bbanner\b|\bpill\b|\btoast\b/i,
  /\bclicks?\b|\btaps?\b|\bsubmits?\b|\baccepts?\b|\bconfirms?\b|\bbooks?\b|\bsearch(es)?\b|\bnavigates?\b|\bredirects?\b/i,
  /\bscreen\b|\bpage\b|\bflow\b|\bjourney\b|\bresults\b|\bcheckout\b|\binbox\b|\bdead[- ]end\b/i,
];
/** Journey-shaped = it talks about a user AND about something seen or done. */
function isJourneyShaped(req) {
  const text = `${req?.instruction || ''} ${req?.spec_ref || ''} ${req?.suite || ''}`;
  const hits = REQ_JOURNEY.filter(re => re.test(text)).length;
  return hits >= 2;
}

const e2eSpecPath = reqId => `e2e/spec-${String(reqId).replace(/[^a-z0-9_-]/gi, '-')}.spec.js`;

// Rails on the AUTHORED E2E SPEC. A behavioural test that never looks at the page
// is just a slower grep — and one that reaches the real network is a liability.
const E2E_CONTENT_FORBIDDEN = [
  /process\.env/, /SERVICE_ROLE/i, /ANTHROPIC/i, /child_process/, /\bfs\./,
  /supabase\.co\b/i,                                  // never the real project
  /page\.route\s*\(\s*['"`]\*\*\/\*/,                 // must not fight the harness router
];
function evaluateE2ESpec(cand, req) {
  const reasons = [];
  const code = String(cand?.code || '');
  if (!code.trim()) return { ok: false, reasons: ['empty e2e spec'] };
  if (!/from\s+['"]\.\/support\/harness\.js['"]/.test(code)) {
    reasons.push('must drive the seeded world via ./support/harness.js (installWorld) — a spec that invents its own backend proves nothing');
  }
  if (!/installWorld\s*\(/.test(code)) reasons.push('must call installWorld(page, …) — otherwise it has no world to act on');
  if (!/\btest\s*\(/.test(code)) reasons.push('must register at least one test(…)');
  const expects = (code.match(/\bexpect\s*\(/g) || []).length;
  if (expects < MIN_E2E_EXPECTS) reasons.push(`only ${expects} expect() call(s) (min ${MIN_E2E_EXPECTS}) — too weak to be evidence`);
  // The whole point: it must assert on the RENDERED page or on a REAL write.
  if (!/(getByText|getByRole|getByLabel|getByTestId|locator\s*\(|toBeVisible|toHaveCount|net\.writes)/.test(code)) {
    reasons.push('asserts nothing about what the user SEES or what the app WROTE — this is the code-shape gap it exists to close');
  }
  if (/\|\|\s*true\b/.test(code)) reasons.push('vacuous escape hatch: `|| true`');
  for (const re of E2E_CONTENT_FORBIDDEN) {
    if (re.test(code)) reasons.push(`e2e spec must stay hermetic (no secrets/env/fs/real project): matched ${re}`);
  }
  void req;
  return { ok: reasons.length === 0, reasons };
}

/** Is Playwright actually installed here? We never PRETEND to have run a browser. */
function playwrightAvailable() {
  const r = spawnSync('npx', ['--no-install', 'playwright', '--version'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000,
  });
  return r.status === 0;
}

/** Run ONE e2e spec. Returns {ran, pass}. `ran:false` = no browser here — and we
 *  then make NO claim about it (SPEC-72: never claim verified without evidence). */
function runE2E(specRelPath) {
  if (!playwrightAvailable()) return { ran: false, pass: null };
  const r = spawnSync('npx', ['--no-install', 'playwright', 'test', specRelPath, '--reporter=list'], {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60_000,
  });
  return { ran: true, pass: r.status === 0, out: String(r.stdout || r.stderr || '').slice(-2000) };
}

/**
 * The RED gate for the behavioural spec — same anti-vacuity law as qa.mjs:
 * a journey test that PASSES before the feature exists proves nothing.
 * When no browser is present we do not fail the build (the qa.mjs RED gate still
 * governs) — but we do not claim the journey was proven either.
 */
function decideE2ERed(result) {
  if (!result.ran) {
    return { proceed: true, proven: false, note: 'Playwright not installed in this runner — the e2e spec ships as a regression guard and CI (ci.yml → e2e) is its first real execution. It was NOT proven RED here.' };
  }
  if (result.pass) {
    return { proceed: false, proven: true, abort: 'e2e journey PASSED on current code — it is vacuous, or the requirement is already met. Never build on a test that cannot fail.' };
  }
  return { proceed: true, proven: true, note: 'e2e journey RED on current code, as it must be.' };
}

/**
 * ANTI-VACUITY rails on the AUTHORED TEST (before it is even run). A test that
 * cannot fail, or that reaches the network/DB, or that asserts nothing concrete,
 * is not evidence — reject it.
 */
const TEST_CONTENT_FORBIDDEN = [
  /\bfetch\s*\(/, /child_process/, /execFileSync/, /writeFileSync/, /process\.env/,
  /SERVICE_ROLE/i, /\.rpc\s*\(/, /supabase/i,
];
function evaluateSpecTest(cand, req) {
  const reasons = [];
  const code = String(cand?.code || '');
  const id = specTestId(req.id);
  if (!code.trim()) return { ok: false, reasons: ['empty test code'] };
  if (!code.includes(`test('${id}'`)) reasons.push(`test must be registered as test('${id}', …)`);
  const asserts = (code.match(/\bassert\s*\(/g) || []).length;
  if (asserts < MIN_SPEC_ASSERTS) reasons.push(`only ${asserts} assert() call(s) (min ${MIN_SPEC_ASSERTS}) — too weak to be evidence`);
  if (/assert\s*\(\s*(true|1|!!1)\b/.test(code)) reasons.push('vacuous assertion: assert(true)');
  if (/\|\|\s*true\b/.test(code)) reasons.push('vacuous escape hatch: `|| true`');
  for (const re of TEST_CONTENT_FORBIDDEN) {
    if (re.test(code)) reasons.push(`spec-test must be a code-invariant test (no network/DB/env): matched ${re}`);
  }
  // Must name at least one concrete target in the codebase — otherwise it is prose.
  if (!/(src\/[A-Za-z0-9_\-/.]+|supabase\/functions\/[A-Za-z0-9_-]+)/.test(code)) {
    reasons.push('test names no concrete source path — cannot be a real acceptance test');
  }
  if (!String(cand?.expected_red_reason || '').trim()) {
    reasons.push('model did not state WHY this must fail on current code (expected_red_reason)');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * THE RED GATE. Given the baseline results (before injection) and the results with
 * the spec-test injected, decide whether we may proceed to implement.
 *   - the new test MUST be present and MUST fail  (anti-circularity / anti-vacuous)
 *   - it must not have broken anything else       (a test that breaks the suite is a bad test)
 */
function decideRed(baseline, after, testId) {
  const b = new Map(baseline.map(r => [r.id, r.pass]));
  const a = new Map(after.map(r => [r.id, r.pass]));
  if (!a.has(testId)) return { proceed: false, abort: 'spec-test did not register in qa.mjs' };
  if (a.get(testId) === true) {
    return { proceed: false, abort: 'spec-test PASSED on current code — it is vacuous, or the requirement is already met. Never build on a test that cannot fail.' };
  }
  const collateral = [...b.entries()].filter(([id, pass]) => pass && id !== testId && a.get(id) === false).map(([id]) => id);
  if (collateral.length) return { proceed: false, abort: `spec-test broke existing test(s): ${collateral.join(', ')}` };
  const err = (after.find(r => r.id === testId) || {}).err || '';
  return { proceed: true, redReason: err };
}

/** Regression diff: any test that was green at baseline and is now red. */
function regressions(baseline, after, exceptId) {
  const a = new Map(after.map(r => [r.id, r.pass]));
  return baseline.filter(r => r.pass && r.id !== exceptId && a.get(r.id) === false).map(r => r.id);
}

/**
 * THE BUILD GATE. mode: 'auto' (auto-merge armed) | 'review' (PR → founder approval,
 * auto-merge NEVER armed) | 'discard' (nothing written).
 */
function evaluateBuild(patch, { onSpec, sensitiveReq }) {
  const reasons = [];
  const files = Array.isArray(patch?.files) ? patch.files : [];
  if (files.length === 0) return { mode: 'discard', reasons: ['patch contains no files'], totalChanged: 0 };

  let discard = false, review = false, totalChanged = 0;

  for (const f of files) {
    const p = rel(f.path);
    const after = String(f.after ?? '');
    if (pathDiscarded(p)) { discard = true; reasons.push(`DISCARD — may never write ${p} (grading test / CI / spec / build config)`); }
    else if (!pathAllowed(p)) { discard = true; reasons.push(`DISCARD — ${p} is outside the allowed build roots`); }
    for (const re of CONTENT_DISCARD) {
      if (re.test(after)) { discard = true; reasons.push(`DISCARD — destructive/forbidden content in ${p}: ${re}`); }
    }
    if (pathSensitive(p)) { review = true; reasons.push(`sensitive path (payments/auth/access/migration): ${p}`); }
    if (pathUx(p)) { review = true; reasons.push(`UX change — the founder approves all UX: ${p}`); }
    for (const re of CONTENT_SENSITIVE) {
      if (re.test(after)) { review = true; reasons.push(`sensitive content in ${p}: ${re}`); }
    }
    totalChanged += changedLineCount(f.before || '', after);
  }

  if (files.length > MAX_BUILD_FILES) { review = true; reasons.push(`touches ${files.length} files (> cap ${MAX_BUILD_FILES}) — decompose into micro-requirements`); }
  if (totalChanged > MAX_BUILD_LINES) { review = true; reasons.push(`~${totalChanged} changed lines (> cap ${MAX_BUILD_LINES}) — decompose into micro-requirements`); }
  if (onSpec !== true) { review = true; reasons.push('not marked on_spec by the model — off-spec never auto-merges'); }
  if (sensitiveReq === true) { review = true; reasons.push('requirement itself is on a sensitive surface'); }

  if (discard) return { mode: 'discard', reasons, totalChanged };
  if (review) return { mode: 'review', reasons, totalChanged };
  return { mode: 'auto', reasons, totalChanged };
}

/** Evidence string for the ledger. Honest by construction: names the check + when. */
function verifyEvidence(testId, sha) {
  return `${testId} PASS @ ${new Date().toISOString().slice(0, 16)}Z — spec-derived acceptance test green on main${sha ? ` (${String(sha).slice(0, 7)})` : ''}`;
}

/** Ledger actions derived from a qa.mjs run: only green spec-tests verify. */
function ledgerActionsFor(results, sha) {
  const out = [];
  for (const r of results) {
    if (!/^spec-/.test(r.id)) continue;
    const reqId = r.id.slice(5);
    if (r.pass) out.push({ action: 'verify', id: reqId, evidence: verifyEvidence(r.id, sha) });
    else out.push({ action: 'reopen', id: reqId, reason: `${r.id} RED — ${String(r.err || 'spec-derived acceptance test failing').slice(0, 160)}` });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo I/O + the qa.mjs harness
// ─────────────────────────────────────────────────────────────────────────────
function readSafe(r) { try { return fs.readFileSync(path.join(REPO_ROOT, r), 'utf8'); } catch { return ''; } }
function exists(r) { return fs.existsSync(path.join(REPO_ROOT, r)); }

/** Path-only tree of src/ + edge functions. NO file contents — the test author must
 *  never see the implementation (that is the whole anti-circularity point). */
function sourceTree() {
  const out = [];
  const walk = (dir, base) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const r = path.posix.join(base, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (/\.(jsx?|tsx?|css)$/.test(e.name)) out.push(r);
    }
  };
  walk(path.join(REPO_ROOT, 'src'), 'src');
  try {
    for (const d of fs.readdirSync(path.join(REPO_ROOT, 'supabase/functions'), { withFileTypes: true })) {
      if (d.isDirectory()) out.push(`supabase/functions/${d.name}/index.ts`);
    }
  } catch { /* no functions dir */ }
  return out.sort();
}

/** FROZEN_SPEC / MARKETPLACE_SPEC sections matching the requirement's spec refs. */
function specExcerpt(req) {
  const docs = [readSafe('FROZEN_SPEC.md'), readSafe('MARKETPLACE_SPEC.md')];
  const text = `${req.spec_ref || ''} ${req.instruction || ''}`;
  const ids = new Set();
  for (const m of text.matchAll(/\bSPEC-[A-Z0-9]+/gi)) ids.add(m[0].toUpperCase());
  for (const m of text.matchAll(/#(\d+)\b/g)) ids.add('#' + m[1]);
  const chunks = [];
  for (const doc of docs) {
    const lines = doc.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^###\s/.test(lines[i])) continue;
      const header = lines[i].toUpperCase();
      if (![...ids].some(id => header.includes(id))) continue;
      let j = i + 1;
      while (j < lines.length && !/^###\s/.test(lines[j]) && !/^##\s/.test(lines[j])) j++;
      chunks.push(lines.slice(i, j).join('\n'));
    }
  }
  return chunks.join('\n\n---\n\n').slice(0, 8000);
}

/** Inject a test into scripts/qa.mjs, immediately before the trailing main() call. */
function injectTest(qaSrc, code, reqId) {
  const anchor = qaSrc.lastIndexOf('main().catch(');
  if (anchor < 0) return null;
  const block = [
    '',
    `// ─── [auto-build ${new Date().toISOString().slice(0, 10)}] SPEC-DERIVED ACCEPTANCE TEST for requirement ${reqId}`,
    '// Authored from the FROZEN_SPEC / requirement text ONLY (the author never saw the',
    '// implementation). It was RED on the code that existed before the feature was built.',
    '// It is the regression guard AND the verification evidence for this requirement.',
    code.trim(),
    '',
    '',
  ].join('\n');
  return qaSrc.slice(0, anchor) + block + qaSrc.slice(anchor);
}

/** Run the qa.mjs harness and return its per-test results (exit code ignored). */
function runQa() {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts/qa.mjs'), '--json'], {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const out = String(r.stdout || '');
  const start = out.indexOf('{');
  if (start < 0) throw new Error(`qa.mjs produced no JSON (exit ${r.status}): ${String(r.stderr || out).slice(0, 300)}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed.results || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase REST (no npm)
// ─────────────────────────────────────────────────────────────────────────────
function db() {
  if (!SUPA_URL || !SERVICE_KEY) return null;
  const base = `${SUPA_URL}/rest/v1`;
  const h = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });
  return {
    async select(table, q = '') {
      const r = await fetch(`${base}/${table}${q}`, { headers: h() });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    },
    async insert(table, body, prefer = 'return=minimal') {
      const r = await fetch(`${base}/${table}`, { method: 'POST', headers: { ...h(), Prefer: prefer }, body: JSON.stringify(body) });
      return { ok: r.ok, status: r.status };
    },
    async rpc(fn, params = {}) {
      const r = await fetch(`${base}/rpc/${fn}`, { method: 'POST', headers: h(), body: JSON.stringify(params) });
      return { ok: r.ok, status: r.status };
    },
  };
}

/** The founder-approval contract — identical to qa-live.mjs / auto-fix.mjs. */
async function openApproval(D, { req, title, detail }) {
  if (!D) return;
  await D.insert('coo_proposals', {
    run_date: new Date().toISOString().slice(0, 10),
    rank: 2, division: 'build',
    title: String(title).slice(0, 120),
    detail: String(detail).slice(0, 500),
    expected_lift: `closes requirement ${req?.id || '(unknown)'} (held for founder review)`,
    effort: 'manual', status: 'pending',
    on_spec: false, action_kind: 'none', action_payload: '',
    requires_approval: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL CALL 1 — the SPEC-DERIVED acceptance test. NO implementation is shown.
// ─────────────────────────────────────────────────────────────────────────────
async function anthropic({ system, user, maxTokens }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const jr = await r.json();
  const txt = (jr.content || []).map(c => c.text || '').join('').trim()
    .replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(txt); }
  catch { throw new Error('model did not return valid JSON: ' + txt.slice(0, 200)); }
}

async function authorSpecTest({ req, spec, tree }) {
  const id = specTestId(req.id);
  const journey = isJourneyShaped(req);

  // For a user-journey requirement, a grep is NOT enough evidence: a stub with the
  // right shape passes it. Ask for a BEHAVIOURAL spec as well — one that drives the
  // real app in a real browser and asserts on what is rendered / what was written.
  const e2eBrief = journey ? [
    '',
    '── SECOND ARTIFACT: A BEHAVIOURAL E2E SPEC (required — this requirement is user-journey-shaped) ──',
    'A code-invariant grep can be satisfied by a STUB that has the right shape and the wrong behaviour.',
    'So you must ALSO author a Playwright spec that drives the REAL app and asserts on what the USER SEES.',
    '',
    'HARNESS (e2e/support/harness.js — a hermetic seeded world; no secrets, no network):',
    "  import { test, expect } from '@playwright/test';",
    "  import { installWorld, assertNoEscapedRequests, searchFromHome } from './support/harness.js';",
    "  import { FREE_WORLD, PAID_WORLD, EMPTY_WORLD, PENDING_BOOKING, CONSUMER, PROVIDER, SEARCH_ADDRESS, parseResultFor } from './support/world.js';",
    '  const net = await installWorld(page, { world: FREE_WORLD, parse: parseResultFor({ what, when, where, budget }), user, booking });',
    '     · net.writes   — every mutation the app actually SENT (e.g. { kind: "booking.update", patch })',
    '     · net.booking() — the booking as the fake DB now holds it',
    '  await searchFromHome(page, "<the query a user types>");   // Home → /results',
    '  await page.goto("/request/" + PENDING_BOOKING.id);        // a provider opening a request',
    '  assertNoEscapedRequests(net);                             // nothing may reach a real host',
    '',
    'E2E RULES:',
    '1. Assert on the RENDERED page (getByText / getByRole / toBeVisible / toHaveCount) and, when the',
    '   journey WRITES something, on net.writes — a screen that only repaints its own state must FAIL.',
    `2. At least ${MIN_E2E_EXPECTS} expect() calls, each on a concrete, spec-mandated, user-visible fact.`,
    '3. Hermetic: never process.env, never fs, never a real supabase.co host, never `|| true`.',
    '4. Where the spec defines a NEGATIVE ("must not show X when Y"), also assert the POSITIVE CONTROL',
    '   ("shows X when not-Y") — otherwise a screen that never renders X would pass vacuously.',
    '5. It must FAIL on code that lacks the feature, exactly like the qa.mjs test.',
  ].join('\n') : '';

  const system = [
    'You author ONE acceptance test for Cergio, from the SPEC ONLY.',
    'You have NOT been shown the implementation and you must NOT guess at it: your job is to encode',
    'what the SPEC REQUIRES, so that the test FAILS today (the feature does not exist yet) and passes',
    'only once the feature is genuinely built to spec. A test that could pass on today\'s code is worthless.',
    '',
    'HARNESS (scripts/qa.mjs — code-invariant tests, run in CI with NO secrets and NO network):',
    "  test(id, name, invariant, async () => { ... })   // registers a test; throw = fail",
    '  readFile(relPath) -> string        // throws if the file does not exist (a legitimate RED)',
    '  fileGrep(relPath, /regex/) -> bool',
    '  stripComments(src) / stripCommentsAndStrings(src) -> string  // grep CODE, not comments/strings',
    '  walkSync(absDir) -> string[]',
    '  assert(cond, message)',
    "  await import(path.join(REPO_ROOT, 'src/lib/x.js'))  // allowed: pure module behavior",
    '',
    'RULES (non-negotiable):',
    `1. Register exactly one test with id '${id}' and invariant 'REQ:${req.id}'.`,
    '2. It must be a CODE-INVARIANT test: filesystem reads, greps, and (optionally) importing a pure',
    '   src module and calling it. NEVER fetch(), NEVER a DB/RPC call, NEVER process.env, NEVER secrets —',
    '   the CI gate runs offline.',
    `3. At least ${MIN_SPEC_ASSERTS} assert() calls, each on a CONCRETE, spec-mandated fact (a named export,`,
    '   a route, a required field, a state transition, a guard). No assert(true), no `|| true`.',
    '4. Name the concrete file path(s) where the spec says the behavior must live, chosen from the path',
    '   tree below and the existing conventions (logic → src/lib/*.js, data access → src/lib/api.js,',
    '   state → src/hooks/*.js, UI → src/screens/*.jsx, server → supabase/functions/<name>/index.ts).',
    '5. Assert only what the SPEC / requirement text DEFINES. If the spec is silent or ambiguous, do NOT',
    '   invent behavior — return {"onSpec": false, "note": "<what is undefined>"} and author nothing.',
    e2eBrief,
    '',
    '6. Return ONLY JSON:',
    `   {"onSpec":true,"test_id":"${id}","target_paths":["src/lib/..."],`,
    '    "expected_red_reason":"<why this MUST fail on code that lacks the feature>",',
    '    "code":"test(\'' + id + '\', \'<name>\', \'REQ:' + req.id + '\', async () => { ... });"'
      + (journey
        ? ',\n    "e2e":{"code":"<a COMPLETE standalone Playwright spec file, imports included>",'
          + '"expected_red_reason":"<why the JOURNEY fails on today\'s code>"}}'
        : '}'),
    '   "code" must be valid JS that can be pasted into scripts/qa.mjs at top level.',
    journey ? `   "e2e".code must be a complete spec file — it is written verbatim to ${e2eSpecPath(req.id)}.` : '',
  ].filter(Boolean).join('\n');

  const user = [
    `REQUIREMENT id: ${req.id}`,
    `REQUIREMENT (the law): ${req.instruction}`,
    `spec_ref: ${req.spec_ref || '(none)'}   suite: ${req.suite || '(none)'}   status: ${req.status}`,
    '',
    '=== FROZEN_SPEC excerpt (law — the ONLY description of intended behavior you get) ===',
    spec || '(no matching spec section — the requirement text above IS the spec)',
    '',
    '=== Source PATH tree (paths only — you are deliberately NOT shown any code) ===',
    tree.join('\n'),
    '',
    'Author the acceptance test now. Strict JSON only.',
  ].join('\n');

  return anthropic({ system, user, maxTokens: 3000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL CALL 2 — the implementation, targeting the RED test.
// ─────────────────────────────────────────────────────────────────────────────
async function authorImplementation({ req, spec, testCode, redReason, targets, designSpec }) {
  const fileBlocks = targets.map(p => {
    const body = exists(p) ? readSafe(p) : '';
    return body
      ? `<file path="${p}">\n${body.slice(0, 20000)}\n</file>`
      : `<file path="${p}" status="does-not-exist-yet" />`;
  }).join('\n\n');

  const system = [
    'You are a senior engineer building ONE requirement in the Cergio app under a frozen spec.',
    'A spec-derived acceptance test already exists and is RED. Make it GREEN — nothing more.',
    'Rules (non-negotiable):',
    '1. MINIMAL, on-spec implementation. Follow the existing patterns in the files you are shown.',
    '2. You may NOT modify the test, scripts/qa.mjs, scripts/qa-live.mjs, CI config, FROZEN_SPEC.md,',
    '   or package/build files. Any attempt is discarded. Make the code satisfy the test — never the',
    '   reverse.',
    '3. NEVER write destructive SQL (drop/truncate/delete from), never touch auth.admin, never inline a',
    '   service-role key or any secret.',
    '4. If the requirement genuinely needs payments/auth/RLS/migrations, you MAY write it — it will be',
    '   held for founder approval and never auto-merged. Say so in "summary".',
    `5. Size cap: ≤ ${MAX_BUILD_FILES} files and ≈${MAX_BUILD_LINES} changed lines. If the requirement is`,
    '   genuinely bigger than that (a whole comms system, an admin engine), do NOT half-build it: return',
    '   {"onSpec":true,"tooLarge":true,"microRequirements":[{"id":"<slug>","instruction":"<one shippable',
    '   slice>","spec_ref":"<ref>"}, …],"files":[]} and it will be decomposed across future runs.',
    '6. Design: if you touch UI, obey design-spec.md tokens — never invent colors/spacing.',
    '7. Return ONLY JSON:',
    '   {"onSpec":true,"summary":"<one line>","files":[{"path":"src/...","after":"<ENTIRE new file>"}]}',
    '   Each "after" is the COMPLETE new content of that file (not a diff).',
  ].join('\n');

  const user = [
    `REQUIREMENT id: ${req.id}`,
    `REQUIREMENT (the law): ${req.instruction}`,
    `spec_ref: ${req.spec_ref || '(none)'}`,
    '',
    '=== FROZEN_SPEC excerpt (law) ===',
    spec || '(the requirement text above IS the spec)',
    '',
    '=== THE RED ACCEPTANCE TEST (your target — it currently FAILS; you may NOT edit it) ===',
    testCode,
    `RED reason on current code: ${redReason || '(assertion failed)'}`,
    '',
    '=== Current contents of the files the test names (pattern reference) ===',
    fileBlocks || '(none exist yet)',
    '',
    designSpec ? '=== design-spec.md (token law for any UI) ===\n' + designSpec.slice(0, 4000) : '',
    '',
    'Return the strict JSON implementation now.',
  ].join('\n');

  const parsed = await anthropic({ system, user, maxTokens: 16000 });
  parsed.files = (parsed.files || []).map(f => {
    const p = rel(f.path);
    const before = exists(p) ? readSafe(p) : '';
    return { path: p, before, after: String(f.after ?? ''), isNew: !exists(p) };
  });
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-CHECK — prove every rail offline: no secrets, no model, no DB, no writes.
// ─────────────────────────────────────────────────────────────────────────────
function runSelfCheck() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; log(`${GRN}PASS${RST} ${n}`); } else { fail++; log(`${RED}FAIL${RST} ${n}`); } };

  // ── (a) ANTI-VACUOUS: a spec-test that does NOT go red → ABORT ───────────────
  const baseline = [{ id: 'auth', pass: true }, { id: 'address', pass: true }];
  const notRed = decideRed(baseline, [...baseline, { id: 'spec-x', pass: true }], 'spec-x');
  ok('(a) spec-test green on current code → ABORT (anti-vacuous)',
    notRed.proceed === false && /vacuous|already met/i.test(notRed.abort));
  const isRed = decideRed(baseline, [...baseline, { id: 'spec-x', pass: false, err: 'missing export' }], 'spec-x');
  ok('(a) spec-test red on current code → proceed', isRed.proceed === true && /missing export/.test(isRed.redReason));
  const missing = decideRed(baseline, baseline, 'spec-x');
  ok('(a) spec-test that never registered → ABORT', missing.proceed === false);
  const collateral = decideRed(baseline, [{ id: 'auth', pass: false }, { id: 'address', pass: true }, { id: 'spec-x', pass: false }], 'spec-x');
  ok('(a) spec-test that breaks an existing test → ABORT', collateral.proceed === false && /broke existing/.test(collateral.abort));

  // vacuity rails on the authored test itself
  const req = { id: 'p1-x', instruction: 'do a thing', spec_ref: 'SPEC-13' };
  ok('(a) vacuous assert(true) test rejected',
    evaluateSpecTest({ code: "test('spec-p1-x','n','REQ:p1-x', async () => { assert(true); assert(true); assert(true); const s = readFile('src/lib/a.js'); void s; });", expected_red_reason: 'x' }, req).ok === false);
  ok('(a) too-few-asserts test rejected',
    evaluateSpecTest({ code: "test('spec-p1-x','n','REQ:p1-x', async () => { assert(/x/.test(readFile('src/lib/a.js'))); });", expected_red_reason: 'x' }, req).ok === false);
  ok('(a) network/DB in a spec-test rejected',
    evaluateSpecTest({ code: "test('spec-p1-x','n','REQ:p1-x', async () => { const r = await fetch('http://x'); assert(r); assert(r); assert(r); const s=readFile('src/lib/a.js'); void s; });", expected_red_reason: 'x' }, req).ok === false);
  const goodTest = {
    code: "test('spec-p1-x','n','REQ:p1-x', async () => { const src = readFile('src/lib/waves.js'); assert(/WAVE_SIZE = 10/.test(src), 'wave size'); assert(/T_PLUS_MINUTES = 2/.test(src), 'cadence'); assert(/CAP_MINUTES = 60/.test(src), 'cap'); });",
    expected_red_reason: 'src/lib/waves.js does not exist yet',
  };
  ok('(a) a concrete, multi-assert, offline spec-test is accepted', evaluateSpecTest(goodTest, req).ok === true);

  // ── (b) PAYMENTS / AUTH → founder approval, NEVER auto-merged ────────────────
  const payReq = { id: 'p3-escrow-release', status: 'captured', instruction: 'Escrow holds the payment and auto-releases 6h after job start (SPEC-71.4).', spec_ref: 'SPEC-71' };
  const payC = classifyRequirement(payReq);
  ok('(b) payments/escrow requirement classified sensitive', payC.selectable === true && payC.sensitive === true);
  const payBuild = evaluateBuild({ files: [{ path: 'src/lib/escrow.js', before: '', after: 'export const HOLD = true;\n' }] }, { onSpec: true, sensitiveReq: payC.sensitive });
  ok('(b) payments build → review PR (never auto-merge)', payBuild.mode === 'review');
  const authBuild = evaluateBuild({ files: [{ path: 'src/hooks/useSession.js', before: 'a\n', after: 'b\n' }] }, { onSpec: true, sensitiveReq: false });
  ok('(b) auth/session file → review PR (never auto-merge)', authBuild.mode === 'review' && authBuild.reasons.some(r => /sensitive path/.test(r)));
  const migBuild = evaluateBuild({ files: [{ path: 'supabase/migrations/20260714000000_x.sql', before: '', after: 'alter table public.bookings add column if not exists x int;\n' }] }, { onSpec: true, sensitiveReq: false });
  ok('(b) data-altering migration → review PR (never auto-merge)', migBuild.mode === 'review');

  // ── (c) OFF-SPEC / UX → founder approval ────────────────────────────────────
  const uxBuild = evaluateBuild({ files: [{ path: 'src/screens/ActivityScreen.jsx', before: 'a\n', after: 'b\n' }] }, { onSpec: true, sensitiveReq: false });
  ok('(c) UX change (screen) → review PR (founder owns UX)', uxBuild.mode === 'review' && uxBuild.reasons.some(r => /UX change/.test(r)));
  const offSpecBuild = evaluateBuild({ files: [{ path: 'src/lib/x.js', before: 'a\n', after: 'b\n' }] }, { onSpec: false, sensitiveReq: false });
  ok('(c) off-spec build → review PR', offSpecBuild.mode === 'review' && offSpecBuild.reasons.some(r => /off-spec never auto-merges/.test(r)));
  ok('(c) requirement flagged off-spec/needs-approval is NOT selectable',
    classifyRequirement({ id: 'x', status: 'captured', instruction: 'Off-spec: new admin dashboard (needs approval)' }).selectable === false);
  const bigBuild = evaluateBuild({ files: [{ path: 'src/lib/comms.js', before: '', after: Array.from({ length: 400 }, (_, i) => `const l${i} = ${i};`).join('\n') }] }, { onSpec: true, sensitiveReq: false });
  ok('(c) oversized build → review PR + decompose', bigBuild.mode === 'review' && bigBuild.reasons.some(r => /decompose/.test(r)));

  // ── (c2) BEHAVIOURAL ACCEPTANCE — the shape-satisfying-stub mitigation ──────
  // A grep proves the code has the right SHAPE. For a user journey that is not
  // enough. These rails prove the builder now ALSO demands a behavioural test —
  // and that the behavioural test is itself real (looks at the page, stays
  // hermetic, and can never be edited by the thing it is grading).
  const journeyReq = {
    id: 'p2-paid-banner',
    status: 'captured',
    instruction: 'On /results the user must not see the "no free plumbers nearby — showing paid options" banner when a free option IS available nearby.',
    spec_ref: 'SPEC-44',
  };
  ok('(c2) a user-journey requirement is recognised as journey-shaped',
    isJourneyShaped(journeyReq) === true);
  ok('(c2) a pure data/worker requirement is NOT journey-shaped (no browser tax on a cron fix)',
    isJourneyShaped({ id: 'p10-crawl', instruction: 'fulfill-crawl must drain queued YellowPages jobs into leads_services rows.' }) === false);

  const goodE2E = {
    code: [
      "import { test, expect } from '@playwright/test';",
      "import { installWorld, assertNoEscapedRequests, searchFromHome } from './support/harness.js';",
      "import { FREE_WORLD, SEARCH_ADDRESS, parseResultFor } from './support/world.js';",
      "test('free option → no paid banner', async ({ page }) => {",
      '  const net = await installWorld(page, { world: FREE_WORLD, parse: parseResultFor({ when: "tomorrow" }) });',
      '  await searchFromHome(page, `plumber tomorrow at ${SEARCH_ADDRESS}`);',
      '  await expect(page.getByText(/Marisol/).first()).toBeVisible();',
      '  await expect(page.getByText(/showing paid options/i)).toHaveCount(0);',
      '  assertNoEscapedRequests(net);',
      '});',
    ].join('\n'),
    expected_red_reason: 'the banner renders even when a free option exists',
  };
  ok('(c2) a page-asserting, hermetic e2e spec is accepted',
    evaluateE2ESpec(goodE2E, journeyReq).ok === true);
  ok('(c2) an e2e spec that never looks at the page is rejected (that is just a slower grep)',
    evaluateE2ESpec({ code: "import { test } from '@playwright/test';\nimport { installWorld } from './support/harness.js';\ntest('x', async ({ page }) => { const net = await installWorld(page, {}); expect(net).toBeTruthy(); expect(1).toBe(1); });" }, journeyReq).ok === false);
  ok('(c2) an e2e spec that invents its own backend (no harness) is rejected',
    evaluateE2ESpec({ code: "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); await expect(page.getByText('a')).toBeVisible(); await expect(page.getByText('b')).toBeVisible(); });" }, journeyReq).ok === false);
  ok('(c2) an e2e spec reaching the REAL supabase project is rejected',
    evaluateE2ESpec({ code: goodE2E.code.replace('./support/world.js', './support/world.js') + "\n// https://abc.supabase.co\n" }, journeyReq).ok === false);
  ok('(c2) a vacuous `|| true` e2e spec is rejected',
    evaluateE2ESpec({ code: goodE2E.code + '\n// x || true\n' }, journeyReq).ok === false);

  // The builder may NEVER edit the exam — neither the grep suite nor the journeys.
  const e2eEdit = evaluateBuild({ files: [{ path: 'e2e/search-results.spec.js', before: 'a\n', after: 'b\n' }] }, { onSpec: true, sensitiveReq: false });
  ok('(c2) an implementation patch that edits an e2e journey is DISCARDED (it cannot grade itself)',
    e2eEdit.mode === 'discard');
  const pwEdit = evaluateBuild({ files: [{ path: 'playwright.config.js', before: 'a\n', after: 'b\n' }] }, { onSpec: true, sensitiveReq: false });
  ok('(c2) an implementation patch that edits the e2e runner config is DISCARDED', pwEdit.mode === 'discard');

  // Honesty rail: with no browser present we make NO claim that the journey was proven.
  const noBrowser = decideE2ERed({ ran: false, pass: null });
  ok('(c2) no browser in the runner → proceed, but the journey is NOT claimed proven (SPEC-72)',
    noBrowser.proceed === true && noBrowser.proven === false && /NOT proven RED/i.test(noBrowser.note));
  ok('(c2) e2e journey GREEN on current code → ABORT (anti-vacuous, same law as qa.mjs)',
    decideE2ERed({ ran: true, pass: true }).proceed === false);
  ok('(c2) e2e journey RED on current code → proceed, and it IS proven',
    decideE2ERed({ ran: true, pass: false }).proceed === true && decideE2ERed({ ran: true, pass: false }).proven === true);

  // ── (d) REGRESSION → discard ────────────────────────────────────────────────
  const base2 = [{ id: 'auth', pass: true }, { id: 'address', pass: true }, { id: 'spec-p1-x', pass: false }];
  const after2 = [{ id: 'auth', pass: false }, { id: 'address', pass: true }, { id: 'spec-p1-x', pass: true }];
  ok('(d) an existing test that goes red → regression detected → discard',
    regressions(base2, after2, 'spec-p1-x').join(',') === 'auth');
  ok('(d) no regression when everything else stays green',
    regressions(base2, [{ id: 'auth', pass: true }, { id: 'address', pass: true }, { id: 'spec-p1-x', pass: true }], 'spec-p1-x').length === 0);
  // tamper: the builder tries to edit the test that grades it
  const tamper = evaluateBuild({ files: [{ path: 'scripts/qa.mjs', before: 'a', after: 'b' }] }, { onSpec: true, sensitiveReq: false });
  ok('(d) patch that edits the grading test → DISCARD', tamper.mode === 'discard' && tamper.reasons.some(r => /grading test/.test(r)));
  const ciTamper = evaluateBuild({ files: [{ path: '.github/workflows/ci.yml', before: 'a', after: 'b' }] }, { onSpec: true, sensitiveReq: false });
  ok('(d) patch that edits CI → DISCARD', ciTamper.mode === 'discard');
  const destructive = evaluateBuild({ files: [{ path: 'supabase/migrations/20260714000000_x.sql', before: '', after: 'drop table public.bookings;' }] }, { onSpec: true, sensitiveReq: false });
  ok('(d) destructive SQL → DISCARD', destructive.mode === 'discard');
  const outside = evaluateBuild({ files: [{ path: 'README.md', before: 'a', after: 'b' }] }, { onSpec: true, sensitiveReq: false });
  ok('(d) write outside the allowed roots → DISCARD', outside.mode === 'discard');

  // ── (e) CLEAN ON-SPEC REQUIREMENT → auto-merge + honest ledger flip ──────────
  const cleanReq = { id: 'p1-wave-numbers', status: 'captured', instruction: 'Rolling-wave dispatcher: 10 providers per wave, next wave at T+2 minutes, 60-minute cap, stop at 1 booking or 2 responses.', spec_ref: 'SPEC-71', suite: 'responses' };
  const cleanC = classifyRequirement(cleanReq);
  ok('(e) clean on-spec requirement is selectable + not sensitive', cleanC.selectable === true && cleanC.sensitive === false);
  const cleanBuild = evaluateBuild({ files: [{ path: 'src/lib/waves.js', before: '', after: 'export const WAVE_SIZE = 10;\nexport const T_PLUS_MINUTES = 2;\nexport const CAP_MINUTES = 60;\n' }] }, { onSpec: true, sensitiveReq: cleanC.sensitive });
  ok('(e) clean on-spec, small, non-UX build → AUTO-MERGE', cleanBuild.mode === 'auto' && cleanBuild.reasons.length === 0);
  const acts = ledgerActionsFor([{ id: 'spec-p1-wave-numbers', pass: true }, { id: 'spec-p2-other', pass: false, err: 'boom' }, { id: 'auth', pass: true }], 'abc1234def');
  ok('(e) ledger flips ONLY the green spec-test → verified (with evidence)',
    acts.length === 2 &&
    acts[0].action === 'verify' && acts[0].id === 'p1-wave-numbers' && /spec-p1-wave-numbers PASS @/.test(acts[0].evidence) && /abc1234/.test(acts[0].evidence) &&
    acts[1].action === 'reopen' && acts[1].id === 'p2-other');
  ok('(e) a non-spec test never touches the ledger', acts.every(a => a.id !== 'auth'));

  // ── harness plumbing ────────────────────────────────────────────────────────
  const fakeQa = "test('a','n','#1', async () => {});\n\nmain().catch(e => {\n  process.exit(2);\n});\n";
  const injected = injectTest(fakeQa, "test('spec-p1-x','n','REQ:p1-x', async () => { assert(1); });", 'p1-x');
  ok('injects the spec-test before the trailing main() call',
    injected && injected.indexOf("test('spec-p1-x'") < injected.indexOf('main().catch(') && /auto-build/.test(injected));
  ok('injection returns null when the anchor is missing', injectTest('const x = 1;\n', 'test()', 'p1-x') === null);
  ok('source tree is PATHS ONLY (never file contents)', sourceTree().every(p => /^(src|supabase\/functions)\//.test(p) && !p.includes('\n')));
  ok('real qa.mjs still has the injection anchor', readSafe('scripts/qa.mjs').includes('main().catch('));
  ok('ranking prefers the smallest non-sensitive requirement first', (() => {
    const ranked = rankRequirements([
      { id: 'big', status: 'captured', instruction: 'x'.repeat(400) },
      { id: 'pay', status: 'captured', instruction: 'stripe payout escrow' },
      { id: 'small', status: 'captured', instruction: 'short one' },
    ], '');
    return ranked[0].id === 'small' && ranked[ranked.length - 1].id === 'pay';
  })());
  ok('a requirement that already has a spec-test is not re-selected',
    rankRequirements([{ id: 'done', status: 'built', instruction: 'x' }], "test('spec-done', 'n', 'REQ:done'").length === 0);

  log(`\n${fail === 0 ? GRN + '✓ all ' + pass + ' build-rail self-checks pass' : RED + '✗ ' + fail + ' self-check(s) FAILED'}${RST}`);
  process.exit(fail === 0 ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER MODE — run on main AFTER a merge. Evidence-first: a requirement is
// verified iff its spec-derived acceptance test is GREEN on main, right now.
// ─────────────────────────────────────────────────────────────────────────────
async function runVerifyLedger() {
  const results = runQa();
  const sha = env.GITHUB_SHA || '';
  const actions = ledgerActionsFor(results, sha);
  const D = db();
  const done = [];
  for (const a of actions) {
    if (D) {
      if (a.action === 'verify') await D.rpc('cergio_verify_requirement', { p_id: a.id, p_evidence: a.evidence });
      else await D.rpc('cergio_reopen_requirement', { p_id: a.id, p_reason: a.reason });
    }
    done.push(a);
    log(`${a.action === 'verify' ? GRN + 'VERIFIED' : YEL + 'REOPENED'}${RST} ${a.id}`);
  }
  if (!D) log(`${YEL}no service key — ledger actions computed but NOT written${RST}`);
  console.log(JSON.stringify({ mode: 'verify-ledger', wrote: !!D, actions: done }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — build exactly ONE requirement.
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (SELF_CHECK) return runSelfCheck();
  if (VERIFY_LEDGER) return runVerifyLedger();

  const plan = {
    mode: 'none', requirement: null, spec_test: null, files: [],
    changed_lines: 0, reasons: [], abort: null, decomposed: [], branch: null,
  };

  if (!SUPA_URL || !SERVICE_KEY) {
    plan.abort = 'missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY';
    log(`${RED}${plan.abort}${RST}`);
    console.log(JSON.stringify(plan));
    process.exit(2);
  }
  const D = db();

  // 1) SELECT ONE requirement (never batch).
  const { data } = await D.select('requirements',
    '?status=in.(captured,built)&select=id,instruction,spec_ref,suite,status,source,evidence&order=opened_at');
  const open = Array.isArray(data) ? data : [];
  const qaSrc = readSafe('scripts/qa.mjs');
  const ranked = rankRequirements(open, qaSrc);
  log(`${GRY}open requirements: ${open.length}; buildable this run: ${ranked.length}${RST}`);

  const req = FORCE_REQ ? ranked.find(r => r.id === FORCE_REQ) : ranked[0];
  if (!req) {
    plan.abort = FORCE_REQ
      ? `requirement ${FORCE_REQ} is not buildable (verified, flagged for founder approval, or already has a spec-test)`
      : 'no buildable open requirement (all verified, flagged for founder approval, or already covered by a spec-test)';
    log(`${YEL}${plan.abort}${RST}`);
    console.log(JSON.stringify(plan));
    return;
  }
  plan.requirement = { id: req.id, status: req.status, spec_ref: req.spec_ref, sensitive: req._sensitive, instruction: req.instruction };
  log(`\n${YEL}▶ requirement ${req.id}${RST} ${GRY}(${req.status}, ${req.spec_ref || 'no spec ref'}${req._sensitive ? ', SENSITIVE → review-only' : ''})${RST}`);
  log(`${GRY}  ${String(req.instruction).slice(0, 160)}${RST}`);

  if (DRY) { plan.abort = 'dry run — selected only, no model call, no write'; console.log(JSON.stringify(plan)); return; }
  if (!ANTHROPIC_KEY) {
    plan.abort = 'ANTHROPIC_API_KEY not set';
    await openApproval(D, { req, title: `Build blocked: ${req.id}`, detail: 'auto-build could not run the model (no ANTHROPIC_API_KEY).' });
    console.log(JSON.stringify(plan));
    return;
  }

  const spec = specExcerpt(req);
  const testId = specTestId(req.id);

  // 2) SPEC-DERIVED ACCEPTANCE TEST FIRST — authored WITHOUT seeing any code.
  let cand;
  try { cand = await authorSpecTest({ req, spec, tree: sourceTree() }); }
  catch (e) {
    plan.abort = 'spec-test model error: ' + e.message;
    await openApproval(D, { req, title: `Build blocked: ${req.id}`, detail: plan.abort });
    log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }
  if (cand.onSpec !== true || !cand.code) {
    plan.abort = `spec is silent/ambiguous — no honest acceptance test can be derived: ${cand.note || '(no note)'}`;
    await openApproval(D, { req, title: `Spec gap: ${req.id} needs a founder decision`, detail: plan.abort });
    log(`${YEL}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }
  const testVerdict = evaluateSpecTest(cand, req);
  if (!testVerdict.ok) {
    plan.abort = `authored spec-test failed the anti-vacuity rails: ${testVerdict.reasons.join('; ')}`;
    await openApproval(D, { req, title: `Weak acceptance test: ${req.id}`, detail: plan.abort });
    log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }

  // Snapshot everything we may touch, so ANY abort restores the tree exactly.
  const snapshot = new Map();
  const remember = p => { if (!snapshot.has(p)) snapshot.set(p, exists(p) ? readSafe(p) : null); };
  const restoreAll = () => {
    for (const [p, body] of snapshot) {
      const full = path.join(REPO_ROOT, p);
      if (body == null) { try { fs.unlinkSync(full); } catch { /* never existed */ } }
      else fs.writeFileSync(full, body);
    }
  };

  // Inject + RUN. It MUST be RED.
  const baseline = runQa();
  log(`${GRY}baseline: ${baseline.filter(r => r.pass).length}/${baseline.length} green${RST}`);
  const injected = injectTest(qaSrc, cand.code, req.id);
  if (!injected) {
    plan.abort = 'could not inject the spec-test into scripts/qa.mjs (missing main() anchor)';
    log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }
  remember('scripts/qa.mjs');
  fs.writeFileSync(path.join(REPO_ROOT, 'scripts/qa.mjs'), injected);

  const syntax = spawnSync('node', ['--check', path.join(REPO_ROOT, 'scripts/qa.mjs')], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    restoreAll();
    plan.abort = 'authored spec-test does not parse: ' + String(syntax.stderr || '').slice(0, 200);
    await openApproval(D, { req, title: `Weak acceptance test: ${req.id}`, detail: plan.abort });
    log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }

  let afterInject;
  try { afterInject = runQa(); }
  catch (e) { restoreAll(); plan.abort = 'qa.mjs did not run with the spec-test injected: ' + e.message; log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return; }

  const red = decideRed(baseline, afterInject, testId);
  plan.spec_test = { id: testId, expected_red_reason: cand.expected_red_reason, red: red.proceed, target_paths: cand.target_paths || [] };

  // ── BEHAVIOURAL ACCEPTANCE (journey-shaped requirements only) ──────────────
  // The grep above proves the code has the right SHAPE. For a user journey that is
  // not enough — a stub with the right shape passes it. So we also ship a spec that
  // drives the real app and asserts on what the user SEES. It lives in e2e/, which
  // the implementer may never touch (PATH_DISCARD), and CI runs it on the PR.
  plan.e2e = null;
  if (isJourneyShaped(req)) {
    if (!cand.e2e || !cand.e2e.code) {
      // Not fatal — the qa.mjs RED gate still governs — but it MUST be visible that
      // the behavioural half is missing, or we quietly slide back to greps-only.
      plan.reasons.push('journey-shaped requirement but the author returned no e2e spec — behaviour is NOT covered, only code shape');
      log(`${YEL}journey-shaped requirement with no e2e spec — code shape only${RST}`);
    } else {
      const e2eVerdict = evaluateE2ESpec(cand.e2e, req);
      if (!e2eVerdict.ok) {
        restoreAll();
        plan.abort = `authored e2e spec failed the behavioural rails: ${e2eVerdict.reasons.join('; ')}`;
        await openApproval(D, { req, title: `Weak behavioural test: ${req.id}`, detail: plan.abort });
        log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
      }
      const e2ePath = e2eSpecPath(req.id);
      remember(e2ePath);
      fs.mkdirSync(path.dirname(path.join(REPO_ROOT, e2ePath)), { recursive: true });
      fs.writeFileSync(path.join(REPO_ROOT, e2ePath), String(cand.e2e.code).trim() + '\n');

      const e2eSyntax = spawnSync('node', ['--input-type=module', '--check'], {
        input: readSafe(e2ePath), encoding: 'utf8',
      });
      if (e2eSyntax.status !== 0) {
        restoreAll();
        plan.abort = 'authored e2e spec does not parse: ' + String(e2eSyntax.stderr || '').slice(0, 200);
        await openApproval(D, { req, title: `Weak behavioural test: ${req.id}`, detail: plan.abort });
        log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
      }

      // Same anti-vacuity law as qa.mjs: a journey that is GREEN before the feature
      // exists proves nothing. If there is no browser in this runner we say so
      // plainly (proven:false) rather than pretending the journey was checked.
      const e2eRun = runE2E(e2ePath);
      const e2eRed = decideE2ERed(e2eRun);
      plan.e2e = {
        path: e2ePath,
        expected_red_reason: cand.e2e.expected_red_reason || null,
        red_proven: e2eRed.proven === true && e2eRed.proceed === true,
        note: e2eRed.note || e2eRed.abort || null,
      };
      if (!e2eRed.proceed) {
        restoreAll();
        plan.abort = `E2E RED gate: ${e2eRed.abort}`;
        await openApproval(D, {
          req,
          title: `Behavioural test did not go RED: ${req.id}`,
          detail: `${e2eRed.abort} Nothing was written.`,
        });
        log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
      }
      log(`${GRY}e2e: ${plan.e2e.note}${RST}`);
    }
  }

  if (!red.proceed) {
    // ANTI-CIRCULARITY ABORT. A test that is green before the feature exists proves
    // nothing, and we will not build (or verify) on it. Revert, report, tell the founder.
    restoreAll();
    plan.abort = `RED gate: ${red.abort}`;
    await openApproval(D, {
      req,
      title: `Spec-test did not go RED: ${req.id}`,
      detail: `${red.abort} Either the requirement is already satisfied (then verify it deliberately) or the derived test is vacuous. No build was attempted, nothing was written.`,
    });
    log(`${RED}✗ ${plan.abort}${RST}`);
    console.log(JSON.stringify(plan));
    return;
  }
  log(`${GRN}✓ spec-test ${testId} is RED on current code${RST} ${GRY}(${String(red.redReason).slice(0, 120)})${RST}`);

  // 3) IMPLEMENT against the RED test.
  const targets = (cand.target_paths || []).map(rel).filter(pathAllowed).slice(0, MAX_BUILD_FILES);
  let patch;
  try {
    patch = await authorImplementation({
      req, spec, testCode: cand.code, redReason: red.redReason, targets,
      designSpec: readSafe('../design-spec.md') || readSafe('design-spec.md'),
    });
  } catch (e) {
    restoreAll();
    plan.abort = 'implementation model error: ' + e.message;
    await openApproval(D, { req, title: `Build failed: ${req.id}`, detail: plan.abort });
    log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }

  // Too big to ship in one gated slice → decompose into micro-requirements, build nothing.
  if (patch.tooLarge === true || (Array.isArray(patch.microRequirements) && patch.microRequirements.length && !(patch.files || []).length)) {
    restoreAll();
    const micros = (patch.microRequirements || []).slice(0, 8);
    for (const m of micros) {
      const id = String(m.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60);
      if (!id || !m.instruction) continue;
      await D.rpc('cergio_open_requirement', {
        p_id: `${req.id}--${id}`, p_instruction: String(m.instruction).slice(0, 500),
        p_spec_ref: m.spec_ref || req.spec_ref || null, p_suite: req.suite || null,
        p_source: 'build', p_status: 'captured',
      });
      plan.decomposed.push(`${req.id}--${id}`);
    }
    plan.abort = `requirement is too large for one gated build — decomposed into ${plan.decomposed.length} micro-requirement(s) for future runs`;
    await openApproval(D, { req, title: `Decomposed: ${req.id}`, detail: `${plan.abort}: ${plan.decomposed.join(', ')}` });
    log(`${YEL}${plan.abort}${RST}`);
    console.log(JSON.stringify(plan));
    return;
  }

  // HARD GATE on the patch itself.
  const verdict = evaluateBuild(patch, { onSpec: patch.onSpec, sensitiveReq: req._sensitive });
  plan.reasons = verdict.reasons;
  plan.changed_lines = verdict.totalChanged;
  if (verdict.mode === 'discard') {
    restoreAll();
    plan.abort = `patch discarded by the safety rails: ${verdict.reasons.join('; ')}`;
    await openApproval(D, { req, title: `Unsafe build discarded: ${req.id}`, detail: plan.abort });
    log(`${RED}${plan.abort}${RST}`); console.log(JSON.stringify(plan)); return;
  }

  // 4) WRITE + GATE: the spec-test must go GREEN and nothing may regress.
  for (const f of patch.files) {
    remember(f.path);
    const full = path.join(REPO_ROOT, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.after);
  }

  let afterBuild;
  try { afterBuild = runQa(); }
  catch (e) { afterBuild = null; plan.abort = 'qa.mjs crashed on the built code: ' + e.message; }

  const newGreen = !!afterBuild && (afterBuild.find(r => r.id === testId) || {}).pass === true;
  const regressed = afterBuild ? regressions(baseline, afterBuild, testId) : ['(qa crashed)'];

  if (!newGreen || regressed.length) {
    restoreAll(); // full revert — the branch never sees this code
    plan.abort = plan.abort || (!newGreen
      ? `the implementation did NOT make ${testId} green — discarded`
      : `regression: previously-green test(s) went red → discarded: ${regressed.join(', ')}`);
    plan.mode = 'discarded';
    await openApproval(D, { req, title: `Build discarded (gate red): ${req.id}`, detail: plan.abort });
    log(`${RED}✗ ${plan.abort}${RST}`);
    console.log(JSON.stringify(plan));
    return;
  }

  // GREEN. The files + the spec-test stay on disk for the workflow to branch/PR.
  plan.mode = verdict.mode; // 'auto' → auto-merge armed | 'review' → founder approval
  plan.files = patch.files.map(f => f.path);
  plan.summary = patch.summary || '';
  plan.branch = `auto-build/${req.id}-${Date.now().toString(36)}`.slice(0, 90);
  log(`${GRN}✓ ${testId} RED → GREEN, 0 regressions${RST} · ${verdict.totalChanged} changed lines · mode=${verdict.mode}`);

  if (verdict.mode === 'review') {
    await openApproval(D, {
      req,
      title: `FOUNDER APPROVAL — built, not merged: ${req.id}`,
      detail: `Branch ${plan.branch} builds ${req.id} (${patch.summary || ''}). Spec-test ${testId} went RED→GREEN, full qa.mjs green, 0 regressions. NOT auto-merged because: ${verdict.reasons.join('; ')}. Review + merge the PR to ship it.`,
    });
    log(`${YEL}→ founder approval: ${verdict.reasons.join('; ')}${RST}`);
  }

  console.log(JSON.stringify(plan));
}

main().catch(e => {
  log(`${RED}auto-build failed: ${e.message}${RST}`);
  console.log(JSON.stringify({ mode: 'none', abort: e.message, files: [] }));
  process.exit(1);
});
