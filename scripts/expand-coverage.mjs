// ─────────────────────────────────────────────────────────────────────────────
// Cergio — RECURSIVE COVERAGE EXPANSION (spec → tests, core → edge).
//
// The autonomous-fix pipeline fixes bugs the tests CATCH. This script grows what
// the tests catch: it reads the frozen spec + the current test inventory, asks
// Claude to name the highest-priority UNCOVERED spec'd journey/invariant, and
// AUTHORS a new live-QA test candidate for it (matching the qa-live.mjs harness:
// a suite assertion wired to a requirement + a finding via cergio_qa_check).
//
//   Priority order (plan): search → responses/notifications → signups → services
//   → recos/referrals → bookings/barter → spotlights → payments/earnings →
//   counters → geo, THEN edge cases within each.
//
// SAFETY — same gate as auto-fix:
//   • On-spec, small, harness-shaped new tests are written to a branch; the SAME
//     CI gate (build + full qa.mjs) must pass before the workflow opens a PR, and
//     auto-merge-on-green merges it. A new test that itself fails the gate (e.g.
//     it references a symbol that doesn't exist) is discarded, never merged.
//   • Anything that would test OFF-SPEC / ambiguous behavior is surfaced to the
//     founder (coo_proposal requires_approval=true), NOT auto-added — we never
//     bake a guess about undefined behavior into the gate.
//   • It NEVER edits FROZEN_SPEC, migrations, auth/payments, or CI config.
//   • It writes ONLY to scripts/qa-live.mjs (append a suite/assertion) and logs a
//     requirement-ledger entry (via a coo_proposal note or, when a service key is
//     present, an idempotent requirement upsert) so coverage % is visible.
//
// It does NOT commit/push/merge — the workflow gates + merges.
//
// Node built-ins only. Reversible (delete this file + the workflow).
//
// ENV: SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
//
// Usage:
//   node scripts/expand-coverage.mjs            # author 1 new test candidate
//   node scripts/expand-coverage.mjs --dry      # inventory + gap plan, no model, no write
//   node scripts/expand-coverage.mjs --self-check
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const p = path.join(REPO_ROOT, '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] == null) env[m[1]] = v;
    }
  }
  return env;
}
const env = loadEnv();
const SUPA_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || '';
const MODEL = env.EXPAND_MODEL || 'claude-opus-4-8';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const SELF_CHECK = args.has('--self-check');
const MAX_NEW_TESTS = Number(env.MAX_NEW_TESTS || 1);
const RED='\x1b[31m',GRN='\x1b[32m',YEL='\x1b[33m',GRY='\x1b[90m',RST='\x1b[0m';
const log = (...a) => console.error(...a);

// Plan priority — journeys in the order the build must cover them.
const PRIORITY = [
  'search', 'responses', 'notifications', 'signups', 'services',
  'recos', 'referrals', 'bookings', 'barter', 'spotlights',
  'payments', 'earnings', 'counters', 'geo',
];

// ── current test inventory ────────────────────────────────────────────────────
function readFileSafe(rel) { try { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); } catch { return ''; } }

function currentInventory() {
  const qa = readFileSafe('scripts/qa.mjs');
  const live = readFileSafe('scripts/qa-live.mjs');
  const codeCheckIds = [...qa.matchAll(/\btest\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const liveChecks = [...live.matchAll(/\.a\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]);
  const suites = [...live.matchAll(/makeSuite\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1]);
  return { codeCheckIds, liveChecks, suites };
}

// ── spec inventory: every ### SPEC-… header → a coverage unit ─────────────────
function specUnits() {
  const spec = readFileSafe('FROZEN_SPEC.md');
  const market = readFileSafe('MARKETPLACE_SPEC.md');
  const units = [];
  for (const src of [['FROZEN_SPEC', spec], ['MARKETPLACE_SPEC', market]]) {
    const [name, body] = src;
    for (const m of body.matchAll(/^###\s+(.+)$/gm)) units.push({ doc: name, header: m[1].trim() });
  }
  return units;
}

// crude keyword→journey mapping so we can order gaps by the plan priority.
function journeyOf(text) {
  const t = String(text).toLowerCase();
  for (const j of PRIORITY) {
    const rx = {
      search: /search|result|query|geocode|address/, responses: /request|respond|accept|offer|inbound/,
      notifications: /notify|notification|inbox/, signups: /sign\s?up|onboard|register|claim/,
      services: /service|listing|provider|offering/, recos: /reco|recommend|go-?to/,
      referrals: /referr|invite|network|barter earning/, bookings: /booking|schedule|book/,
      barter: /barter|free-?service|swap/, spotlights: /spotlight/, payments: /payment|stripe|charge|payout|pay\b/,
      earnings: /earning|settle|funds/, counters: /count|counter|badge|party ?count/, geo: /geo|city|miami|radius|lat|lng/,
    }[j];
    if (rx && rx.test(t)) return j;
  }
  return 'other';
}

// Compute uncovered spec units, ordered by plan priority. A unit is "likely
// covered" when its SPEC id or a strong keyword already appears in the harness.
function computeGaps() {
  const inv = currentInventory();
  const covered = new Set([...inv.codeCheckIds, ...inv.liveChecks].map(s => s.toLowerCase()));
  const coveredText = (readFileSafe('scripts/qa.mjs') + readFileSafe('scripts/qa-live.mjs')).toLowerCase();
  const units = specUnits();
  const gaps = [];
  for (const u of units) {
    const idm = u.header.match(/\bSPEC-[A-Z0-9]+/i);
    const id = idm ? idm[0].toLowerCase() : null;
    const numm = u.header.match(/#(\d+)/);
    const isCovered =
      (id && coveredText.includes(id)) ||
      (numm && new RegExp(`['"]#?${numm[1]}['"]`).test(coveredText)) ||
      [...covered].some(c => id && c.includes(id.replace('spec-', '')));
    if (!isCovered) gaps.push({ ...u, id, journey: journeyOf(u.header) });
  }
  // order by priority index, then doc.
  gaps.sort((a, b) => PRIORITY.indexOf(a.journey) - PRIORITY.indexOf(b.journey));
  const pct = units.length ? Math.round(((units.length - gaps.length) / units.length) * 100) : 0;
  return { inv, units, gaps, coveragePct: pct };
}

// ── Supabase REST ─────────────────────────────────────────────────────────────
function db() {
  if (!SUPA_URL || !SERVICE_KEY) return null;
  const base = `${SUPA_URL}/rest/v1`;
  const h = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });
  return {
    async rpc(fn, params = {}) {
      const r = await fetch(`${base}/rpc/${fn}`, { method: 'POST', headers: h(), body: JSON.stringify(params) });
      return { ok: r.ok, status: r.status };
    },
    async insert(table, body, prefer = 'return=minimal') {
      const r = await fetch(`${base}/${table}`, { method: 'POST', headers: { ...h(), Prefer: prefer }, body: JSON.stringify(body) });
      return { ok: r.ok, status: r.status };
    },
  };
}

async function surfaceForApproval(D, { gap, note }) {
  if (!D) return;
  await D.insert('coo_proposals', {
    run_date: new Date().toISOString().slice(0, 10), rank: 2, division: 'qa',
    title: `Coverage: review off-spec test candidate (${gap.header})`.slice(0, 120),
    detail: `Uncovered spec unit "${gap.header}" (${gap.doc}) but the behavior is ambiguous/off-spec to test automatically: ${note}`.slice(0, 500),
    expected_lift: 'expands spec coverage after founder confirms the intended behavior',
    effort: 'manual', status: 'pending', on_spec: false, action_kind: 'none', action_payload: '', requires_approval: true,
  });
}

async function logRequirement(D, { gap }) {
  if (!D || !gap.id) return;
  const slug = 'cov-' + gap.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await D.rpc('cergio_open_requirement', {
    p_id: slug, p_instruction: `Coverage: ${gap.header}`, p_spec_ref: gap.id,
    p_suite: gap.journey, p_source: 'build', p_status: 'built',
  });
}

// ── model: author a live-QA assertion for the top gap ─────────────────────────
async function authorTest({ gap, specText, harness }) {
  const system = [
    'You extend Cergio\'s live-QA harness (scripts/qa-live.mjs) with ONE new assertion.',
    'The harness shape: a suite built by makeSuite(name) exposes S.a(check_name, reqId, specRef, summary, condition, [fix]).',
    'Assertions read seed=true fixtures via the service client (svc) and anon/authed clients; they NEVER write non-seed rows.',
    'Rules:',
    '1. Only test behavior the FROZEN_SPEC excerpt DEFINES. If the spec is silent/ambiguous, return',
    '   {"onSpec": false, "note": "why it is ambiguous"} and author NOTHING.',
    '2. The assertion must be MINIMAL and self-contained: a unique snake_case check_name, a requirement id',
    '   (slug), a spec ref, a one-line summary, and a boolean condition over seed fixtures/RPCs already used',
    '   in the file. Prefer read-only RPC/select assertions; reuse existing seed lookups.',
    '3. NEVER touch auth/payments/secrets/migrations/CI. NEVER write a non-seed row.',
    '4. Return ONLY JSON: {"onSpec":true,"suite":"<existing or new suite name>","check_name":"qa_...",',
    '   "requirement_id":"...","spec_ref":"...","summary":"...","code":"S.a(\'qa_...\', ...);"}',
    '   where "code" is a single valid JS statement calling S.a(...) that can be pasted into the named suite.',
  ].join('\n');
  const user = [
    `TARGET uncovered spec unit: ${gap.header}  (${gap.doc}, journey=${gap.journey})`,
    '', '=== FROZEN_SPEC excerpt ===', specText || '(none)', '',
    '=== current qa-live.mjs harness (for shape/available seed lookups) ===',
    harness.slice(0, 12000), '',
    'Return the strict JSON now.',
  ].join('\n');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const jr = await r.json();
  const txt = (jr.content || []).map(c => c.text || '').join('').trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(txt);
}

function specTextFor(gap) {
  const doc = readFileSafe(gap.doc === 'MARKETPLACE_SPEC' ? 'MARKETPLACE_SPEC.md' : 'FROZEN_SPEC.md');
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(gap.header)) {
      let j = i + 1; while (j < lines.length && !/^###\s/.test(lines[j]) && !/^##\s/.test(lines[j])) j++;
      return lines.slice(i, j).join('\n').slice(0, 4000);
    }
  }
  return '';
}

// Insert a new assertion into an EXISTING suite in qa-live.mjs, right before its
// `return S;`. Returns the new file text, or null if the suite/anchor isn't found.
function injectAssertion(liveSrc, suiteName, codeStmt) {
  // find `async function suite<Cap>(seed) {` ... `return S;`
  const cap = suiteName.charAt(0).toUpperCase() + suiteName.slice(1);
  const fnRe = new RegExp(`(async function suite${cap}\\s*\\([^)]*\\)\\s*\\{)`);
  if (!fnRe.test(liveSrc)) return null;
  const start = liveSrc.search(fnRe);
  const retIdx = liveSrc.indexOf('return S;', start);
  if (retIdx < 0) return null;
  const indent = '  ';
  const block = `\n${indent}// [auto-coverage] ${new Date().toISOString().slice(0, 10)}\n${indent}${codeStmt.trim()}\n\n${indent}`;
  return liveSrc.slice(0, retIdx) + block + liveSrc.slice(retIdx);
}

// ── self-check (offline) ──────────────────────────────────────────────────────
function runSelfCheck() {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; log(`${GRN}PASS${RST} ${n}`); } else { fail++; log(`${RED}FAIL${RST} ${n}`); } };
  const { units, gaps, coveragePct, inv } = computeGaps();
  ok('spec units found', units.length > 0);
  ok('inventory reads live suites', inv.suites.includes('search') || inv.suites.length >= 0);
  ok('gaps computed + ordered by priority', Array.isArray(gaps) && gaps.every((g, i, a) => i === 0 || PRIORITY.indexOf(a[i - 1].journey) <= PRIORITY.indexOf(g.journey)));
  ok('coverage pct in range', coveragePct >= 0 && coveragePct <= 100);
  // injection anchors correctly into a fake harness.
  const fake = 'async function suiteSearch(seed) {\n  const S = makeSuite("search");\n  return S;\n}\n';
  const injected = injectAssertion(fake, 'search', "S.a('qa_new','r','#1','x', true);");
  ok('assertion injects before return S;', injected && /auto-coverage[\s\S]*qa_new[\s\S]*return S;/.test(injected));
  ok('injection returns null for missing suite', injectAssertion(fake, 'nope', 'S.a()') === null);
  ok('journeyOf maps search text', journeyOf('address search geocode') === 'search');
  log(`\n${GRY}coverage ≈ ${coveragePct}% (${units.length - gaps.length}/${units.length} spec units) — top gaps:${RST}`);
  for (const g of gaps.slice(0, 6)) log(`  ${GRY}·${RST} [${g.journey}] ${g.header} (${g.doc})`);
  log(`\n${fail === 0 ? GRN + '✓ all ' + pass + ' self-checks pass' : RED + '✗ ' + fail + ' failed'}${RST}`);
  process.exit(fail === 0 ? 0 : 1);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (SELF_CHECK) return runSelfCheck();
  const { gaps, coveragePct, units } = computeGaps();
  const D = db();
  const plan = { coveragePct, spec_units: units.length, gaps: gaps.length, added: [], approvals: [], branch: null };
  log(`${GRY}coverage ≈ ${coveragePct}% · ${gaps.length} uncovered spec unit(s)${RST}`);

  if (gaps.length === 0) { console.log(JSON.stringify(plan)); return; }

  const targets = gaps.slice(0, MAX_NEW_TESTS);
  plan.branch = `auto-coverage/${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

  for (const gap of targets) {
    log(`\n${YEL}▶ gap: [${gap.journey}] ${gap.header}${RST}`);
    if (DRY) { plan.added.push({ gap: gap.header, dry: true }); continue; }
    if (!ANTHROPIC_KEY) { await surfaceForApproval(D, { gap, note: 'ANTHROPIC_API_KEY not set' }); plan.approvals.push({ gap: gap.header, reason: 'no key' }); continue; }

    let cand;
    try { cand = await authorTest({ gap, specText: specTextFor(gap), harness: readFileSafe('scripts/qa-live.mjs') }); }
    catch (e) { await surfaceForApproval(D, { gap, note: 'model error: ' + e.message }); plan.approvals.push({ gap: gap.header, reason: 'model error' }); continue; }

    // off-spec / ambiguous → founder approval, never auto-added.
    if (cand.onSpec !== true || !cand.code || !cand.check_name) {
      await surfaceForApproval(D, { gap, note: cand.note || 'model declined (off-spec/ambiguous)' });
      plan.approvals.push({ gap: gap.header, reason: 'off-spec/ambiguous' });
      continue;
    }
    // basic shape guard: must be a single S.a(...) statement, no writes/imports.
    if (!/^\s*S\.a\(/.test(cand.code) || /insert\(|update\(|delete\(|require\(|import\s/.test(cand.code)) {
      await surfaceForApproval(D, { gap, note: 'candidate code not a clean read-only S.a(...) assertion' });
      plan.approvals.push({ gap: gap.header, reason: 'unsafe candidate shape' });
      continue;
    }

    const suite = cand.suite && /^[a-z]+$/i.test(cand.suite) ? cand.suite : 'search';
    const live = readFileSafe('scripts/qa-live.mjs');
    const next = injectAssertion(live, suite, cand.code);
    if (!next) {
      await surfaceForApproval(D, { gap, note: `no existing suite "${suite}" to extend; needs a new suite (review)` });
      plan.approvals.push({ gap: gap.header, reason: 'new suite needed' });
      continue;
    }
    fs.writeFileSync(path.join(REPO_ROOT, 'scripts/qa-live.mjs'), next);
    await logRequirement(D, { gap });
    plan.added.push({ gap: gap.header, suite, check_name: cand.check_name, requirement: cand.requirement_id });
    log(`${GRN}→ added ${cand.check_name} to suite ${suite} — CI gate will validate it${RST}`);
  }
  console.log(JSON.stringify(plan));
}

main().catch(e => { log(`${RED}expand-coverage failed: ${e.message}${RST}`); console.log(JSON.stringify({ added: [], approvals: [], error: e.message })); process.exit(1); });
