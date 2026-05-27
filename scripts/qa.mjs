// Critical Flows test harness for Cergio.
//
// Runs every invariant from CRITICAL_FLOWS.md in <60s. Exit code 0
// if all pass, 1 if any fail. Designed to be the single source of
// truth that gates every push.
//
// Two kinds of tests are mixed here:
//   - LIVE: hit the real Supabase via the anon key + (optionally) PAT
//   - CODE: assert source-code invariants (greps, function imports,
//           shape of exported helpers)
//
// Live tests need .env.local with VITE_SUPABASE_URL +
// VITE_SUPABASE_ANON_KEY. SUPABASE_SERVICE_ROLE_KEY is optional and
// only used for tests that mutate auth state.
//
// Usage:
//   node scripts/qa.mjs
//   node scripts/qa.mjs --only=address,geo     # run a subset
//   node scripts/qa.mjs --json                  # machine-readable output
//
// No external deps — only Node built-ins (fetch, fs, path).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

// ─── env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(p)) return {};
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const env = loadEnv();
const SUPA_URL = env.VITE_SUPABASE_URL || '';
const ANON     = env.VITE_SUPABASE_ANON_KEY || '';

// ─── CLI args ────────────────────────────────────────────────────────────
const args = new Map(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const only = args.has('only') ? String(args.get('only')).split(',').map(s => s.trim()) : null;
const asJson = args.has('json');

// ─── tiny test runner ───────────────────────────────────────────────────
const RED   = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m', GRY = '\x1b[90m', RST = '\x1b[0m';
const tests = [];

function test(id, name, invariant, fn) {
  tests.push({ id, name, invariant, fn });
}

function readFile(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function fileGrep(rel, pattern) {
  return pattern.test(readFile(rel));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/** Remove comments + string literals from a JS/JSX file so greps test
 *  CODE not text-in-strings or in-line documentation. Not a full parser —
 *  enough to suppress the obvious false positives. */
function stripComments(src) {
  let out = src;
  // Block comments
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Triple-backtick template-literal blocks (rare in JSX)
  out = out.replace(/`[^`]*`/g, '""');
  return out;
}

/** Like stripComments but ALSO drops string literals so we can grep for
 *  banned tokens (e.g. 'coming soon' appearing only in actual code). */
function stripCommentsAndStrings(src) {
  let out = stripComments(src);
  // Single-quoted strings
  out = out.replace(/'(?:\\.|[^'\\])*'/g, "''");
  // Double-quoted strings
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return out;
}

// ─── INVARIANT #1: auth never leaves user in no-session orphan ──────────
test('auth', 'Sign-up wrapper handles no-session correctly', '#1', async () => {
  const src = readFile('src/hooks/useSession.js');
  assert(/signInWithPassword\s*\(\s*\{\s*email,\s*password\s*\}\s*\)/.test(src),
    'useSession.signUp must auto-attempt signInWithPassword when session is missing');
  assert(/needsEmailConfirm\s*:\s*true/.test(src),
    'useSession.signUp must return needsEmailConfirm:true when Supabase says email not confirmed');
  // And the AuthScreen must actually use it.
  const auth = readFile('src/screens/AuthScreen.jsx');
  assert(/needsEmailConfirm/.test(auth),
    'AuthScreen.submit must handle res.needsEmailConfirm — otherwise user is stuck');
});

// ─── INVARIANT #2: address never reverts on save ────────────────────────
test('address', 'Chat-where sync does NOT fight manual address edits', '#2', async () => {
  const src = readFile('src/screens/HomeScreen.jsx');
  assert(/lastChatWhereSyncedRef/.test(src),
    'HomeScreen must use lastChatWhereSyncedRef to track chat-where sync (prevents revert loop)');
  // The useEffect must NOT include locationText in its deps.
  const m = src.match(/lastChatWhereSyncedRef[\s\S]*?\}\,\s*\[([^\]]+)\]\s*\)/);
  assert(m, 'chat-where sync useEffect not found near lastChatWhereSyncedRef');
  assert(!/\blocationText\b/.test(m[1]),
    'chat-where sync useEffect MUST NOT have locationText in its deps — that causes the revert bug');
});

// ─── INVARIANT #3: title + share share a source ─────────────────────────
test('title-share', 'Results title prefers userNoun (originalQuery) over parser provider_type', '#3', async () => {
  const src = readFile('src/screens/ResultsScreen.jsx');
  // displayNoun must list userNoun BEFORE safeProviderType.
  const m = src.match(/displayNoun\s*=\s*\(([^)]+)\)/);
  assert(m, 'displayNoun assignment not found in ResultsScreen');
  const order = m[1];
  const uIdx = order.indexOf('userNoun');
  const pIdx = order.indexOf('safeProviderType');
  assert(uIdx >= 0 && pIdx >= 0, 'displayNoun must reference both userNoun and safeProviderType');
  assert(uIdx < pIdx, 'userNoun MUST come before safeProviderType in displayNoun fallback chain');
});

// ─── INVARIANT #4: notify-providers requires verified provider_type ─────
test('notify-safe', 'getProvidersForNotify enforces notifySafe + exact provider_type', '#4', async () => {
  const src = readFile('src/lib/api.js');
  assert(/export async function getProvidersForNotify/.test(src),
    'lib/api.js must export getProvidersForNotify — the only sanctioned fanout helper');
  assert(/notify_safe_false/.test(src),
    'getProvidersForNotify must block when notifySafe is false');
  assert(/no_verified_provider_type/.test(src),
    'getProvidersForNotify must block when verifiedProviderType is missing');
  // useChat must compute notifySafe.
  const chat = readFile('src/hooks/useChat.js');
  assert(/notifySafe\s*:/.test(chat),
    'useChat state must include notifySafe field');
  assert(/NOTIFY_SAFE_CONFIDENCE/.test(chat),
    'useChat must reference NOTIFY_SAFE_CONFIDENCE threshold');
});

// ─── INVARIANT #5: invite URL canonical format ──────────────────────────
test('invite-url', 'Invite URL is always ${origin}/?ref=<uuid> via buildInviteUrl', '#5', async () => {
  const ref = readFile('src/lib/referral.js');
  assert(/export function buildInviteUrl/.test(ref),
    'lib/referral.js must export buildInviteUrl');
  assert(/\$\{base\}\/\?ref=\$\{inviterId\}/.test(ref),
    'buildInviteUrl must produce `${base}/?ref=${inviterId}` exactly');
  // No file in src/ should use the literal "?invite?ref" in CODE (the old
  // broken format). Comments are fine — they're documenting the past bug.
  const allFiles = walkSync(path.join(REPO_ROOT, 'src'));
  const offenders = [];
  for (const f of allFiles) {
    if (!/\.(js|jsx|ts|tsx)$/.test(f)) continue;
    const content = stripComments(fs.readFileSync(f, 'utf8'));
    if (/\?invite\?ref/.test(content)) offenders.push(path.relative(REPO_ROOT, f));
  }
  assert(offenders.length === 0,
    `Found malformed invite URL "?invite?ref" in code (not comments) of: ${offenders.join(', ')}`);
});

// ─── INVARIANT #6: geo-filter strict, no nationwide spillover ───────────
test('geo-strict', 'listServices proximity branch returns empty when no local hits', '#6', async () => {
  const src = readFile('src/lib/api.js');
  // Locate the proximity branch — flexible: any block introduced by
  // `if (lat != null && lng != null)` and ending before the next `let q = supabase`.
  const start = src.indexOf('if (lat != null && lng != null)');
  assert(start > 0, 'proximity branch (if lat/lng) not found in listServices');
  const tail = src.slice(start);
  const nextBranch = tail.search(/\n\s*\/\/[^\n]*[Pp]lain branch|\n\s*let q\s*=\s*supabase/);
  const branch = nextBranch > 0 ? tail.slice(0, nextBranch) : tail.slice(0, 4000);
  // Must early-return [] on zero hits (CRITICAL_FLOWS.md #6).
  assert(/return\s*\{\s*data:\s*\[\]\s*,\s*error:\s*null\s*\}\s*;/.test(branch),
    'proximity branch MUST return data:[] on zero hits — no nationwide fallback');
  // Reverted-fallback language banned (CODE only — comments documenting
  // the past mistake are fine).
  const code = stripComments(branch);
  assert(!/nationwide/i.test(code),
    'proximity branch contains nationwide-fallback CODE — must be empty-on-zero');
});

// ─── INVARIANT #7: no "coming soon" on critical paths ───────────────────
// We grep the ORIGINAL source (comments included is ok — those don't run)
// but specifically look for "coming soon" inside a STRING LITERAL in the
// monetized / notification screens. A literal in code = a button that
// promises something and delivers a toast. A comment = documentation.
//
// Carve-outs (acknowledged shipping gaps, allowlisted by exact string):
//   - EarningsScreen "Cashing out — coming soon"
//     (Stripe Connect payout endpoint not wired yet; gated to provider-
//      side balances only; explicit ROADMAP entry below)
//
test('no-coming-soon', 'No "coming soon" placeholders on monetized / notification paths', '#7', async () => {
  // CERGIO-GUARD: this test catches THREE shapes — string literals
  // ('coming soon'), template literals (`foo coming soon ${x}`), AND
  // JSX text nodes (<p>coming soon</p>). All three render as a dead
  // button label on the user's screen, so all three are equally bad.
  // The original regex only caught quoted strings — the reviewer
  // (REVIEWER_PROMPT.md run, 2026-05-27) flagged this as a false
  // negative because a plain JSX text would slip through.
  //
  // Allowlist: exact full-line strings we've explicitly accepted as
  // shipping gaps. Each one needs a reason in the comment next to it.
  const ALLOWED_LINES = new Set([
    // Stripe payout endpoint not wired yet — provider-only surface,
    // gated to balances > $250; explicit roadmap entry.
    `onClick={() => showToast('Cashing out — coming soon')}`,
  ]);
  const critical = [
    'src/screens/ResultsScreen.jsx',
    'src/screens/InviteFriendPopupScreen.jsx',
    'src/screens/EarningsScreen.jsx',
    'src/screens/ServiceDetailProviderScreen.jsx',
    'src/screens/JobsInboxScreen.jsx',
    'src/screens/IntakeFormScreen.jsx',
  ];
  const offenders = [];
  for (const f of critical) {
    const full = path.join(REPO_ROOT, f);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8');
    const noComments = stripComments(content);
    // Match 'coming soon' ANYWHERE in non-comment content.
    if (!/coming soon/i.test(noComments)) continue;
    // Walk line by line so we can apply ALLOWED_LINES + report
    // useful line numbers for any unauthorized hits.
    const lines = noComments.split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      if (!/coming soon/i.test(line)) return;
      const trimmed = line.trim();
      if (ALLOWED_LINES.has(trimmed)) return;
      hits.push(`${i + 1}: ${trimmed.slice(0, 100)}`);
    });
    if (hits.length > 0) {
      offenders.push(`${f}\n      ${hits.join('\n      ')}`);
    }
  }
  assert(offenders.length === 0,
    `'coming soon' still present on critical paths:\n    ${offenders.join('\n    ')}`);
});

// ─── INVARIANT #8: lying 'Invite link copied!' toasts must be real ─────
// Every showToast that CLAIMS to have copied something must be
// preceded (within the same handler) by either:
//   - navigator.clipboard.writeText(...), OR
//   - a navigate() to a screen that handles the copy itself
// Otherwise the toast is a brand-killing lie.
test('copy-is-real', "'Invite link copied' toasts must actually copy", '#8', async () => {
  const allFiles = walkSync(path.join(REPO_ROOT, 'src'))
    .filter(f => /\.(js|jsx|ts|tsx)$/.test(f));
  const offenders = [];
  for (const f of allFiles) {
    const content = stripComments(fs.readFileSync(f, 'utf8'));
    // Find every showToast(...'copied'...) and check the surrounding
    // handler for a real copy or navigate.
    const re = /showToast\(\s*['"`][^'"`]*copied[^'"`]*['"`]/gi;
    let m;
    while ((m = re.exec(content)) !== null) {
      // Look 400 chars back for a real-write signal. Accept any of:
      // - clipboard.writeText (the direct call)
      // - navigator.share (native share sheet)
      // - navigate(...) (routes to a screen that handles copy itself)
      // - copyInvite() / copyLink() etc. (helper that wraps writeText)
      // - file.startsWith('src/hooks/') — useToast itself can fire this
      const win = content.slice(Math.max(0, m.index - 400), m.index);
      const hasReal =
        /clipboard\.writeText|navigator\.share\(|navigate\(|copyInvite\(|copyLink\(/.test(win);
      if (!hasReal) {
        offenders.push(`${path.relative(REPO_ROOT, f)}: ${m[0].slice(0, 60)}…`);
      }
    }
  }
  assert(offenders.length === 0,
    `'copied' toasts without real copy/share/navigate:\n    ${offenders.join('\n    ')}`);
});

// ─── INVARIANT #9: notifyUser must always carry inviter ref deep_link ───
// Every notifyUser({ recipient, data }) call must include data.deep_link
// pointing at buildInviteUrl OR a static branded URL. A notification
// without a tracked URL means the recipient lands on Cergio with no
// way to credit the inviter — the entire $250 economy breaks silently.
test('notify-has-deeplink', 'notifyUser calls always include data.deep_link', '#9', async () => {
  const allFiles = walkSync(path.join(REPO_ROOT, 'src'))
    .filter(f => /\.(js|jsx|ts|tsx)$/.test(f))
    // The helper DEFINITION lives in api.js — skip that file, only
    // check CALL SITES across screens / hooks.
    .filter(f => !f.endsWith('src/lib/api.js'));
  const offenders = [];
  for (const f of allFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (!/\bnotifyUser\(/.test(content)) continue;
    const re = /\bnotifyUser\(/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const body = content.slice(m.index, m.index + 1000);
      if (!/deep_link/.test(body)) {
        const lineNo = content.slice(0, m.index).split('\n').length;
        offenders.push(`${path.relative(REPO_ROOT, f)}:${lineNo} — missing data.deep_link`);
      }
    }
  }
  assert(offenders.length === 0,
    `notifyUser calls without data.deep_link:\n    ${offenders.join('\n    ')}`);
});

// ─── INVARIANT #10: useChat SERVICE_MAP free of bundle/coordinator ──────
// Local parser fallback must NOT map a single-service request to a
// bundle / coordinator / package phrase. That bug shipped once
// ("Spanish-speaking babysitter" → "Bundle coordinator") and we
// keep the regression test in to prevent it shipping twice.
test('service-map-no-bundles', 'useChat SERVICE_MAP values are concrete services, not bundles', '#10', async () => {
  const src = readFile('src/hooks/useChat.js');
  // Grab the SERVICE_MAP array body — anything between the const
  // declaration and the matching `];`.
  const m = src.match(/const SERVICE_MAP\s*=\s*\[([\s\S]+?)\n\];/);
  assert(m, 'SERVICE_MAP literal not found in useChat.js');
  const body = m[1];
  // Each entry is a pair: ['phrase', 'Display Name']. We only care
  // about the Display Name (second). Reject any "bundle|coordinator|
  // package" appearing there.
  const lines = body.split('\n');
  const offenders = [];
  for (const line of lines) {
    const pair = line.match(/\['([^']+)',\s*'([^']+)'\]/);
    if (!pair) continue;
    const display = pair[2];
    if (/\b(bundle|coordinator|package)\b/i.test(display)) {
      offenders.push(`'${pair[1]}' → '${display}'`);
    }
  }
  assert(offenders.length === 0,
    `SERVICE_MAP contains bundle-ish display values (regression risk):\n    ${offenders.join('\n    ')}`);
});

// ─── helper: file walk ──────────────────────────────────────────────────
function walkSync(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSync(full, out);
    else out.push(full);
  }
  return out;
}

// ─── run ────────────────────────────────────────────────────────────────
async function main() {
  if (!asJson) {
    console.log(`\n${GRY}Cergio critical-flows harness — ${tests.length} tests${RST}`);
    console.log(`${GRY}Repo: ${REPO_ROOT}${RST}\n`);
  }

  const results = [];
  for (const t of tests) {
    if (only && !only.includes(t.id)) continue;
    const t0 = Date.now();
    let pass = false, err = null;
    try { await t.fn(); pass = true; }
    catch (e) { err = e?.message || String(e); }
    const ms = Date.now() - t0;
    results.push({ id: t.id, name: t.name, invariant: t.invariant, pass, err, ms });
    if (!asJson) {
      const tag = pass ? `${GRN}PASS${RST}` : `${RED}FAIL${RST}`;
      console.log(`  ${tag}  ${t.invariant}  ${t.name}  ${GRY}(${ms}ms)${RST}`);
      if (!pass) console.log(`        ${YEL}${err}${RST}`);
    }
  }

  const failed = results.filter(r => !r.pass).length;
  const passed = results.length - failed;
  if (asJson) {
    console.log(JSON.stringify({ passed, failed, results }, null, 2));
  } else {
    console.log();
    if (failed === 0) {
      console.log(`${GRN}✓ All ${passed} flows pass.${RST}\n`);
    } else {
      console.log(`${RED}✗ ${failed} of ${results.length} flows failed.${RST}\n`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
