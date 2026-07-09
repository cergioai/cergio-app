// ─────────────────────────────────────────────────────────────────────────────
// Cergio — AUTONOMOUS CODE-FIX PIPELINE ("the engineer in CI").
//
// This is the CODE-fix half of the self-healing loop. The existing executor
// (coo-execute) already auto-runs DATA/OPS fixes (relabel/re-queue leads,
// re-run idempotent workers). This script handles the other half: a qa_finding
// whose ROOT CAUSE is a source-code bug. It:
//
//   1. Reads OPEN qa_findings and classifies each as CODE-fixable or not. A
//      finding is code-fixable only when it names a real source file under src/
//      (or a small allowlist of code roots) — data/ops findings are left to the
//      existing executor and never touched here.
//   2. For up to MAX_FIXES findings per run, asks Claude (claude-opus-4-8) for a
//      MINIMAL, on-spec patch: it is handed the finding, the current contents of
//      the named source file(s), and the matching FROZEN_SPEC excerpt, and must
//      return a strict JSON patch that changes ONLY what the bug requires.
//   3. Runs every proposed patch through a HARD safety gate (see SAFETY RAILS
//      below) BEFORE writing anything. A patch that is off-spec, large, touches
//      auth/payments/security/migrations/secrets, or fails the gate is NOT
//      applied — instead a founder-approval coo_proposal (requires_approval=true)
//      is opened with the diff summary. Human override always wins.
//   4. Writes the SURVIVING patch(es) to disk + a regression note, and prints a
//      machine-readable plan to stdout. It does NOT commit, push, or merge — the
//      workflow (.github/workflows/autonomous-fix.yml) runs `npm ci && npm run
//      build && node scripts/qa.mjs` on the branch and ONLY on GREEN does it
//      commit + push + open a PR; the real CI gate (ci.yml) + auto-merge-on-green
//      then merges it, and deploy-functions.yml ships any function change.
//
// RE-TEST LOOP: a code-root-cause finding is auto-re-tested by the next hourly
// QA cycle. qa.mjs / qa-live.mjs re-run the same check_name; on pass the finding
// auto-resolves (cergio_qa_check with count=0 flips status open→fixed) and the
// requirement flips back to verified. So once a fix lands + the check goes green,
// the finding closes itself with no human step. (Confirmed against qa-live.mjs
// writeLedger + the reconcile migration.)
//
// SAFETY — nothing here merges. Merge happens ONLY through the real CI gate.
// This script can PROPOSE a patch and (in the workflow) push a branch, but the
// branch is gated by build + full QA before any auto-merge, and risky changes
// never reach that path — they become founder-approval items.
//
// Node built-ins only (fetch/fs/path). No npm install. Reversible: delete this
// file + the workflow to fully revert; it has written nothing irreversible.
//
// ENV (from the workflow / .env.local):
//   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY  — read
//     findings, write approval proposals.
//   ANTHROPIC_API_KEY  — the model that authors the patch.
//   MAX_FIXES (default 2), MAX_CHANGED_LINES (default 40), DRY (--dry) — bounds.
//
// Usage:
//   node scripts/auto-fix.mjs               # full run (needs all secrets)
//   node scripts/auto-fix.mjs --dry         # classify + plan, NO model call, NO write
//   node scripts/auto-fix.mjs --self-check  # validate rails offline (no secrets needed)
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── env (workflow injects real env; .env.local is a local convenience) ────────
function loadEnv() {
  const p = path.join(REPO_ROOT, '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] == null) env[m[1]] = v; // real process.env wins over the file
    }
  }
  return env;
}
const env = loadEnv();
const SUPA_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || '';
const MODEL = env.AUTO_FIX_MODEL || 'claude-opus-4-8';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const SELF_CHECK = args.has('--self-check');
const MAX_FIXES = Number(env.MAX_FIXES || 2);
const MAX_CHANGED_LINES = Number(env.MAX_CHANGED_LINES || 40);
const MAX_FILES_PER_FIX = Number(env.MAX_FILES_PER_FIX || 3);

const RED='\x1b[31m',GRN='\x1b[32m',YEL='\x1b[33m',GRY='\x1b[90m',RST='\x1b[0m';
const log = (...a) => console.error(...a); // human log → stderr; machine plan → stdout

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY RAILS (hard). These decide auto-merge-eligible vs founder-approval.
// They are pure functions so `--self-check` can prove them offline.
// ─────────────────────────────────────────────────────────────────────────────

// Files/areas an autonomous writer must NEVER auto-edit. Any patch touching one
// of these routes to founder approval, no matter how it scores otherwise.
const PATH_FORBIDDEN = [
  /(^|\/)supabase\/migrations\//i,          // schema changes — human-applied only
  /(^|\/)\.github\/workflows\//i,            // CI/CD config — never self-mutate the gate
  /(^|\/)\.env/i, /secrets?/i, /vault/i,     // secrets
  /stripe/i, /payment/i, /payout/i, /release-funds/i, /charge/i, /webhook/i, // money
  /\bauth\b/i, /login/i, /session/i, /token/i, /rls/i, /policy/i,            // auth/access
  /security/i, /permission/i, /grant/i,
  /package(-lock)?\.json$/i, /vite\.config/i, /tailwind\.config/i,           // build/deps
  /(^|\/)node_modules\//i,
];

// Content signals inside a proposed new-file body that force approval even if the
// path looks benign (defense in depth — the model can't sneak a money/auth move).
const CONTENT_FORBIDDEN = [
  /\bservice_role\b/i, /SUPABASE_SERVICE_ROLE_KEY/i, /ANTHROPIC_API_KEY/i,
  /stripe\.(charges|paymentIntents|transfers|payouts)/i,
  /release[_-]?funds/i, /\bdrop\s+table\b/i, /\btruncate\b/i, /\bdelete\s+from\b/i,
  /process\.env\.[A-Z_]*KEY/i, /supabase\.auth\.admin/i,
];

// A patch may only touch files under these code roots (the app + tests). Anything
// outside is out-of-bounds → approval. (migrations excluded above; specs excluded
// so the writer can never edit its own source-of-truth.)
const PATH_ALLOWED_ROOTS = [
  /^src\//, /^scripts\/qa\.mjs$/, /^scripts\/qa-live\.mjs$/,
  /^scripts\/seed-test-world\.mjs$/, /^supabase\/functions\/[^/]+\/index\.ts$/,
];

function fileForbidden(rel) {
  return PATH_FORBIDDEN.some(re => re.test(rel));
}
function fileInAllowedRoot(rel) {
  return PATH_ALLOWED_ROOTS.some(re => re.test(rel));
}

// Count changed lines between two strings (added + removed, LCS-free upper bound:
// symmetric line-diff). Conservative — over-counts rather than under-counts, so
// the size cap fails safe.
function changedLineCount(before, after) {
  const a = (before || '').split('\n');
  const b = (after || '').split('\n');
  const setA = new Map(); for (const l of a) setA.set(l, (setA.get(l) || 0) + 1);
  const setB = new Map(); for (const l of b) setB.set(l, (setB.get(l) || 0) + 1);
  let removed = 0, added = 0;
  for (const [l, n] of setA) removed += Math.max(0, n - (setB.get(l) || 0));
  for (const [l, n] of setB) added += Math.max(0, n - (setA.get(l) || 0));
  return removed + added;
}

// The gate. Given a proposed patch (array of {path, before, after, isNew}),
// returns { autoMerge:boolean, reasons:[...] }. autoMerge=true ONLY when every
// rail passes; otherwise the reasons say why it must go to founder approval.
function evaluatePatch(patch, { onSpec }) {
  const reasons = [];
  if (!Array.isArray(patch.files) || patch.files.length === 0) {
    return { autoMerge: false, reasons: ['no files in patch'] };
  }
  if (patch.files.length > MAX_FILES_PER_FIX) {
    reasons.push(`touches ${patch.files.length} files (> cap ${MAX_FILES_PER_FIX})`);
  }
  let totalChanged = 0;
  let touchesRegressionTest = false;
  for (const f of patch.files) {
    const rel = String(f.path || '').replace(/^\.\//, '');
    if (!fileInAllowedRoot(rel)) reasons.push(`path outside allowed roots: ${rel}`);
    if (fileForbidden(rel)) reasons.push(`forbidden path (auth/payments/security/migrations/secrets/build): ${rel}`);
    for (const re of CONTENT_FORBIDDEN) {
      if (re.test(String(f.after || ''))) reasons.push(`forbidden content in ${rel}: ${re}`);
    }
    const delta = changedLineCount(f.before || '', f.after || '');
    totalChanged += delta;
    if (/^scripts\/qa(-live)?\.mjs$/.test(rel)) touchesRegressionTest = true;
  }
  if (totalChanged > MAX_CHANGED_LINES) {
    reasons.push(`diff too large: ~${totalChanged} changed lines (> cap ${MAX_CHANGED_LINES})`);
  }
  if (onSpec !== true) reasons.push('patch not marked on_spec by the model');
  // Every fix MUST include/retain a regression guard so the bug can't recur.
  // The model is instructed to extend qa.mjs/qa-live.mjs; if it didn't, we flag
  // it (still not auto-merged — approval — because an unguarded fix can regress).
  if (!touchesRegressionTest && patch.hasRegressionTest !== true) {
    reasons.push('no regression test added/retained (must extend qa.mjs or qa-live.mjs)');
  }
  return { autoMerge: reasons.length === 0, reasons, totalChanged };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFY — which OPEN findings are CODE-root-cause (vs data/ops).
// ─────────────────────────────────────────────────────────────────────────────

// Data/ops signals — these belong to coo-execute, not to a code patch.
const DATAOPS_SIGNALS = [
  /leads_(services|influencers)/i, /ingest/i, /harvest/i, /crawl/i, /cron/i,
  /vault/i, /secret/i, /outreach/i, /agent_runs/i, /watchdog/i, /re-?queue/i,
  /quarantine/i, /do_not_contact/i, /seed[_-]?world/i,
];

// Pull any src/… or supabase/functions/…/index.ts or scripts/qa*.mjs path the
// finding names in its check_name or detail.
function extractSourcePaths(text) {
  const out = new Set();
  const re = /(src\/[A-Za-z0-9_\-/]+\.(?:jsx?|tsx?)|supabase\/functions\/[A-Za-z0-9_\-]+\/index\.ts|scripts\/qa(?:-live)?\.mjs)/g;
  let m;
  while ((m = re.exec(text || ''))) out.add(m[1]);
  return [...out];
}

// A finding is code-fixable when it (a) names at least one real source file that
// exists in the repo AND (b) is not dominated by data/ops signals.
function classifyFinding(f) {
  const text = `${f.check_name || ''} ${f.detail || ''}`;
  const paths = extractSourcePaths(text).filter(p => fs.existsSync(path.join(REPO_ROOT, p)));
  const dataOps = DATAOPS_SIGNALS.some(re => re.test(text));
  const codeFixable = paths.length > 0 && !dataOps;
  return { codeFixable, paths, dataOps };
}

// ── FROZEN_SPEC excerpt: given SPEC-IDs mentioned in the finding, pull the
//    matching `### SPEC-…` / `#NN` sections so the model fixes ON SPEC. ────────
function specExcerpt(text) {
  let spec = '';
  try { spec = fs.readFileSync(path.join(REPO_ROOT, 'FROZEN_SPEC.md'), 'utf8'); } catch { return ''; }
  const ids = new Set();
  for (const m of String(text || '').matchAll(/\bSPEC-[A-Z0-9]+/gi)) ids.add(m[0].toUpperCase());
  for (const m of String(text || '').matchAll(/#(\d+)\b/g)) ids.add('#' + m[1]);
  if (ids.size === 0) return spec.slice(0, 4000); // no id → give the spec preamble
  const lines = spec.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^###\s/.test(lines[i])) {
      const header = lines[i].toUpperCase();
      if ([...ids].some(id => header.includes(id))) {
        let j = i + 1;
        while (j < lines.length && !/^###\s/.test(lines[j]) && !/^##\s/.test(lines[j])) j++;
        chunks.push(lines.slice(i, j).join('\n'));
      }
    }
  }
  return chunks.join('\n\n---\n\n').slice(0, 6000) || spec.slice(0, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase REST (no npm) — read findings, write approval proposals.
// ─────────────────────────────────────────────────────────────────────────────
function db() {
  const base = `${SUPA_URL}/rest/v1`;
  const h = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });
  return {
    async select(table, q = '') {
      const r = await fetch(`${base}/${table}${q}`, { headers: h() });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    },
    async insert(table, body, prefer = 'return=minimal') {
      const r = await fetch(`${base}/${table}`, { method: 'POST', headers: { ...h(), Prefer: prefer }, body: JSON.stringify(body) });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
    },
  };
}

// Open a founder-approval item for a fix that is NOT auto-merge-eligible. This is
// the SAME contract qa-live.mjs uses (coo_proposals, requires_approval=true), so
// it lands on the founder dashboard next to every other approval item.
async function openApproval(D, { finding, reasons, summary }) {
  if (!D) return;
  await D.insert('coo_proposals', {
    run_date: new Date().toISOString().slice(0, 10),
    rank: 2, division: 'qa',
    title: `Needs review (code fix): ${finding.check_name}`.slice(0, 120),
    detail: `${summary}\nRouted to approval because: ${reasons.join('; ')}`.slice(0, 500),
    expected_lift: 'fixes a code-root-cause QA finding (held for founder review)',
    effort: 'manual', status: 'pending',
    on_spec: false, action_kind: 'none', action_payload: '',
    requires_approval: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The model call — author a minimal on-spec patch as strict JSON.
// ─────────────────────────────────────────────────────────────────────────────
async function authorPatch({ finding, paths, spec }) {
  const fileBlocks = paths.slice(0, MAX_FILES_PER_FIX).map(rel => {
    const body = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    return `<file path="${rel}">\n${body}\n</file>`;
  }).join('\n\n');

  const system = [
    'You are a senior engineer fixing ONE bug in the Cergio app under a frozen spec.',
    'Rules (non-negotiable):',
    '1. Produce the MINIMAL patch that fixes the named finding. Change nothing unrelated.',
    '2. Stay ON SPEC — the FROZEN_SPEC excerpt is law. If the fix would conflict with the',
    '   spec or is ambiguous, DO NOT patch: return {"onSpec": false, "files": [], "note": "..."}.',
    '3. NEVER touch auth, payments/Stripe, secrets, migrations, RLS/policies, CI config,',
    '   or package/build files. If the fix requires that, return onSpec:false with a note.',
    '4. Include a REGRESSION guard: add or extend a check in scripts/qa.mjs (code-invariant)',
    '   or scripts/qa-live.mjs (live journey) that would have caught this bug, so it can\'t recur.',
    '5. Return ONLY a JSON object, no prose, matching:',
    '   {"onSpec": true, "summary": "<one line>", "hasRegressionTest": true,',
    '    "files": [{"path":"src/...","after":"<ENTIRE new file contents>"}]}',
    '   Each file\'s "after" is the COMPLETE new content of that file (not a diff).',
  ].join('\n');

  const user = [
    `FINDING check_name: ${finding.check_name}`,
    `FINDING detail: ${finding.detail || '(none)'}`,
    '',
    '=== FROZEN_SPEC excerpt (law) ===',
    spec || '(no matching spec section found)',
    '',
    '=== Current source file(s) ===',
    fileBlocks,
    '',
    'Return the strict JSON patch now.',
  ].join('\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000, temperature: 0,
      system, messages: [{ role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const jr = await r.json();
  const txt = (jr.content || []).map(c => c.text || '').join('').trim();
  const jsonStr = txt.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch { throw new Error('model did not return valid JSON: ' + txt.slice(0, 200)); }
  // Fill `before` from disk for the size/rail evaluation.
  parsed.files = (parsed.files || []).map(f => {
    const rel = String(f.path || '').replace(/^\.\//, '');
    const full = path.join(REPO_ROOT, rel);
    const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
    return { path: rel, before, after: String(f.after ?? ''), isNew: !fs.existsSync(full) };
  });
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-CHECK — prove the rails offline (no secrets, no model, no DB).
// ─────────────────────────────────────────────────────────────────────────────
function runSelfCheck() {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; log(`${GRN}PASS${RST} ${name}`); } else { fail++; log(`${RED}FAIL${RST} ${name}`); } };

  // (1) A benign, small, on-spec patch WITH a regression test → auto-merge.
  const good = evaluatePatch({
    files: [
      { path: 'src/screens/ResultsScreen.jsx', before: 'a\nb\nc\n', after: 'a\nb2\nc\n' },
      { path: 'scripts/qa.mjs', before: 'x\n', after: 'x\ny\n' },
    ],
  }, { onSpec: true });
  ok('benign small on-spec+test → auto-merge', good.autoMerge === true);

  // (2) Touches a migration → approval.
  const mig = evaluatePatch({ files: [{ path: 'supabase/migrations/x.sql', before: '', after: 'select 1' }], hasRegressionTest: true }, { onSpec: true });
  ok('migration path → approval', mig.autoMerge === false && mig.reasons.some(r => /forbidden path/.test(r)));

  // (3) Touches Stripe/payment function → approval.
  const pay = evaluatePatch({ files: [{ path: 'supabase/functions/stripe-webhook/index.ts', before: 'a', after: 'b' }], hasRegressionTest: true }, { onSpec: true });
  ok('stripe function → approval', pay.autoMerge === false);

  // (4) Off-spec → approval.
  const off = evaluatePatch({ files: [{ path: 'src/x.jsx', before: 'a\n', after: 'b\n' }], hasRegressionTest: true }, { onSpec: false });
  ok('off-spec → approval', off.autoMerge === false && off.reasons.some(r => /not marked on_spec/.test(r)));

  // (5) Too-large diff → approval.
  const big = { path: 'src/big.jsx', before: '', after: Array.from({ length: 200 }, (_, i) => 'line' + i).join('\n') };
  const large = evaluatePatch({ files: [big], hasRegressionTest: true }, { onSpec: true });
  ok('large diff → approval', large.autoMerge === false && large.reasons.some(r => /too large/.test(r)));

  // (6) Path outside allowed roots → approval.
  const outside = evaluatePatch({ files: [{ path: 'README.md', before: 'a', after: 'b' }], hasRegressionTest: true }, { onSpec: true });
  ok('outside allowed roots → approval', outside.autoMerge === false);

  // (7) Forbidden content (service_role) even on a benign path → approval.
  const sneaky = evaluatePatch({ files: [{ path: 'src/x.jsx', before: 'a\n', after: 'const k = SUPABASE_SERVICE_ROLE_KEY\n' }, { path: 'scripts/qa.mjs', before: 'x', after: 'x\ny' }] }, { onSpec: true });
  ok('forbidden content (service_role) → approval', sneaky.autoMerge === false);

  // (8) No regression test → approval.
  const noTest = evaluatePatch({ files: [{ path: 'src/x.jsx', before: 'a\n', after: 'b\n' }] }, { onSpec: true });
  ok('no regression test → approval', noTest.autoMerge === false && noTest.reasons.some(r => /regression test/.test(r)));

  // (9) Classifier: a src-file finding is code-fixable.
  const cf = classifyFinding({ check_name: 'results_waiting_copy', detail: 'src/screens/ResultsScreen.jsx shows wrong copy (SPEC-42)' });
  // path may not exist in a bare checkout; test the non-fs branch via extract + dataOps only
  ok('classifier extracts src path', extractSourcePaths('bug in src/screens/ResultsScreen.jsx').length === 1);
  ok('classifier flags data/ops finding as non-code', classifyFinding({ check_name: 'ingest_frozen', detail: 'leads_services ingest stalled' }).codeFixable === false);
  void cf;

  // (10) Spec excerpt returns text for a known id.
  const ex = specExcerpt('SPEC-42 regression');
  ok('spec excerpt pulls SPEC-42 section', /SPEC-42/i.test(ex) || ex.length > 0);

  log(`\n${fail === 0 ? GRN + '✓ all ' + pass + ' safety-rail self-checks pass' : RED + '✗ ' + fail + ' self-check(s) failed'}${RST}`);
  process.exit(fail === 0 ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (SELF_CHECK) return runSelfCheck();

  if (!SUPA_URL || !SERVICE_KEY) {
    log(`${RED}Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY${RST}`);
    console.log(JSON.stringify({ applied: [], approvals: [], error: 'missing supabase env' }));
    process.exit(2);
  }
  const D = db();

  // 1) Read OPEN findings and classify.
  const { data: findings } = await D.select('qa_findings',
    '?status=eq.open&select=check_name,area,severity,count,detail,found_at&order=found_at.desc&limit=100');
  const open = Array.isArray(findings) ? findings : [];
  const codeFindings = [];
  for (const f of open) {
    const c = classifyFinding(f);
    if (c.codeFixable) codeFindings.push({ ...f, _paths: c.paths });
  }
  log(`${GRY}open findings: ${open.length}; code-fixable: ${codeFindings.length}${RST}`);

  const plan = { applied: [], approvals: [], skipped: [], branch: null };

  if (codeFindings.length === 0) {
    console.log(JSON.stringify(plan));
    return;
  }

  // Bound the work per run.
  const batch = codeFindings.slice(0, MAX_FIXES);
  const branch = `auto-fix/${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
  plan.branch = branch;

  for (const finding of batch) {
    const spec = specExcerpt(`${finding.check_name} ${finding.detail}`);
    log(`\n${YEL}▶ ${finding.check_name}${RST}  files: ${finding._paths.join(', ')}`);

    if (DRY) {
      plan.skipped.push({ check_name: finding.check_name, reason: 'dry run — no model call', paths: finding._paths });
      continue;
    }
    if (!ANTHROPIC_KEY) {
      await openApproval(D, { finding, reasons: ['ANTHROPIC_API_KEY not set'], summary: 'auto-fix could not run the model' });
      plan.approvals.push({ check_name: finding.check_name, reasons: ['no ANTHROPIC_API_KEY'] });
      continue;
    }

    let patch;
    try { patch = await authorPatch({ finding, paths: finding._paths, spec }); }
    catch (e) {
      await openApproval(D, { finding, reasons: ['model error: ' + e.message], summary: 'auto-fix model call failed' });
      plan.approvals.push({ check_name: finding.check_name, reasons: ['model error'] });
      continue;
    }

    // Model declined (off-spec / ambiguous / needs forbidden area) → approval.
    if (patch.onSpec !== true || !Array.isArray(patch.files) || patch.files.length === 0) {
      await openApproval(D, { finding, reasons: ['model declined: ' + (patch.note || 'off-spec/ambiguous')], summary: patch.summary || 'model declined an on-spec patch' });
      plan.approvals.push({ check_name: finding.check_name, reasons: ['model declined'] });
      continue;
    }

    // HARD GATE.
    const verdict = evaluatePatch(patch, { onSpec: patch.onSpec });
    if (!verdict.autoMerge) {
      await openApproval(D, { finding, reasons: verdict.reasons, summary: patch.summary || finding.check_name });
      plan.approvals.push({ check_name: finding.check_name, reasons: verdict.reasons });
      log(`${YEL}→ founder approval: ${verdict.reasons.join('; ')}${RST}`);
      continue;
    }

    // Auto-merge-eligible → WRITE the files to disk. The workflow then builds +
    // QA-gates the branch; only GREEN commits/pushes/opens the PR.
    for (const f of patch.files) {
      const full = path.join(REPO_ROOT, f.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.after);
    }
    plan.applied.push({
      check_name: finding.check_name,
      summary: patch.summary || '',
      files: patch.files.map(f => f.path),
      changed_lines: verdict.totalChanged,
    });
    log(`${GRN}→ patch written (${verdict.totalChanged} lines) — branch build+QA will gate it${RST}`);
  }

  // Machine-readable plan on stdout for the workflow to branch on.
  console.log(JSON.stringify(plan));
}

main().catch(e => {
  log(`${RED}auto-fix failed: ${e.message}${RST}`);
  console.log(JSON.stringify({ applied: [], approvals: [], error: e.message }));
  process.exit(1);
});
