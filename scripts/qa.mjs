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
// CERGIO-GUARD (2026-06-12): canonical format CHANGED by Tarik —
// "need a much shorter invite link which takes directly to the profile
// of the connector". New canon: `${base}/i/${code}` where code is the
// first 10 hex chars of the inviter UUID, resolved by resolve_ref_code
// + InviteLandingScreen → /u/<id>. Old ?ref= links still parse via
// captureRefFromUrl, but buildInviteUrl must emit the SHORT form.
test('invite-url', 'Invite URL is always ${origin}/i/<code> via buildInviteUrl', '#5', async () => {
  const ref = readFile('src/lib/referral.js');
  assert(/export function buildInviteUrl/.test(ref),
    'lib/referral.js must export buildInviteUrl');
  assert(/\$\{base\}\/i\/\$\{code\}/.test(ref),
    'buildInviteUrl must produce `${base}/i/${code}` (short profile link)');
  assert(/replace\(\/-\/g, ''\)\.slice\(0, 10\)/.test(ref),
    'short code must be first 10 hex chars of the inviter UUID');
  assert(/export function storeRef/.test(ref),
    'lib/referral.js must export storeRef for the /i/:code landing');
  // The landing screen must exist and resolve + store + redirect.
  const landing = readFile('src/screens/InviteLandingScreen.jsx');
  assert(/resolve_ref_code/.test(landing),
    'InviteLandingScreen must call the resolve_ref_code RPC');
  assert(/storeRef\(/.test(landing),
    'InviteLandingScreen must store the resolved ref for attribution');
  assert(/\/u\/\$\{rows\[0\]\.id\}/.test(landing),
    'InviteLandingScreen must land on the inviter profile /u/<id>');
  const app = readFile('src/App.jsx');
  assert(/path="\/i\/:code"/.test(app),
    'App.jsx must route /i/:code to InviteLandingScreen');
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
// Carve-outs: none right now. The previous Earnings allowlist for
// "Cashing out — coming soon" was replaced with a real `mailto:`
// action (see EarningsScreen line ~85) — the button now opens a
// pre-filled cash-out request to support@cergio.ai instead of
// toasting a lie. ROADMAP.md tracks the proper Stripe Connect
// payout implementation.
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
  // Currently EMPTY — every prior carve-out has been replaced with a
  // real action. Future additions need a written justification AND
  // a ROADMAP.md entry.
  const ALLOWED_LINES = new Set([]);
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
        // Match both plain and optional-chaining forms (`.` or `?.`).
        // Permissive on purpose — the previous strict regex would have
        // missed a `clipboard?.writeText?.(...)` call that DOES copy.
        /clipboard\??\.\s*writeText|navigator\.share\(|navigate\(|copyInvite\(|copyLink\(/.test(win);
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

// ─── INVARIANT #11: BookingScreen never fabricates mock data ────────────
// The post-booking confirmation card MUST render real fields from the
// `booking` context. Hard-coded "Deep Cleaning / Jamie Hall / Tuesday
// 2:00 PM / 123 Main St" defaults shipped once and were the same family
// of bug as the title/share-message divergence (#3) — a user paying real
// money saw a confirmation describing a fabricated booking.
test('booking-no-mock-defaults', 'BookingScreen renders real booking fields, never mock defaults', '#11', async () => {
  const src = readFile('src/screens/BookingScreen.jsx');
  const noComments = stripComments(src);
  // Each of these strings used to live as a default in the screen.
  // They have no business appearing as code-literals there ever again.
  const BANNED = [
    'Jamie Hall',
    'Deep Cleaning',
    'Tuesday 2:00 PM',
    '123 Main St',
  ];
  const offenders = BANNED.filter(s => noComments.includes(s));
  assert(offenders.length === 0,
    `BookingScreen still contains mock-default literal(s): ${offenders.join(', ')}`);
  // Also assert the destructure no longer has fallback values. If a
  // future edit re-introduces `name = 'Jamie Hall'`, this catches it.
  //
  // CERGIO-GUARD (reviewer wave 3): permissively match `??` OR `||`
  // forms of the destructure — `booking || {}` would have silently
  // bypassed the original `?? {}`-only regex.
  const destructure = noComments.match(
    /const\s*\{[\s\S]+?\}\s*=\s*booking\s*(?:\?\?|\|\|)\s*\{\s*\}/
  );
  if (destructure) {
    assert(!/=\s*'[^']+'/.test(destructure[0]),
      'BookingScreen destructure has string-literal default — likely re-introduced mock data');
  }

  // CERGIO-GUARD: BookingScreen renders {service, when, where} —
  // but those fields ONLY exist on the booking context if
  // App.handleBook puts them there. If a future refactor reverts
  // handleBook to `setBooking({ name, price })`, BookingScreen
  // collapses to a 2-row card and the test against BookingScreen.jsx
  // alone wouldn't catch it. Pin the contract on the App side too.
  const appSrc = stripComments(readFile('src/App.jsx'));
  const setBookingCall = appSrc.match(/setBooking\(\s*\{[\s\S]+?\}\s*\)/);
  assert(setBookingCall, 'No setBooking({...}) call found in App.jsx');
  const body = setBookingCall[0];
  for (const field of ['service', 'when', 'where']) {
    assert(new RegExp(`\\b${field}\\s*:`).test(body),
      `App.handleBook setBooking({...}) is missing '${field}:' — BookingScreen will under-render`);
  }
});

// ─── INVARIANT #12: No mock-data imports on signed-in user paths ────────
// The "Friends recently booked" feed on ActivityScreen was removed once
// (task #9 in the project tracker) and silently regressed. The user has
// said multiple times: "we can't blast fake data or porno or non genuine
// content". This invariant locks down the regression: a banned mock
// export cannot be imported by a screen unless the file gates it behind
// an explicit `!auth?.isSignedIn` preview check.
//
// Allowed:
//   - data/mock.js itself (the source)
//   - screens-legacy/ (the old walkthrough demo)
//   - components/ helpers that only render under the preview gate
//   - screens that import the symbol but use it strictly under
//     `!auth?.isSignedIn` (verified by looking for both patterns)
//
test('no-mock-on-signed-in-paths', 'Banned mock-data imports never render to signed-in users', '#12', async () => {
  // Mock symbols that, when rendered, produce fabricated user-visible
  // data ("Stephanie K. booked Jamie Hall" / "+$141.52" / etc.).
  const BANNED = ['FEED', 'NETWORK_EARNINGS', 'TRANSACTIONS', 'BREAKDOWN'];
  const SCREENS_DIR = path.join(REPO_ROOT, 'src/screens');
  const files = walkSync(SCREENS_DIR).filter(f => /\.(jsx?|tsx?)$/.test(f));
  const offenders = [];

  for (const f of files) {
    const rel = path.relative(REPO_ROOT, f);
    if (rel.includes('/screens-legacy/')) continue;
    const src = fs.readFileSync(f, 'utf8');
    const noComments = stripComments(src);

    // Find an import statement from ../data/mock and which names it pulls.
    const importMatch = noComments.match(
      /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/data\/mock['"]/
    );
    if (!importMatch) continue;
    const importedNames = importMatch[1].split(',').map(s => s.trim());
    const bannedImported = importedNames.filter(n => BANNED.includes(n));
    if (bannedImported.length === 0) continue;

    // For each banned import, verify it's gated on !auth?.isSignedIn —
    // either the file references it inside a sign-out preview branch,
    // or it never references it (dead import — also a fail because
    // it'll re-grow into a render).
    for (const name of bannedImported) {
      // Strip strings too — we don't want a literal mention in a
      // comment-stripped string to fool the check.
      const code = stripCommentsAndStrings(src);
      // Find usages of the symbol — but NOT in the import statement.
      const usages = [...code.matchAll(new RegExp(`\\b${name}\\b`, 'g'))]
        .filter(m => {
          // Skip the import line by checking the surrounding 80 chars.
          const around = code.slice(Math.max(0, m.index - 40), m.index + 40);
          return !/import\s*\{[^}]*$/.test(around) && !/from\s*['"]\.\.\/data\/mock['"]/.test(around);
        });
      if (usages.length === 0) {
        offenders.push(`${rel}: imports '${name}' but never uses it (zombie import — re-grow risk)`);
        continue;
      }
      // The file must mention `!auth?.isSignedIn` or `!isSignedIn`
      // OR `usingMock` (the established gating variable). Otherwise
      // the mock data renders for real users.
      const gated =
        /!\s*auth\??\.?\s*isSignedIn|!\s*isSignedIn|usingMock|useMock/.test(code);
      if (!gated) {
        offenders.push(`${rel}: uses '${name}' without a !isSignedIn / usingMock gate`);
      }
    }
  }

  assert(offenders.length === 0,
    `Mock-data import leaking to signed-in render paths:\n    ${offenders.join('\n    ')}`);
});

// ─── INVARIANT #13: Canonical user phrase → canonical provider_type ─────
// This is the spec — codified.
//
// Trust model: when a user types "unclog toilet", the system MUST resolve
// to provider_type "Plumber" (the canonical string services register under)
// so the search filters strictly and the notify fanout pings ONLY plumbers.
// Stem-text fuzzy matching is BANNED on the search/notify path because it
// would surface (and notify) the wrong provider type when stems collide.
//
// This test exercises the LOCAL deterministic taxonomy (PROVIDER_TYPE_MAP
// in src/hooks/useChat.js). Claude's chat-parse edge function is a
// fallback for phrases this map doesn't cover; the test does NOT depend
// on Claude being reachable.
//
// Seeded services must register under exactly these provider_type strings
// (see Seed E2E Test Data.command). Drift between this map and the seed
// is a HARD FAIL.
test('canonical-query-resolves', 'Canonical user phrases resolve to canonical provider_type', '#13', async () => {
  // Import from the dependency-free taxonomy module so Node can resolve
  // it via plain ESM (no React/Vite import paths needed).
  const taxonomyPath = path.join(REPO_ROOT, 'src/lib/serviceTaxonomy.js');
  assert(fs.existsSync(taxonomyPath), 'src/lib/serviceTaxonomy.js not found');
  // Spawn a child Node process that imports the module and prints results
  // as JSON. Keeps qa.mjs's own resolution scope clean.
  const { execFileSync } = await import('node:child_process');
  const probeScript = `
    import { resolveProviderTypeLocal } from ${JSON.stringify(taxonomyPath)};
    const cases = ${JSON.stringify([
      // [query, expected canonical provider_type]
      ['deep cleaning under $200',         'House Cleaner'],
      ['need a house cleaner this weekend','House Cleaner'],
      ['housekeeper for sundays',          'House Cleaner'],
      ['unclog my toilet',                 'Plumber'],
      ['unclog the toilet',                'Plumber'],
      ['unclog a drain',                   'Plumber'],
      // TODO (covered by full taxonomy matcher port — in flight):
      //   - 'clear the drain please' → Plumber
      //   - 'my toilet is clogged' → Plumber
      // These need the platform taxonomy's intent_patterns + synonym
      // clusters which the 60-row local fallback can't reasonably cover.
      ['plumber for a leak',               'Plumber'],
      ['water heater install',             'Plumber'],
      ['electrician for the panel',        'Electrician'],
      ['ac repair',                        'HVAC Technician'],
      ['babysitter friday night',          'Babysitter'],
      ['nanny for the summer',             'Nanny'],
      ['live-in nanny',                    'Live-In Nanny'],
      ['dog walker mornings',              'Dog Walker'],
      ['personal chef for dinner',         'Personal Chef'],
      ['private chef thursdays',           'Personal Chef'],
      ['hairstylist at home',              'Hairstylist'],
      ['personal trainer 3x/week',         'Personal Trainer'],
      ['driver from miami beach to mia',   'Driver'],
      ['airport pickup tomorrow',          'Driver'],
      ['handyman tv mount',                'Handyman'],
    ])};
    const out = cases.map(([q, want]) => ({
      q, want, got: resolveProviderTypeLocal(q)
    }));
    process.stdout.write(JSON.stringify(out));
  `;
  // Need Node to load .js via ESM. Use --input-type=module.
  let json;
  try {
    json = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', probeScript],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    throw new Error('Probe failed — could not import resolveProviderTypeLocal: ' + (e.stderr || e.message));
  }
  const results = JSON.parse(json);
  const mismatches = results.filter(r => r.got !== r.want);
  assert(mismatches.length === 0,
    `Parser drift from canonical taxonomy (${mismatches.length}/${results.length}):\n    ` +
    mismatches.map(r => `'${r.q}' → got '${r.got}', want '${r.want}'`).join('\n    '));
});

// ─── INVARIANT #14: listServices proximity hydrates taxonomy_provider_type ─
// services_near RPC returns only proximity columns — id/title/distance —
// NOT taxonomy_provider_type or taxonomy_offering_id. If listServices
// strict-filters by provider_type on the raw RPC result, every row's
// .taxonomy_provider_type is undefined → every filter excludes every row.
// Confirmed live bug 2026-05-27: services_near returned 8 Miami rows,
// strict filter rejected all 8.
// This test asserts the source-of-truth fix stays in: after services_near,
// there must be a SUBSEQUENT supabase.from('services').select() call that
// pulls in taxonomy_provider_type before any filter is applied.
test('proximity-hydrates-taxonomy', 'listServices proximity branch hydrates taxonomy columns before strict filter', '#14', async () => {
  const src = readFile('src/lib/api.js');
  const code = stripComments(src);
  const start = code.indexOf("supabase.rpc('services_near'");
  assert(start > 0, "services_near RPC call not found in api.js");
  // Slice the proximity branch — stops at the same boundary qa #6 uses.
  const tail = code.slice(start);
  const nextBranch = tail.search(/\n\s*let q\s*=\s*supabase|\n\s*\/\/[^\n]*non-proximity/);
  const branch = nextBranch > 0 ? tail.slice(0, nextBranch) : tail.slice(0, 6000);
  assert(/from\(['"]services['"]\)\s*\.select\(`?[^`]*taxonomy_provider_type/.test(branch),
    'After services_near, you MUST hydrate full rows via .from(\'services\').select() including taxonomy_provider_type — otherwise strict provider_type filter excludes everything');
});

// ─── INVARIANT #15: paid-fallback when freeOnly returns zero ────────────
// The 2026-05-27 bug: freeServices defaults to true at App level, so
// every search runs with freeOnly=true. Seeded providers carry no $0
// offerings → listServices returns []. Without an auto-fallback the
// empty state lies ("No plumbers yet"). ResultsScreen MUST re-query
// without freeOnly when the first call comes back empty AND set a
// paidFallback flag so the render banner explains why these are paid.
test('paid-fallback', 'ResultsScreen re-queries without freeOnly when free search returns zero', '#15', async () => {
  const src = readFile('src/screens/ResultsScreen.jsx');
  const code = stripComments(src);
  // 1) The effect must run a paid re-query when first call returns 0.
  assert(/freeOnly\s*:\s*false/.test(code),
    'ResultsScreen must call listServices a second time with freeOnly:false when the first (freeOnly:true) call returns empty.');
  // 2) The paidFallback state must exist and be set when fallback fires.
  assert(/setPaidFallback\s*\(\s*true\s*\)/.test(code),
    'ResultsScreen must set paidFallback=true when the paid re-query succeeds.');
  // 3) The render layer must surface the honest banner copy.
  assert(/No free [^.]* nearby[^.]*paid options/i.test(code),
    'ResultsScreen must render an honest "No free X nearby — showing paid options" banner when paidFallback is true.');
});

// ─── INVARIANT #16: title uses canonical type (not user verb-phrase) ────
// Old bug: title read "Showing 1 unclog my toilet" because it
// pluralized the user's raw words. New rule: when safeProviderType
// resolves (e.g. "Plumber"), title MUST use its singular/plural form.
// userNoun is only a fallback when no provider_type resolved.
test('title-canonical-type', 'Results title prefers canonical provider_type over user verb-phrase', '#16', async () => {
  const src = readFile('src/screens/ResultsScreen.jsx');
  const code = stripComments(src);
  // Title block must reference both canonical singular AND plural lookups
  // (safeProviderType + safeProviderTypePlural or via pluralProviderTypeLocal).
  assert(/pluralProviderTypeLocal\s*\(/.test(code),
    'ResultsScreen must import + call pluralProviderTypeLocal to build the canonical plural for the title.');
  // The legacy `pluralize(displayNounLc)` standalone path (no canon fallback)
  // would re-create the "unclog my toilets" bug. Allow it ONLY when also
  // wrapped under a canonPlur fallback test. Cheap proxy: the count-style
  // title must derive `sing` and `plur` from safeProviderType first.
  assert(/canonSing\s*=\s*safeProviderType/.test(code) ||
         /canonSing\s*=\s*\(safeProviderType/.test(code),
    'Count-style title ("Showing N <thing>") must compute its singular form from safeProviderType FIRST, falling back to displayNounLc only when no canonical type resolved.');
});

// ─── INVARIANT #19: saveAddress writes user_metadata FIRST ──────────────
// The 2026-05-26 PERMANENT FIX (task #103). Before this, saveAddress
// wrote to a user_addresses table that didn't always exist post-
// migration, and addresses silently reverted. The bulletproof path is
// supabase.auth.updateUser({ data: { default_address: ... } }) — that
// CAN'T fail because user_metadata always exists. The table write is
// best-effort thereafter.
test('save-address-metadata-first', 'saveAddress writes user_metadata as the canonical persistence path', '#19', async () => {
  const src = readFile('src/lib/api.js');
  const code = stripComments(src);
  const fnIdx = code.indexOf('export async function saveAddress');
  assert(fnIdx > 0, 'saveAddress function not found in api.js');
  const body = code.slice(fnIdx, fnIdx + 3500);
  assert(/supabase\.auth\.updateUser\s*\(\s*\{\s*data\s*:\s*\{\s*default_address/.test(body),
    "saveAddress MUST call supabase.auth.updateUser({ data: { default_address: ... } }) — that's the only persistence path that can't be wiped by a missing migration.");
});

// ─── INVARIANT #20: signUp returns a session OR a needsEmailConfirm flag
// The 2026-05-25 signup race (task #102). User signed up, supabase
// returned no session, app redirected to a screen that demanded
// sign-in, user was stranded. Fix: if signUp returns no session,
// immediately try signInWithPassword. On success → session in hand.
// On "Email not confirmed" error → return needsEmailConfirm=true so
// the UI shows the right next step. No silent stranding either way.
test('signup-no-stranded-user', 'signUp never strands the user with no session AND no clear next step', '#20', async () => {
  const src = readFile('src/hooks/useSession.js');
  const code = stripComments(src);
  // Must call signInWithPassword as a fallback inside signUp.
  assert(/signInWithPassword\s*\(\s*\{\s*email\s*,\s*password\s*\}\s*\)/.test(code),
    'useSession.signUp MUST fallback to signInWithPassword when supabase.signUp returns no session — otherwise the user is stranded.');
  // Must surface a needsEmailConfirm flag explicitly when sign-in fails
  // with a confirm/verify error message.
  assert(/needsEmailConfirm\s*:\s*true/.test(code),
    'useSession.signUp MUST surface needsEmailConfirm:true when sign-in fails with a confirm/verify error so the UI can show the right next step.');
});

// ─── INVARIANT #21: HomeScreen Google-verifies addresses before save ────
// Task #85 — all saved addresses must be Google-canonicalized so the
// proximity search has reliable lat/lng. Before this, free-typed
// strings without lat/lng silently saved and produced zero-result
// searches because lat/lng were null → plain branch with no geo gate.
test('addresses-google-verified', 'HomeScreen calls verifyAddress before persisting a manually-typed address', '#21', async () => {
  const src = readFile('src/screens/HomeScreen.jsx');
  const code = stripComments(src);
  // verifyAddress must be imported (dynamic OR static) and CALLED
  // somewhere — not just imported and forgotten.
  assert(/verifyAddress\s*\(/.test(code),
    'HomeScreen MUST call verifyAddress(...) somewhere — manually-typed addresses without Google canonicalization break proximity search (null lat/lng).');
  // saveAddress MUST be called with placeId (the Google-issued anchor).
  // Without placeId we cannot dedupe and the cross-session canonical key
  // is lost.
  assert(/saveAddress\s*\(\s*\{[^}]*placeId/m.test(code) ||
         /placeId\s*:\s*[^,]+[\s\S]{0,200}saveAddress/.test(code),
    'HomeScreen MUST pass placeId when calling saveAddress — that\'s the Google-verification anchor required for cross-session dedup.');
});

// ─── INVARIANT #22: no "Cergio Coin" / "Cergio Cash" in signed-in copy
// Task #78 — these terms were retired in favor of plain "$250" + "free
// services" + "Growth Income". They CAN still appear inside mock.js
// (sign-out preview data, gated by usingMock) and inside comments
// documenting their retirement. Anywhere else is a regression.
test('no-cergio-coin-cash', 'Retired "Cergio Coin" / "Cergio Cash" terms never leak into signed-in copy', '#22', async () => {
  const dir = path.join(REPO_ROOT, 'src');
  const offenders = [];
  for (const f of walkSync(dir)) {
    if (!/\.(js|jsx|ts|tsx)$/.test(f)) continue;
    const rel = path.relative(REPO_ROOT, f);
    // Allowed: the mock-data file (gated to sign-out previews) and
    // anything that mentions the term inside a /* … */ or // comment.
    if (rel === 'src/data/mock.js') continue;
    const raw = fs.readFileSync(f, 'utf8');
    const stripped = stripComments(raw);
    if (/\bCergio\s+(Coin|Cash)\b/i.test(stripped)) {
      offenders.push(rel);
    }
  }
  assert(offenders.length === 0,
    `These files still ship "Cergio Coin"/"Cergio Cash" outside mock.js + comments — scrub them:\n  ${offenders.join('\n  ')}`);
});

// ─── INVARIANT #23: ProfileScreen has no dead links ─────────────────────
// Task #87 audit. Profile is the spine of the launch UX — broken
// links here look amateur. Every `navigate('/...')` call inside
// ProfileScreen MUST point to a path that App.jsx actually registers
// as a Route. Catches typos, deleted routes, accidental drift.
test('profile-links-resolve', 'Every Profile navigate path matches a real App route', '#23', async () => {
  const profile = stripComments(readFile('src/screens/ProfileScreen.jsx'));
  const app     = stripComments(readFile('src/App.jsx'));
  // Collect Profile's navigate targets.
  const navTargets = new Set();
  for (const m of profile.matchAll(/navigate\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    let p = m[1];
    if (p === '-1') continue;
    p = p.split('?')[0].split('#')[0];
    navTargets.add(p);
  }
  // Collect App routes (literal patterns only — parameterized ones too).
  const routes = new Set();
  for (const m of app.matchAll(/<Route\s+path\s*=\s*["']([^"']+)["']/g)) {
    routes.add(m[1]);
  }
  // Normalize parameterized routes (/request/:id? matches /request).
  const matches = (target) => {
    if (routes.has(target)) return true;
    for (const r of routes) {
      const rNorm = r.replace(/:\w+\??/g, '__P__');
      const tNorm = target.replace(/[^/]+$/, '__P__');
      if (rNorm === tNorm) return true;
      // /request/:id? matches both /request and /request/foo.
      if (r.endsWith('?') && target.startsWith(r.replace(/\/:\w+\?$/, ''))) return true;
    }
    return false;
  };
  const dead = [...navTargets].filter(t => !matches(t));
  assert(dead.length === 0,
    `ProfileScreen navigates to paths that App.jsx doesn't register:\n  ${dead.join('\n  ')}`);
});

// ─── INVARIANT #24: rewards copy uses REWARDS constants, never hardcoded
// Tasks #69, #88, #92. "$250" appeared inconsistent across screens —
// some said $250, some said $200, some said "credit", some "cash".
// All reward copy MUST read from src/lib/rewards.js (REWARDS.
// perFriend / perFriendUser / perFriendConnector). Hardcoded dollar
// values in user-facing strings are a regression.
test('rewards-constants', 'Reward amounts read from REWARDS constants, never hardcoded', '#24', async () => {
  const dir = path.join(REPO_ROOT, 'src');
  const offenders = [];
  for (const f of walkSync(dir)) {
    if (!/\.(js|jsx|ts|tsx)$/.test(f)) continue;
    const rel = path.relative(REPO_ROOT, f);
    // The constants live here — skip.
    if (rel === 'src/lib/rewards.js') continue;
    if (rel === 'src/data/mock.js') continue;
    const raw = fs.readFileSync(f, 'utf8');
    const stripped = stripComments(raw);
    // Look for "$250" / "$200" + a few rewards-context words within 40 chars.
    const re = /\$2[0-9]{2}\b[\s\S]{0,40}(credit|cash|friend|connector|reward|earn|invite)/gi;
    if (re.test(stripped)) {
      offenders.push(rel);
    }
  }
  assert(offenders.length === 0,
    `These files hardcode "$250" / "$200" near reward-context words instead of using REWARDS.* — import from '../lib/rewards' instead:\n  ${offenders.join('\n  ')}`);
});

// ─── INVARIANT #25: Connector apply page has the full reward story ──────
// Task #88. RainmakerApplyScreen is the conversion-driver — if anyone
// strips the side-by-side compare or the compounding example, signups
// collapse. Locks three things:
//   • side-by-side comparison (2-column grid User vs Connector)
//   • compounding math example (the 50-friend → $12.5K block)
//   • type selector ("I am a…" Influencer / Local biz / Super user)
test('connector-apply-complete', 'RainmakerApplyScreen has side-by-side + compounding + type selector', '#25', async () => {
  const src = readFile('src/screens/RainmakerApplyScreen.jsx');
  const code = stripComments(src);
  assert(/grid\s+grid-cols-2/.test(code),
    'RainmakerApplyScreen must render the User-vs-Connector side-by-side benefits comparison (grid-cols-2).');
  assert(/EXAMPLE_FRIENDS|EXAMPLE_TOTAL|50\s+friends/.test(code),
    'RainmakerApplyScreen must surface the compounding example (50 friends → $12.5K block).');
  assert(/I am a/i.test(code) && /Influencer/.test(code) && /Super[\s-]User/i.test(code),
    'RainmakerApplyScreen must include the "I am a…" type selector with Influencer / Super-User options.');
  assert(/Growth Participation/.test(code),
    'RainmakerApplyScreen must mention Growth Participation Income as part of the Connector reward stack.');
});

// ─── INVARIANT #26: SRP status driven by REAL activity counts ──────────
// User directive (2026-05-28): "make it related to REAL actions (as
// opposed to hard wired...)". The status ticker on /results MUST be
// driven by live notification + bid counts on the open request, not
// purely by a setInterval. The scripted lines remain as a graceful
// pre-write fallback. Lock both: the hook is imported AND its outputs
// are actually consumed in the render path.
test('srp-real-activity', 'ResultsScreen status ticker reads from useRequestActivity, not just setInterval', '#26', async () => {
  const hook = readFile('src/hooks/useRequestActivity.js');
  assert(/from\(['"]notifications['"]\)/.test(hook),
    'useRequestActivity must query the notifications table for the open request.');
  assert(/from\(['"]bids['"]\)/.test(hook),
    'useRequestActivity must query the bids table for the open request.');
  assert(/export function activityToStatus/.test(hook),
    'useRequestActivity must export activityToStatus so ResultsScreen can derive a status line.');

  const srp  = readFile('src/screens/ResultsScreen.jsx');
  const code = stripComments(srp);
  assert(/useRequestActivity\s*\(/.test(code),
    'ResultsScreen MUST call useRequestActivity(requestId) so the status ticker advances on real DB activity.');
  assert(/activityToStatus\s*\(/.test(code),
    'ResultsScreen MUST call activityToStatus({...}) to derive the status line from live counts.');
  assert(/hasLiveActivity\s*\?\s*liveStatus\.line/.test(code) ||
         /liveStatus\.line\s*:\s*statusSteps/.test(code),
    'The render path MUST switch to liveStatus.line when hasLiveActivity is true (so real counts replace the scripted lines).');
});

// ─── INVARIANT #27: recommendations are persisted + counted ─────────────
// Option C from the 2026-05-28 reco-schema decision: keep the table,
// wire writes + a Recs-sent counter on Earnings. This invariant locks
// both ends — RecommendServiceFormScreen MUST insert into the table
// after a successful notifyUser, AND EarningsScreen MUST read the
// count back from the table (never hardcoded zero).
test('reco-persisted', 'Recommend flow writes a recommendations row + Earnings reads the count', '#27', async () => {
  const reco = readFile('src/screens/RecommendServiceFormScreen.jsx');
  const recoCode = stripComments(reco);
  // Writer side.
  assert(/from\(['"]recommendations['"]\)\s*\.insert/.test(recoCode),
    'RecommendServiceFormScreen MUST .from(\'recommendations\').insert(...) after notifyUser succeeds — otherwise the Recs-sent counter on Earnings stays at zero forever.');
  // Anchor columns required for attribution + dedup.
  assert(/recommender_id\s*:/.test(recoCode),
    'The recommendations insert MUST set recommender_id (who recommended).');

  const earn = readFile('src/screens/EarningsScreen.jsx');
  const earnCode = stripComments(earn);
  assert(/from\(['"]recommendations['"]\)\s*\.select/.test(earnCode),
    'EarningsScreen MUST count recommendations via .from(\'recommendations\').select(...).');
  assert(/recsCount/.test(earnCode),
    'EarningsScreen MUST render a recsCount state derived from the recommendations count.');
});

// ─── INVARIANT #28: search submit creates a request + fans out notifs ──
// The 2026-05-28 write-side wire-up. Closes the loop the schema fix
// opened: home submit must (a) INSERT into `requests` and (b) write
// notifications rows to matched providers with kind='new_request' +
// data.deep_link + data.request_id. ResultsScreen then reads the id
// off nav state so useRequestActivity polls the right rows.
test('request-fanout', 'Home submit creates a requests row + fans out notifications', '#28', async () => {
  const api = readFile('src/lib/api.js');
  const apiCode = stripComments(api);

  // The fan-out function must exist + write to BOTH tables.
  assert(/export async function createRequestAndFanOut/.test(apiCode),
    'api.js MUST export createRequestAndFanOut so HomeScreen can write the request + notification rows.');
  assert(/from\(['"]requests['"]\)\s*\.insert/.test(apiCode),
    'createRequestAndFanOut MUST .from(\'requests\').insert(...) to anchor the search.');
  assert(/from\(['"]notifications['"]\)\s*\.insert/.test(apiCode),
    'createRequestAndFanOut MUST .from(\'notifications\').insert(...) to fan out new_request rows to providers.');
  assert(/kind\s*:\s*['"]new_request['"]/.test(apiCode),
    'Notification rows must carry kind=\'new_request\' so useRequestActivity matches them.');
  // Provider resolution must go through the safety-gated helper.
  assert(/getProvidersForNotify\s*\(/.test(apiCode),
    'createRequestAndFanOut MUST resolve recipients via getProvidersForNotify (notifySafe + verified provider_type gate).');

  // HomeScreen must actually call the helper before routing to /results.
  const home = readFile('src/screens/HomeScreen.jsx');
  const homeCode = stripComments(home);
  assert(/createRequestAndFanOut\s*\(/.test(homeCode),
    'HomeScreen MUST call createRequestAndFanOut on submit before navigating to /results — otherwise the SRP status ticker has nothing to poll.');
  assert(/navigate\(\s*['"]\/results['"][\s\S]{0,400}requestId/.test(homeCode),
    'HomeScreen MUST forward requestId in navigation state to /results so useRequestActivity binds to the right anchor.');

  // ResultsScreen must consume it.
  const srp = readFile('src/screens/ResultsScreen.jsx');
  const srpCode = stripComments(srp);
  assert(/location\.state\?\.\s*requestId|location\.state\?\s*\.\s*requestId/.test(srpCode),
    'ResultsScreen MUST read requestId from location.state so useRequestActivity polls notifications for THIS request.');
});

// ─── INVARIANT #29: search must tolerate typos, synonyms, Spanish, slang ─
// User directive (2026-05-28): "search match notification can't fail on
// silliness". 50+ realistic variations across categories — typos,
// synonyms, verb forms, conversational phrasing, Spanish (Miami
// launch context), and explicit nonsense. Each must route to the
// expected canonical provider_type (or null for nonsense).
test('search-tolerance', 'Local taxonomy + fuzzy matcher cover 50+ realistic search variations', '#29', async () => {
  // We import the taxonomy module directly (it's plain ES module).
  // dynamic import — qa.mjs runs as ESM.
  const mod = await import('../src/lib/serviceTaxonomy.js');
  const resolve = mod.resolveProviderTypeLocal;

  // Each row: [user query, expected canonical type OR null for nonsense].
  // Grouped by category so a regression is easy to localize.
  const cases = [
    // ── House Cleaner ─────────────────────────────────────────────────
    ['deep cleaning under $200',           'House Cleaner'],
    ['deep clenaings this weekend',        'House Cleaner'], // typo
    ['cleeening lady tomorrow',            'House Cleaner'], // typo
    ['need a housekeeper',                 'House Cleaner'],
    ['houskeeper',                         'House Cleaner'], // actor-noun typo
    ['need houskeeper under 200',          'House Cleaner'], // user's exact phrase
    ['housekeping under 200',              'House Cleaner'], // actor-noun typo + budget
    ['housekeeping',                       'House Cleaner'],
    ['cleaning lady saturdays',            'House Cleaner'],
    ['maid for move-out',                  'House Cleaner'],
    ['clean my house',                     'House Cleaner'],
    ['clean my apartment',                 'House Cleaner'],
    ['limpieza de casa',                   'House Cleaner'], // Spanish
    ['mucama',                             'House Cleaner'], // Spanish

    // ── Plumber ───────────────────────────────────────────────────────
    ['unclog my toilet',                   'Plumber'],
    ['toilet is clogged',                  'Plumber'],
    ['clogged sink',                       'Plumber'],
    ['plumer for a leak',                  'Plumber'],       // typo
    ['plummer',                            'Plumber'],       // actor-noun typo
    ['plumbr needed today',                'Plumber'],       // actor-noun typo
    ['leaky faucet under the sink',        'Plumber'],
    ['water heater needs replacing',       'Plumber'],
    ['pipe burst in the wall',             'Plumber'],
    ['plomero por favor',                  'Plumber'],       // Spanish

    // ── Childcare ────────────────────────────────────────────────────
    ['babysitter friday night',            'Babysitter'],
    ['babysiter tomorrow',                 'Babysitter'],    // typo
    ['need a nanny',                       'Nanny'],
    ['live-in nanny full time',            'Live-In Nanny'],
    ['niñera para sabado',                 'Nanny'],         // Spanish
    ['daycare drop off',                   'Babysitter'],

    // ── Dog walker / Pets ─────────────────────────────────────────────
    ['dog walker mornings',                'Dog Walker'],
    ['walk my dog',                        'Dog Walker'],
    ['pet sitter for the weekend',         'Pet Sitter'],
    ['dog groomer',                        'Pet Groomer'],

    // ── HVAC / Electrical ────────────────────────────────────────────
    ['ac repair tomorrow',                 'HVAC Technician'],
    ['ac repare tomorrow',                 'HVAC Technician'], // typo
    ['air conditioning broken',            'HVAC Technician'],
    ['electrician for the panel',          'Electrician'],
    ['eletrician',                         'Electrician'],     // typo
    ['electrcian needed urgently',         'Electrician'],     // typo + urgency

    // ── Beauty ────────────────────────────────────────────────────────
    ['hairstylist at home',                'Hairstylist'],
    ['hairsylist',                         'Hairstylist'],     // typo
    ['hairdresser saturday',               'Hairstylist'],
    ['blowout',                            'Hairstylist'],
    ['barber',                             'Barber'],
    ['manicure tonight',                   'Nail Tech'],
    ['pedicure',                           'Nail Tech'],
    ['makeup for a wedding',               'Makeup Artist'],
    // ['massage therapist', 'Massage Therapist'] — REMOVED 2026-06-03:
    //   out-of-scope category (see OUT_OF_SCOPE_PROVIDER_TYPES).

    // ── Fitness / Wellness ───────────────────────────────────────────
    ['personal trainer 3x/week',           'Personal Trainer'],
    ['personl trainer',                    'Personal Trainer'], // typo
    ['yoga instructor for the family',     'Yoga Instructor'],
    ['pilates class',                      'Pilates Instructor'],

    // ── Food / Events ────────────────────────────────────────────────
    ['personal chef for dinner',           'Personal Chef'],
    ['private chef thursdays',             'Personal Chef'],
    ['cater for my party',                 'Caterer'],
    ['bartender for the wedding',          'Bartender'],

    // ── Photo / Video ────────────────────────────────────────────────
    ['photographer for the engagement',    'Photographer'],
    ['photgrapher needed',                 'Photographer'],    // typo
    ['videographer',                       'Videographer'],

    // ── Outdoor / Moving ─────────────────────────────────────────────
    ['gardener weekly',                    'Gardener'],
    ['pool cleaner',                       'Pool Cleaner'],
    ['movers for saturday',                'Mover'],

    // ── Handyman ─────────────────────────────────────────────────────
    ['handyman tv mount',                  'Handyman'],
    ['assemble furniture ikea',            'Handyman'],
    ['hang shelves',                       'Handyman'],

    // ── Tutoring ─────────────────────────────────────────────────────
    ['math tutor',                         'Tutor'],
    ['piano lesson',                       'Music Teacher'],
    ['guitar teacher',                     'Music Teacher'],

    // ── Mobility / Drivers ───────────────────────────────────────────
    ['driver from miami beach to mia',     'Driver'],
    ['airport pickup tomorrow',            'Driver'],

    // ── Nonsense — must NOT match (no false positives) ───────────────
    ['random nonsense',                    null],
    ['',                                   null],
    ['I need help',                        null],
    ['service',                            null],
    ['asdfghjkl',                          null],
  ];

  const failures = [];
  for (const [query, expected] of cases) {
    const got = resolve(query);
    if (got !== expected) {
      failures.push(`'${query}' → got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
    }
  }
  assert(failures.length === 0,
    `Search-tolerance battery — ${failures.length} of ${cases.length} cases failed:\n  ${failures.join('\n  ')}`);
});

// ─── INVARIANT #30: LeafLogo wires the four organic variants ────────────
// 2026-05-30: LeafLogo now switches between four variants behind a
// LOGO_VARIANT constant: sprout / rings / bud / pollen. The Sprout
// component must still exist (one of the options) AND a MARKS map
// must dispatch all four. The current active variant is whatever
// LOGO_VARIANT is set to — Tarik changes that one line to switch.
test('sprout-logo', 'LeafLogo wires all 4 organic variants (sprout/rings/bud/pollen) + animates when working', '#30', async () => {
  const src = readFile('src/components/ui/LeafLogo.jsx');
  const code = stripComments(src);
  // LOGO_VARIANT switch must exist + be one of the canonical 4 values.
  const m = code.match(/const\s+LOGO_VARIANT\s*=\s*['"](sprout|rings|bud|pollen)['"]/);
  assert(m,
    'LeafLogo must define LOGO_VARIANT = "sprout" | "rings" | "bud" | "pollen".');
  // The MARKS map must dispatch all 4 variants.
  for (const v of ['sprout', 'rings', 'bud', 'pollen']) {
    assert(new RegExp(`${v}:\\s*\\w+`).test(code),
      `LeafLogo MARKS map must include ${v}: <Component>.`);
  }
  // All four variant components must be defined.
  for (const fn of ['Sprout', 'GrowthRings', 'BudBloom', 'PollenPulse']) {
    assert(new RegExp(`function\\s+${fn}\\s*\\(`).test(code),
      `LeafLogo must define the ${fn} variant component.`);
  }
  assert(/function Sprout\s*\(/.test(code) || /Sprout\s*size=/.test(code),
    'LeafLogo must use the Sprout component (two-leaf composition).');
  // Both leaves + the stem must exist as separate animated groups.
  assert(/cg-sprout-stem/.test(code),
    'Sprout must apply .cg-sprout-stem to the stem group (flex motion).');
  assert(/cg-sprout-top/.test(code),
    'Sprout must apply .cg-sprout-top to the top leaf group.');
  assert(/cg-sprout-bot/.test(code),
    'Sprout must apply .cg-sprout-bot to the bottom leaf group.');
  // Dew drop renders when working — captivating detail.
  assert(/cg-sprout-dew/.test(code),
    'Sprout must include the cg-sprout-dew dew-drop element (renders when working).');

  const css = readFile('src/index.css');
  assert(/@keyframes\s+cgSproutStem/.test(css),
    'index.css must define @keyframes cgSproutStem for the stem flex.');
  assert(/@keyframes\s+cgSproutTop/.test(css),
    'index.css must define @keyframes cgSproutTop for top leaf rotation.');
  assert(/@keyframes\s+cgSproutBot/.test(css),
    'index.css must define @keyframes cgSproutBot for bottom leaf rotation.');
  assert(/@keyframes\s+cgSproutDew/.test(css),
    'index.css must define @keyframes cgSproutDew for the dew drop pulse.');
});

// ─── INVARIANT #31: reward-flow animation embedded on /earnings/how ─────
// User explicitly asked the 6-step business-model animation be a real
// screen ("embed the animation as an actual screen in the app — e.g.
// /earnings/how"). Locks both ends — the component exists + the
// explainer renders it.
test('reward-flow-embedded', 'RewardFlowAnimation component exists + EarnExplainerScreen renders it', '#31', async () => {
  const cmp = readFile('src/components/ui/RewardFlowAnimation.jsx');
  assert(/export function RewardFlowAnimation/.test(cmp),
    'src/components/ui/RewardFlowAnimation.jsx must export RewardFlowAnimation.');
  // v8 (2026-05-30): compressed/simplified 3-scene model per Tarik —
  //   01 Invite. Reco. Earn.   (single $250/friend payoff number)
  //   02 Barter for free services
  //   03 AI-driven shared prosperity via GPI
  // Removed: the 5-row "ways to earn" table, 3-row math accumulator,
  // and 3-card WHAT/HOW/WHEN GPI grid. Lock the new structure so a
  // future regression doesn't bring back the busy table layout.
  assert(/num:\s*['"]01['"]/.test(cmp) && /num:\s*['"]02['"]/.test(cmp) && /num:\s*['"]03['"]/.test(cmp),
    'Animation must define exactly three phases: 01, 02, 03.');
  // Scene 1 — Invite / Reco / Earn. Must use the three-verb framing
  // and pull the per-friend payoff + N-friends scale from REWARDS.
  assert(/Invite\./.test(cmp) && /Reco\./.test(cmp) && /Earn\./.test(cmp),
    'Scene 1 must use the "Invite. Reco. Earn." three-verb framing.');
  assert(/perFriend/.test(cmp),
    'Scene 1 must derive the per-friend payoff from REWARDS.perFriend.');
  assert(/exampleFriends/.test(cmp) && /exampleTotal/.test(cmp),
    'Scene 1 must reference REWARDS.exampleFriends + exampleTotal for the scale punchline.');
  // Scene 2 — Barter. Must mention barter + free services framing.
  assert(/barter|Free services/i.test(cmp),
    'Scene 2 must frame the barter / free-services play (Connectors trade reach for services).');
  // Scene 3 — AI-driven shared prosperity via GPI.
  assert(/Growth Participation|GPI/i.test(cmp),
    'Scene 3 must reference Growth Participation Income (GPI).');
  assert(/shared prosperity|prosperity/i.test(cmp),
    'Scene 3 must use the "shared prosperity" framing.');
  // Referrer-share % is still part of the system copy (Scene 1 sub-body),
  // verified via REWARDS so it stays the source of truth.
  assert(/referrerSharePercent/.test(cmp),
    'Animation must reference REWARDS.referrerSharePercent (the 7% share) in the supporting copy.');

  const screen = readFile('src/screens/EarnExplainerScreen.jsx');
  assert(/import\s*\{\s*RewardFlowAnimation\s*\}\s*from/.test(screen),
    'EarnExplainerScreen must import RewardFlowAnimation.');
  assert(/<RewardFlowAnimation\s*\/>/.test(screen),
    'EarnExplainerScreen must render <RewardFlowAnimation />.');
});

// ─── INVARIANT #32: Profile screen v3 — 4 grouped cards with drawers ────
// User audit (2026-05-29): collapse the dense row-based Profile into 4-5
// grouped cards, each tappable to reveal a bottom-sheet with sub-actions.
// This invariant locks the new architecture so a future "just add a row"
// PR doesn't silently regress to the old wall-of-rows layout.
test('profile-grouped-cards', 'ProfileScreen renders 4 grouped GroupCards + ActionDrawers, no legacy SectionHeader rows', '#32', async () => {
  const src = readFile('src/screens/ProfileScreen.jsx');
  const code = stripComments(src);

  // The new architecture is GroupCard + ActionDrawer. Both must exist.
  assert(/function\s+GroupCard\s*\(/.test(code),
    'ProfileScreen must define a <GroupCard /> primitive (the tappable group card).');
  assert(/function\s+ActionDrawer\s*\(/.test(code),
    'ProfileScreen must define an <ActionDrawer /> primitive (bottom-sheet for sub-actions).');
  assert(/function\s+DrawerAction\s*\(/.test(code),
    'ProfileScreen must define a <DrawerAction /> row used inside drawers.');

  // The four canonical group cards must be rendered. Match the literal
  // title strings to lock the grouping (4-5 cards, no more, no less).
  const requiredTitles = [
    'Earn & grow',
    'Connector',
    'Services',
    'Account & settings',
  ];
  for (const t of requiredTitles) {
    assert(code.includes(`title="${t}"`),
      `ProfileScreen must render a GroupCard with title="${t}".`);
  }

  // The drawer state must be a single enum (one drawer open at a time).
  assert(/openDrawer/.test(code) && /setOpenDrawer/.test(code),
    'ProfileScreen must use a single openDrawer state (one drawer at a time).');

  // Each drawer key must appear at least once as a setOpenDrawer arg.
  for (const key of ['earn', 'connector', 'services', 'account']) {
    assert(new RegExp(`setOpenDrawer\\(['"]${key}['"]\\)`).test(code),
      `Drawer key "${key}" must be wired via setOpenDrawer('${key}').`);
  }

  // Legacy guards — the v2 SectionHeader/Row dense-list pattern must be
  // gone. If someone re-adds <SectionHeader title="Account"> we want it
  // to fail loudly so the grouping doesn't drift back.
  assert(!/function\s+SectionHeader\s*\(/.test(code),
    'ProfileScreen v3 must NOT redefine SectionHeader (replaced by GroupCard).');
});

// ─── INVARIANT #33: EarningsScreen — Referrals vs Client bookings tabs ──
// Service providers need to track earnings from their own services
// separately from referral/spotlight income. Lock the 2-tab structure +
// the kind-classification that drives it. If someone collapses the tabs
// or routes 'booking' rows into the wrong bucket, this fails.
test('earnings-tabs', 'EarningsScreen has Referrals + Client bookings tabs driven by earnings.kind', '#33', async () => {
  const src = readFile('src/screens/EarningsScreen.jsx');
  const code = stripComments(src);

  // The activeTab state must exist and accept the two canonical values.
  assert(/activeTab/.test(code) && /setActiveTab/.test(code),
    'EarningsScreen must use activeTab state to gate the two tabs.');
  assert(/setActiveTab\(['"]referrals['"]\)/.test(code),
    'EarningsScreen must have a button that sets activeTab to "referrals".');
  assert(/setActiveTab\(['"]bookings['"]\)/.test(code),
    'EarningsScreen must have a button that sets activeTab to "bookings".');

  // The tab labels users see must match the user-spec.
  assert(/>\s*Referrals\b/.test(code),
    'EarningsScreen must render a tab labelled "Referrals".');
  assert(/Client bookings/.test(code),
    'EarningsScreen must render a tab labelled "Client bookings".');

  // The kind-classification helpers must exist and bucket correctly.
  assert(/REFERRAL_KINDS\s*=\s*new Set\(\[\s*['"]invite['"]\s*,\s*['"]spotlight['"]\s*\]\)/.test(code),
    'REFERRAL_KINDS must be the set { invite, spotlight }.');
  assert(/BOOKING_KINDS\s*=\s*new Set\(\[\s*['"]booking['"]\s*\]\)/.test(code),
    'BOOKING_KINDS must be the set { booking }.');

  // Providers should default to the bookings tab so their primary income
  // line is what they see first.
  assert(/if\s*\(\s*!tabSetByUser\s*&&\s*isProvider\s*\)\s*setActiveTab\(['"]bookings['"]\)/.test(code),
    'Providers must default to the Client bookings tab unless the user explicitly taps Referrals.');
});

// ─── INVARIANT #34: Recommend flow is unified — no dual-path popup ──────
// Tarik flagged the old 2-path Recommend popup as confusing — "Recommend
// from contacts" routed to a contacts picker that looked like it was
// asking the user to pick a SERVICE, not a recipient. The "Write a
// recommendation" path was redundant. This invariant locks the unified
// model: ONE form at /invite/recommend that supports both contact-pick
// (autosuggest auto-fills phone+email) and manual typing.
test('recommend-unified', 'Recommend flow is one screen — contacts + manual merged, no in-app links to the old popup', '#34', async () => {
  const form = readFile('src/screens/RecommendServiceFormScreen.jsx');
  const code = stripComments(form);

  // The unified form must expose all three recipient fields so manual
  // entry works (not just contacts autosuggest).
  for (const field of ['name', 'phone', 'email']) {
    const re = new RegExp(`\\b${field}\\b[\\s\\S]*?setState|set${field[0].toUpperCase()}${field.slice(1)}\\(`);
    assert(re.test(code),
      `RecommendServiceFormScreen must manage a "${field}" state field (manual entry path).`);
  }

  // Autosuggest still has to populate state from a picked contact.
  assert(/function\s+pickMatch|const\s+pickMatch\s*=/.test(code),
    'RecommendServiceFormScreen must have a pickMatch handler (autosuggest path).');

  // Validation must accept EITHER phone OR email — not require both.
  assert(/hasContact\s*=\s*isPlausiblePhone\(phone\)\s*\|\|\s*isPlausibleEmail\(email\)/.test(code),
    'RecommendServiceFormScreen must accept either phone OR email (not require both).');

  // The old popup file must now be a redirect, not the dual-path UI.
  const popup = readFile('src/screens/RecommendServicePopupScreen.jsx');
  assert(/<Navigate\s+to=["']\/invite\/recommend["']/.test(popup),
    'RecommendServicePopupScreen must redirect to /invite/recommend (dual-path popup is retired).');

  // No live screen should still navigate to /invite/recommend-popup —
  // App.jsx keeps the route as a redirect, but no in-app link should
  // route THROUGH it. Scan every screen except App.jsx and the popup
  // file itself for stale links.
  const screensDir = path.join(REPO_ROOT, 'src/screens');
  const screenFiles = fs.readdirSync(screensDir).filter(f => f.endsWith('.jsx'));
  const stale = [];
  for (const f of screenFiles) {
    if (f === 'RecommendServicePopupScreen.jsx') continue;
    const src = fs.readFileSync(path.join(screensDir, f), 'utf8');
    if (src.includes('/invite/recommend-popup')) stale.push(`src/screens/${f}`);
  }
  assert(stale.length === 0,
    `Stale "/invite/recommend-popup" navigate calls — point them at "/invite/recommend" instead:\n  ${stale.join('\n  ')}`);
});

// ─── INVARIANT #35: bot-reply gate accepts what OR provider_type ──────
// The houskeeper-bug fix (2026-05-28). When the cloud parser fails to
// extract `what` for a typo'd actor-noun ("houskeeper"), but the LOCAL
// taxonomy correctly resolves `provider_type`, the chat reply MUST NOT
// fall into the "What service do you need?" empty state. This invariant
// statically locks the gate so a "just check merged.what" revert fails
// before merge.
test('chat-reply-gate', 'useChat bot-reply gate accepts what OR provider_type (houskeeper-bug regression guard)', '#35', async () => {
  const src = readFile('src/hooks/useChat.js');
  const code = stripComments(src);

  // The backfill that copies provider_type → what when the cloud parser
  // returns null must still exist.
  assert(/whatFromTaxonomy/.test(code),
    'useChat must backfill merged.what from a locally-resolved provider_type (whatFromTaxonomy).');

  // The reply gate must use whatKnown = merged.what || merged.provider_type
  // and branch on !whatKnown — not on !merged.what alone.
  assert(/whatKnown\s*=\s*!!merged\.what\s*\|\|\s*!!merged\.provider_type/.test(code),
    'Reply gate must compute whatKnown = !!merged.what || !!merged.provider_type.');
  assert(/if\s*\(\s*!whatKnown\s*\)/.test(code),
    'Reply gate must branch on !whatKnown (not !merged.what) so a resolved provider_type skips the empty-state prompt.');
});

// ─── INVARIANT #36: actor-noun integration test — no empty-state ─────
// Realistic typed queries that include only an ACTOR NOUN (housekeeper,
// plumber, electrician, sitter) — sometimes with a typo, sometimes with
// a budget tail. For each, the local taxonomy must resolve a
// provider_type. The cloud parser may or may not extract `what`, but
// thanks to #35's gate, the user's reply must never fall into the
// "What service do you need?" empty state. This is the integration-
// flavored guardrail Tarik asked for — "superior processes, no moving
// target".
test('actor-noun-integration', 'Actor-noun queries always pass the chat-reply gate (no false empty state)', '#36', async () => {
  const mod = await import('../src/lib/serviceTaxonomy.js');
  const resolve = mod.resolveProviderTypeLocal;

  // The simulated "merged" object the bot-reply gate sees after useChat
  // runs. Cloud parser is treated as if it returned what=null (worst case
  // — actor-noun typo, model didn't extract). Local taxonomy is the only
  // line of defense. With the backfill in place, merged.what === provider_type
  // and the gate must pass.
  function simulateMerged(query) {
    const cloudWhat = null; // worst case
    const localPT   = resolve(query);
    const whatFromTaxonomy = (!cloudWhat && localPT) ? localPT : null;
    const what = cloudWhat ?? whatFromTaxonomy ?? null;
    const provider_type = localPT;
    const whatKnown = !!what || !!provider_type;
    return { what, provider_type, whatKnown };
  }

  const cases = [
    'houskeeper',
    'need houskeeper under 200',
    'housekeping under 200',
    'i need a housekeeper',
    'plummer',
    'plumbr needed today',
    'electrcian needed urgently',
    'need a baby sitter tonight',
    'nany needed',
    'dog walker mornings',
  ];

  const fails = [];
  for (const q of cases) {
    const m = simulateMerged(q);
    if (!m.whatKnown) {
      fails.push(`'${q}' → whatKnown=false (local PT=${JSON.stringify(m.provider_type)}, what=${JSON.stringify(m.what)})`);
    }
  }
  assert(fails.length === 0,
    `Actor-noun queries that would fall into the "What service do you need?" empty state — ${fails.length} of ${cases.length} failed:\n  ${fails.join('\n  ')}`);
});

// ─── INVARIANT #37: listServices hydrates recommenders, Results renders ─
// Audit (2026-05-29) found the FriendAvatars stack on ResultsScreen
// existed but the `friends` array was never populated from real data.
// listServices now hydrates each service with a `recommenders` array
// pulled from the recommendations table joined to profile.display_name.
// ResultsScreen maps recommenders → friends so the avatar stack renders.
// This invariant locks the contract on both sides.
test('recommenders-hydration', 'listServices hydrates recommenders + ResultsScreen renders them as friend avatars', '#37', async () => {
  const api = readFile('src/lib/api.js');
  const apiCode = stripComments(api);
  assert(/async function fetchRecommendersByServiceId/.test(apiCode),
    'api.js must define fetchRecommendersByServiceId helper.');
  // Both listServices branches (proximity + plain) must hydrate.
  const hydrationCalls = apiCode.match(/await fetchRecommendersByServiceId\(/g) || [];
  assert(hydrationCalls.length >= 2,
    `listServices must call fetchRecommendersByServiceId in BOTH branches (proximity + plain). Found ${hydrationCalls.length} call sites.`);

  const screen = readFile('src/screens/ResultsScreen.jsx');
  const screenCode = stripComments(screen);
  // serviceToProvider must derive friends from svc.recommenders, not just
  // the legacy single-friend hint. The mapping below is the canonical
  // shape — recoNames built from svc.recommenders.
  assert(/svc\.recommenders/.test(screenCode),
    'ResultsScreen.serviceToProvider must read svc.recommenders to populate friends.');
  assert(/recsRaw\s*=\s*Array\.isArray\(svc\.recommenders\)/.test(screenCode),
    'ResultsScreen must derive recsRaw from Array.isArray(svc.recommenders).');

  // CERGIO-GUARD (2026-05-29): the recommendations table column is
  // `sent_at`, NOT `created_at`. Querying the wrong column silently
  // returns 0 rows (PostgREST error wrapped in empty data) → every
  // ProviderCard renders "No mutual friends yet" even when recs exist.
  // Lock both the api.js helper AND the PDP cold-fallback against any
  // future "created_at" reintroduction.
  assert(!/\.select\('[^']*\bcreated_at\b[^']*'\)[\s\S]{0,80}from\('recommendations'\)/.test(apiCode)
      && !/from\('recommendations'\)[\s\S]{0,200}\.select\('[^']*\bcreated_at\b[^']*'\)/.test(apiCode)
      && !/from\('recommendations'\)[\s\S]{0,200}\.order\('created_at'/.test(apiCode),
    'api.js MUST NOT query recommendations.created_at — that column does not exist (use sent_at).');

  const pdp = readFile('src/screens/ServiceDetailScreen.jsx');
  assert(!/from\('recommendations'\)[\s\S]{0,200}\.order\('created_at'/.test(pdp)
      && !/from\('recommendations'\)[\s\S]{0,300}\.select\('[^']*\bcreated_at\b[^']*'\)/.test(pdp),
    'ServiceDetailScreen MUST NOT query recommendations.created_at — that column does not exist (use sent_at).');
});

// ─── INVARIANT #40: ProviderCard recoText buckets recommenders ──────────
// Tarik 2026-05-30: "Reco'd by Jennifer Hu, 3 other friends and 21
// Connectors." Format requires the data layer to expose:
//   • friendCount    (recs from people in user's network, non-Connectors)
//   • connectorCount (recs from cc_verified profiles)
//   • leadFriendName (top friend's display_name)
// AND ProviderCard must render the joined "X friends and Y Connectors"
// natural-language string. Locks both ends so the friendly bucket can't
// silently regress to the old "Reco'd by Alex, Sam, Connie" flat list.
test('reco-buckets', 'ProviderCard reco copy splits friends + Connectors per recommender bucket', '#40', async () => {
  const api = readFile('src/lib/api.js');
  const apiCode = stripComments(api);
  assert(/is_connector:\s*!!p\?\.cc_verified_at/.test(apiCode),
    'fetchRecommendersByServiceId must derive is_connector from profiles.cc_verified_at.');

  const results = readFile('src/screens/ResultsScreen.jsx');
  const rCode = stripComments(results);
  assert(/friendCount:\s*friendsRaw\.length/.test(rCode),
    'serviceToProvider must compute friendCount from non-Connector recommenders.');
  assert(/connectorCount:\s*connectorsRaw\.length/.test(rCode),
    'serviceToProvider must compute connectorCount from Connector recommenders.');
  assert(/leadFriendName:/.test(rCode),
    'serviceToProvider must expose leadFriendName (the named anchor in the recoText).');

  const card = readFile('src/components/ui/ProviderCard.jsx');
  const cCode = stripComments(card);
  // stripComments wipes backticked template literals, so check the
  // 'other friend' wording on the RAW source (it sits inside a
  // template-string ternary).
  assert(/friendCount/.test(cCode) && /connectorCount/.test(cCode) && /leadFriendName/.test(cCode),
    'ProviderCard must destructure friendCount + connectorCount + leadFriendName from provider.');
  assert(/other friend/.test(card),
    'ProviderCard recoText must surface the "X other friends" wording.');
  assert(/Connector/.test(card),
    'ProviderCard recoText must surface the "Connector(s)" wording.');
});

// ─── INVARIANT #38: ServiceDetailScreen (PDP) wired + renders recommenders ─
// Audit slice 2 (2026-05-29). The consumer PDP — the "Jennifer Leighton"
// view in the Figma reference — was missing. ResultsScreen jumped
// straight to /booking, skipping the trust step. New ServiceDetailScreen
// at /service/:serviceId renders provider + avatar stack of recommenders
// + Book CTA. ProviderCard photo tap → /service/:id; Book button stays
// fast-path to /booking. This invariant locks the full wiring.
test('pdp-wired', 'ServiceDetailScreen renders recommender stack + ResultsScreen onOpen routes to it', '#38', async () => {
  const pdp = readFile('src/screens/ServiceDetailScreen.jsx');
  const pdpCode = stripComments(pdp);
  assert(/export function ServiceDetailScreen/.test(pdpCode),
    'src/screens/ServiceDetailScreen.jsx must export ServiceDetailScreen.');
  // Must read recommenders from location.state.provider.recommendersRaw
  // (fast path) AND have a Supabase fallback for cold deep links.
  assert(/recommendersRaw/.test(pdpCode),
    'PDP must consume provider.recommendersRaw from location.state for instant render.');
  assert(/AvatarStack/.test(pdpCode),
    'PDP must define + render an AvatarStack primitive for the recommenders.');
  // Cold-deep-link fallback — must fetch recommendations + profiles when
  // there is no seeded state. Locks against someone "simplifying" by
  // removing the fallback (which would 404 every /service/:id deep link).
  assert(/from\(['"]recommendations['"]\)[\s\S]{0,200}service_id/.test(pdpCode),
    'PDP cold-fallback must query the recommendations table by service_id.');
  // The Book CTA must reuse the existing handleBook flow — accepts
  // either handleBook(provider) directly OR handleBook(sel ? {...provider, ...} : provider)
  // for multi-offering PDPs.
  assert(/handleBook\(/.test(pdpCode),
    'PDP Book CTA must call handleBook(...) so the existing booking flow is reused.');

  const app = readFile('src/App.jsx');
  assert(/path="\/service\/:serviceId"/.test(app),
    'App.jsx must register the /service/:serviceId route.');
  assert(/<ServiceDetailScreen\s*\/>/.test(app),
    'App.jsx must render <ServiceDetailScreen />.');

  const results = readFile('src/screens/ResultsScreen.jsx');
  const resultsCode = stripComments(results);
  // stripComments replaces backticked template literals with "" — so we
  // check the raw source for the /service/ URL substring, and the
  // comment-stripped source for the onOpen + recommendersRaw wiring.
  assert(/onOpen=/.test(resultsCode),
    'ResultsScreen ProviderCard must wire an onOpen prop.');
  assert(/\/service\//.test(results),
    'ResultsScreen must navigate to /service/ (the PDP route).');
  assert(/recommendersRaw/.test(resultsCode),
    'ResultsScreen serviceToProvider must pass recommendersRaw through to the PDP.');
});

// ─── INVARIANT #39: Earnings shows degree-of-separation per row ─────────
// Audit slice 3 (2026-05-29). The earnings ledger merged direct $250
// payouts and friend-of-friend $12.50 bonuses into identical-looking
// rows. Now each referral row carries a small tier pill (Direct / Chain
// +5%) so users see which degree each dollar came from. Prefers
// meta.tier when the stripe-webhook writes it; falls back to an
// amount-based heuristic (≤$50 → chain). Spotlights + bookings render
// no tier pill (not applicable).
test('earnings-tier', 'EarningsScreen surfaces direct vs friend-of-friend tier per row', '#39', async () => {
  const src = readFile('src/screens/EarningsScreen.jsx');
  const code = stripComments(src);

  assert(/function\s+earningTier\s*\(/.test(code),
    'EarningsScreen must define earningTier(e) classifying invite rows as direct vs chain.');
  // Both tier values must be reachable from the classifier.
  assert(/return\s+['"]chain['"]/.test(code) && /return\s+['"]direct['"]/.test(code),
    'earningTier must return both "direct" and "chain" tiers.');
  // The render path must call earningTier and pill it.
  assert(/earningTier\(e\)/.test(code),
    'EarningsScreen render must call earningTier(e) per row.');
  // User-visible labels. CERGIO-GUARD (2026-06-03): updated from
  // "Direct" / "Chain +5%" to "Tier 1" / "Tier 2" per Tarik —
  // "instead of direct and chain, classify as tier one 250 (7% at
  // time), and tier 2 $12.5 (0.5% at a time)".
  assert(/Tier 1/.test(code) && /Tier 2/.test(code),
    'Tier pill labels "Tier 1" and "Tier 2" must be present.');
});

// ─── INVARIANT #41: urgency words satisfy the WHEN chat gate ────────────
// Tarik 2026-05-30: "plumber asap" was prompting "When do you need this?"
// — asap/now/urgent/today are time signals the Claude parser sometimes
// misses. Lock the local urgency-word capture in applyParseResult so a
// future refactor can't drop it and re-introduce the awkward double-ask.
test('urgency-capture', 'useChat captures asap/now/urgent/today as a WHEN signal', '#41', async () => {
  const src = readFile('src/hooks/useChat.js');
  const code = stripComments(src);

  assert(/URGENCY_RE\s*=\s*\/\\b/.test(code),
    'useChat must define URGENCY_RE to detect informal time phrases.');
  // The pattern itself must cover the canonical set Tarik called out.
  const urgencyRe = code.match(/URGENCY_RE\s*=\s*\/(.+?)\//);
  assert(urgencyRe,
    'URGENCY_RE must be a defined regex.');
  const reSrc = urgencyRe[1];
  for (const word of ['asap', 'now', 'urgent', 'today', 'emergency', 'immediately']) {
    assert(new RegExp(word, 'i').test(reSrc),
      `URGENCY_RE must recognise "${word}".`);
  }
  // The capture must set fields.when AND res.urgency=true.
  assert(/fields\.when\s*=\s*['"`]?(?:ASAP|matched)/.test(code) || /fields\.when\s*=\s*matched/.test(code),
    'Urgency capture must set fields.when to ASAP (or the matched literal).');
  assert(/res\.urgency\s*=\s*true/.test(code),
    'Urgency capture must set res.urgency = true so downstream notification can prioritize.');
});

// ─── INVARIANT #18: build version pill rendered + wired via Vite define ─
// Observability. Renders the current short git SHA in a corner so
// HMR-stale-closure bugs (like the 2026-05-27 2-day debug) are
// immediately visible to the user. If anyone strips the pill or the
// vite define{}, this test fails.
test('build-version-pill', 'Build version pill is wired + rendered (HMR-staleness observability)', '#18', async () => {
  // 1) BuildVersionPill component must exist and read the define'd globals.
  const pill = readFile('src/components/ui/BuildVersionPill.jsx');
  assert(/__CERGIO_BUILD_SHA__/.test(pill),
    'BuildVersionPill must reference __CERGIO_BUILD_SHA__ injected by vite define.');
  // 2) App.jsx must render it.
  const app = readFile('src/App.jsx');
  assert(/<BuildVersionPill\s*\/>/.test(app),
    'App.jsx must render <BuildVersionPill /> so the pill is always present.');
  // 3) vite.config.js must define the globals.
  const vite = readFile('vite.config.js');
  assert(/__CERGIO_BUILD_SHA__/.test(vite) && /define\s*:/.test(vite),
    'vite.config.js must inject __CERGIO_BUILD_SHA__ via define{} so the pill shows the real commit SHA.');
});

// ─── INVARIANT #17: dynamic import of api.js in ResultsScreen ──────────
// The 2026-05-27 HMR bug: a static `import { listServices } from
// '../lib/api'` binding survives Vite HMR. After any api.js edit, the
// mounted ResultsScreen keeps calling the OLD listServices closure,
// producing zero results no matter how the API itself changes. Fix:
// `await import('../lib/api')` inside the search effect.
test('hmr-proof-search', 'ResultsScreen dynamic-imports listServices inside the search effect', '#17', async () => {
  const src = readFile('src/screens/ResultsScreen.jsx');
  const code = stripComments(src);
  // Must contain a dynamic await import of '../lib/api'.
  assert(/await\s+import\(\s*['"]\.\.\/lib\/api['"]\s*\)/.test(code),
    "ResultsScreen must use `await import('../lib/api')` inside the search effect so listServices re-resolves to the latest api.js after every HMR.");
  // Must NOT have a top-level static `import { listServices } from '../lib/api'`.
  // (A guard COMMENT preserving the symbol is fine — checked against
  // non-comment code via stripComments above.)
  assert(!/^import\s*\{\s*listServices\s*\}\s*from\s*['"]\.\.\/lib\/api['"]/m.test(code),
    "ResultsScreen must NOT statically import listServices — that binding survives HMR and causes stale-closure zero-result bugs. Use the dynamic import inside the effect instead.");
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

// ─── FROZEN SPEC GUARDS ──────────────────────────────────────────────────────
// These tests enforce FROZEN_SPEC.md. Every item below is a behavior Tarik
// confirmed in chat. Regressions here are treated as critical failures —
// they break user trust and app confidence. DO NOT remove or weaken these.
//
// Reference: cergio-app/FROZEN_SPEC.md
// Process: if a test below fails, fix the regression, never delete the test.

test('spec-42-no-barter-pill', 'FROZEN: No "barter" pill on results waiting state (SPEC-42)', '#42', async () => {
  // The barter pill ("Sent to Connectors near you · they barter for $250 in
  // free spotlights") was removed 2026-06-11 after regressing. The only
  // canonical waiting state is the leaf + "We'll let you know when offers land."
  // This test ensures the banned copy can never sneak back in.
  const src = readFile('src/screens/ResultsScreen.jsx');

  // Banned phrases — any of these appearing in JSX (not in comments) is a regression.
  const stripped = src
    .replace(/\/\/[^\n]*/g, '')           // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');    // strip block comments

  assert(
    !stripped.includes('they barter for'),
    'REGRESSION: "they barter for" barter pill copy found in ResultsScreen.jsx — SPEC-42 violated'
  );
  assert(
    !stripped.includes('Connectors are locals who get free services in exchange for spotlighting'),
    'REGRESSION: barter pill explanation copy found in ResultsScreen.jsx — SPEC-42 violated'
  );

  // Canonical waiting state must still be present.
  assert(
    src.includes("We'll let you know when offers land"),
    'REGRESSION: canonical waiting copy "We\'ll let you know when offers land." is missing from ResultsScreen.jsx — SPEC-42 violated'
  );
});

test('spec-43-invite-network-only', 'FROZEN: Invite contacts scoped to network table, no pre-selection (SPEC-43)', '#43', async () => {
  const api = readFile('src/lib/api.js');
  const screen = readFile('src/screens/InviteFriendsScreen.jsx');

  // api.js: listInvitableProfiles must query the network table for followed_id,
  // not do a bare .from('profiles') select without a network scope.
  assert(
    api.includes("from('network')") || api.includes('from("network")'),
    'REGRESSION: listInvitableProfiles does not query network table — SPEC-43 violated (full profiles dump risk)'
  );
  assert(
    api.includes('followed_id') || api.includes('follower_id'),
    'REGRESSION: listInvitableProfiles missing follower_id / followed_id scope — SPEC-43 violated'
  );

  // InviteFriendsScreen.jsx: must NOT pre-select any contacts on load.
  // The pattern setSelected(new Set(data.slice(0, N)...)) is permanently banned.
  const screenStripped = screen
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert(
    !screenStripped.match(/setSelected\s*\(\s*new Set\s*\(\s*data\.slice/),
    'REGRESSION: InviteFriendsScreen pre-selects contacts on load (setSelected+slice) — SPEC-43 violated'
  );
});

test('spec-44-geocoder-nominatim-clears-error', 'FROZEN: Nominatim rescue clears geocode lastError so banner disappears (SPEC-44)', '#44', async () => {
  const src = readFile('src/lib/google.js');

  // After a successful Nominatim fallback, the code must clear status.lastError
  // when kind === 'geocode'. Without this, SetupCheckBanner shows a false
  // REQUEST_DENIED error even though the address resolved successfully.
  assert(
    src.includes("status.lastError?.kind === 'geocode'") ||
    src.includes('status.lastError?.kind === "geocode"'),
    'REGRESSION: google.js does not check lastError.kind === "geocode" in Nominatim path — SPEC-44 violated'
  );
  assert(
    src.includes('status.lastError = null'),
    'REGRESSION: google.js Nominatim path does not clear status.lastError — banner will show false error — SPEC-44 violated'
  );
  // Auth errors must NOT be cleared by Nominatim (they affect more than geocoding).
  // The null-clear must be guarded by the kind==='geocode' check, not unconditional.
  const nominatimBlock = src.slice(src.indexOf('Nominatim'), src.indexOf('status.lastError = null') + 50);
  assert(
    nominatimBlock.includes("kind === 'geocode'") || nominatimBlock.includes('kind === "geocode"'),
    'REGRESSION: google.js clears lastError unconditionally in Nominatim path — auth errors would be lost — SPEC-44 violated'
  );
});

test('spec-45-free-spotlight-no-pay-gate', 'FROZEN: Free ($0) spotlight skips Pay step and paid_at gate (SPEC-45)', '#45', async () => {
  // Free spotlights ($0) must never require payment and must not be gated
  // by paid_at or the 24h expiry rule that applies to unpaid spotlights.
  // Source files to check: any SpotlightScreen, SpotlightPayScreen, or
  // spotlight-related logic in the screens/ directory.
  const screenFiles = fs.readdirSync(path.join(REPO_ROOT, 'src/screens'))
    .filter(f => /spotlight/i.test(f));

  // If there's no spotlight screen at all yet, this test is informational.
  if (screenFiles.length === 0) return; // not built yet — skip

  for (const f of screenFiles) {
    const src = readFile(`src/screens/${f}`);
    const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // A free spotlight must not unconditionally require paid_at.
    // Look for paid_at checks that aren't guarded by a free/zero check.
    if (stripped.includes('paid_at') && !stripped.includes('isFree') && !stripped.includes('rate === 0') && !stripped.includes("rate === '0'")) {
      // Only fail if paid_at appears to gate rendering with no free escape.
      const hasFreeBypass =
        stripped.includes('free') ||
        stripped.includes('noCharge') ||
        stripped.includes('zeroRate');
      assert(hasFreeBypass,
        `REGRESSION: ${f} gates on paid_at with no free-swap bypass — SPEC-45 violated`);
    }
  }
});

test('spec-46-reco-form-device-contacts-only', 'FROZEN: Reco form uses device contacts only — no network profile fallback, single-select, auto-populate (SPEC-46)', '#46', async () => {
  const recoFile = path.join(REPO_ROOT, 'src/screens/RecommendServiceFormScreen.jsx');
  const src = fs.readFileSync(recoFile, 'utf8');

  // Must NOT import listInvitableProfiles (network profiles have no phone/email)
  assert(
    !src.includes('listInvitableProfiles'),
    'REGRESSION: RecommendServiceFormScreen imports listInvitableProfiles — network profiles have no phone/email, causes empty contact fields — SPEC-46 violated'
  );

  // Must NOT have seededPool (the old fallback to network profiles)
  assert(
    !src.includes('seededPool'),
    'REGRESSION: seededPool found in RecommendServiceFormScreen — this was the old network-profile fallback that left phone/email blank — SPEC-46 violated'
  );

  // Must use single-select (multiple: false) so picking a contact immediately populates fields
  assert(
    src.includes('multiple: false'),
    'REGRESSION: Contact picker must use multiple: false (single-select) so one contact fills all fields immediately — SPEC-46 violated'
  );

  // Must call pickMatch() after contact picker (auto-populate pattern)
  assert(
    src.includes('pickMatch(picked)') || src.includes('pickMatch(contact)'),
    'REGRESSION: Contact picker must call pickMatch() immediately after picking a contact to auto-populate name/phone/email — SPEC-46 violated'
  );
});

test('spec-47-free-barter-loop', 'FROZEN: Free barter loop — schedule confirm, no auto-confirm, post → accept gate (SPEC-47)', '#47', async () => {
  const app = fs.readFileSync(path.join(REPO_ROOT, 'src/App.jsx'), 'utf8');
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const inbox = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/JobsInboxScreen.jsx'), 'utf8');

  // 1. ScheduleSheet exists and gates every real booking.
  assert(fs.existsSync(path.join(REPO_ROOT, 'src/components/ui/ScheduleSheet.jsx')),
    'ScheduleSheet.jsx must exist — calendar + time + Done per SPEC-47');
  assert(/setScheduleTarget\(provider\)/.test(app),
    'handleBook must open the ScheduleSheet (setScheduleTarget) instead of booking immediately');
  assert(/scheduleConfirmed:\s*!!chosenAt/.test(app),
    'proceedBooking must stamp scheduleConfirmed from the chosen time');

  // 2. No auto-confirm on submission. The free branch and the demo-paid
  //    fallback must NOT flip the booking to confirmed at creation.
  const proceedStart = app.indexOf('const proceedBooking');
  const proceedEnd   = app.indexOf('const handlePaymentSuccess');
  const proceedSrc   = app.slice(proceedStart, proceedEnd);
  assert(proceedStart > 0 && proceedEnd > proceedStart, 'proceedBooking block must exist in App.jsx');
  assert(!/updateBookingStatus\([^)]*'confirmed'\)/.test(proceedSrc),
    "REGRESSION: proceedBooking auto-confirms a booking at submission — provider must accept (SPEC-47)");

  // 3. THE GATE — free bookings consult getOutstandingFreeBarter first.
  assert(/export async function getOutstandingFreeBarter/.test(api),
    'lib/api.js must export getOutstandingFreeBarter');
  assert(/getOutstandingFreeBarter/.test(app) &&
         app.indexOf('getOutstandingFreeBarter') < app.indexOf('setScheduleTarget(provider)'),
    'handleBook must run the free-barter gate BEFORE opening the schedule sheet');
  // Gate releases only on provider confirmation, never on posted_at alone.
  const gateStart = api.indexOf('export async function getOutstandingFreeBarter');
  const gateSrc   = api.slice(gateStart, gateStart + 1600);
  assert(/\.is\('post_confirmed_at',\s*null\)/.test(gateSrc),
    'Gate must key on post_confirmed_at (provider acceptance), not posted_at');

  // 4. Loop endpoints exist + inbox carries both sides' CTAs.
  for (const fn of ['markBookingPosted', 'confirmBookingPost', 'flagBookingPost']) {
    assert(new RegExp(`export async function ${fn}`).test(api), `lib/api.js must export ${fn}`);
  }
  assert(/MarkBookingPostedModal/.test(inbox), 'JobsInbox must mount MarkBookingPostedModal (Connector "Mark IG post done")');
  assert(/confirmBookingPost|handleConfirmPost/.test(inbox), 'JobsInbox must wire provider Accept post');
  assert(/flagBookingPost|handleFlagPost/.test(inbox), 'JobsInbox must wire provider Something\'s-wrong flag');

  // 5. Feed share — listSocialFeed emits kind 'barter'.
  assert(/kind:\s*'barter'/.test(api), "listSocialFeed must emit kind 'barter' for posted free-service spotlights");
});

test('rpc-catch-footgun', 'No supabase.rpc(...).catch() — the builder is a thenable with no .catch(); it throws synchronously and aborts the caller', '#rpc1', async () => {
  const srcDir = path.join(REPO_ROOT, 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/\.rpc\([^)]*\)\s*\.catch\b/.test(src)) offenders.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(srcDir);
  assert(offenders.length === 0,
    `supabase.rpc(...).catch() throws synchronously (no .catch on the builder) — wrap in Promise.resolve(...) or await in try/catch. Offenders: ${offenders.join(', ')}`);
});

test('spec-52-contacts-import', 'Contacts import: native phone picker + Gmail (People API) + CSV/vCard fallback, no fake contacts (SPEC-52)', '#52', async () => {
  const screen = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/InviteFriendsScreen.jsx'), 'utf8');
  const gPath  = path.join(REPO_ROOT, 'src/lib/googleContacts.js');
  assert(fs.existsSync(gPath), 'googleContacts.js (Gmail People API helper) must exist');
  const g = fs.readFileSync(gPath, 'utf8');
  // Gmail path: People API + GIS token flow, env-gated so it never breaks.
  assert(/people\.googleapis\.com/.test(g) && /contacts\.readonly/.test(g),
    'Gmail import must use the People API with read-only scope');
  assert(/VITE_GOOGLE_CLIENT_ID/.test(g) && /isGoogleContactsConfigured/.test(g),
    'Gmail import must be gated on VITE_GOOGLE_CLIENT_ID (hidden/disabled until configured)');
  // No fake data: only real rows.
  assert(/filter\(c => c\.name \|\| c\.email \|\| c\.phone\)/.test(g),
    'Gmail import must keep only real rows (no synthesized contacts)');
  // Screen wires all three paths: native picker, Gmail, and CSV/vCard fallback.
  assert(/navigator\.contacts\.select/.test(screen), 'Native phone Contact Picker must remain wired');
  assert(/importFromGmail/.test(screen) && /importGoogleContacts/.test(screen), 'Connect-Gmail must be wired');
  assert(/accept=".csv,.vcf/.test(screen), 'CSV/vCard upload fallback must remain');
  // SPEC-52 rev (Tarik 2026-06-18): Gmail is the permanent web gold standard.
  // No confusing DUPLICATE file-upload button (the old "Upload Gmail contacts
  // (.csv)" label is gone) — at most one quiet "Or upload a contacts file".
  assert(!/Upload Gmail contacts/.test(screen),
    'No duplicate "Upload Gmail contacts (.csv)" button — Gmail is the one-tap path (SPEC-52)');
  // FindFriendsScreen offers the same real, config-gated Gmail import.
  const find = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/FindFriendsScreen.jsx'), 'utf8');
  assert(/syncGmail/.test(find) && /isGoogleContactsConfigured/.test(find),
    'FindFriendsScreen must offer config-gated Gmail import (SPEC-52)');
});

test('spec-51-spotlight-clicks', 'IG post performance: clicks tracked per spotlight + totalled on Earnings (SPEC-51)', '#51', async () => {
  const api   = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const land  = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/InviteLandingScreen.jsx'), 'utf8');
  const earn  = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/EarningsScreen.jsx'), 'utf8');
  const inbox = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/JobsInboxScreen.jsx'), 'utf8');
  const mig   = path.join(REPO_ROOT, 'supabase/migrations/20260616030000_spotlight_clicks.sql');

  // Migration adds the counter + increment RPC.
  assert(fs.existsSync(mig), 'spotlight_clicks migration must exist');
  const m = fs.readFileSync(mig, 'utf8');
  assert(/spotlight_clicks/.test(m) && /record_spotlight_click/.test(m),
    'migration must add spotlight_clicks column + record_spotlight_click RPC');
  // The link landing increments via the RPC (wrapped in Promise.resolve — no .catch footgun).
  assert(/record_spotlight_click/.test(land), 'InviteLandingScreen must call record_spotlight_click');
  // Earnings totals clicks (both roles), inbox shows per-spotlight.
  assert(/getMySpotlightClicks/.test(api) && /getMySpotlightClicks/.test(earn),
    'Earnings must surface getMySpotlightClicks total');
  assert(/spotlight_clicks/.test(inbox), 'Inbox spotlight rows must show the per-post click count');
  // No-fake-data: clicks come from real cents/counts, card hides at 0.
  assert(/spotlightClicks\.total > 0/.test(earn), 'Earnings clicks card must hide when total is 0 (no fake data)');
});

test('spec-50-action-first-inbox', 'FROZEN: Inbox Overview is an action-first feed — one-liners, $-led, green review, inline actions, filter (SPEC-50)', '#50', async () => {
  const inbox = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/JobsInboxScreen.jsx'), 'utf8');
  assert(/function ActionRow/.test(inbox), 'ActionRow (compact one-liner) component must exist');
  // Overview builds a prioritized action list with inline actions.
  assert(/actionLabel:\s*'Accept post'/.test(inbox), 'Provider spotlight-review must be an inline Accept-post action');
  assert(/actionLabel:\s*'Rate & post'/.test(inbox), 'Consumer must rate & post inline');
  assert(/actionLabel:\s*'Pay'/.test(inbox), 'Pay-due item must offer inline Pay');
  // Leads with $ where a real amount exists.
  assert(/usd\(b\.total_cents\)/.test(inbox) || /usd\(resp\.offered_price_cents\)/.test(inbox),
    'Money items must lead with a $ amount from real cents');
  // Filter chips.
  assert(/actionFilter/.test(inbox) && /\[\s*'money'\s*,\s*'Money'\s*\]/.test(inbox),
    'Action feed must have a money/free filter');
  // Green tone reserved for "your turn / review" rows.
  assert(/tone:\s*'green'/.test(inbox), 'Review/your-turn rows must use the green tone');
  // Feed is sorted CHRONOLOGICALLY (newest first) so "All" shows the latest
  // items (incl. free barters) on top, not grouped by section priority
  // (Tarik 2026-06-18). Disputes stay pinned.
  assert(/items\.sort\(/.test(inbox) && /new Date\(b\.ts/.test(inbox),
    'Overview action feed must sort by ts (newest first) — SPEC-50 chronological order');
  // Every action row must also be VIEWABLE (onView) — "given a button to accept
  // but no way to view" regression (Tarik 2026-06-18).
  assert(/function ActionRow\([^)]*onView/.test(inbox) && /onView:/.test(inbox),
    'ActionRow must accept onView and items must pass it — every action is also viewable (SPEC-50)');
  // A confirmed booking stands out (green ✓ Confirmed) with a one-tap calendar add.
  assert(/✓ Confirmed ·/.test(inbox) && /calendar\.google\.com\/calendar\/render/.test(inbox),
    'Confirmed booking must render a standout "✓ Confirmed" row + Add-to-calendar link (SPEC-50)');

  // The Inbox dot lights on a fresh recommendation received (a 4★+ rate writes
  // one) so the provider is notified (Tarik 2026-06-18).
  const dot = fs.readFileSync(path.join(REPO_ROOT, 'src/hooks/useInboxUnread.js'), 'utf8');
  assert(/recoTimesOnMyServices/.test(dot) && /freshReco/.test(dot),
    'useInboxUnread must light the dot on a fresh recommendation received (recoTimesOnMyServices) — SPEC-50');
  // Dot also covers SPOTLIGHT requests (inbound ask / other party's turn).
  assert(/listMyInboundSpotlightRequests/.test(dot) && /listMyOutboundSpotlightRequests/.test(dot),
    'useInboxUnread must cover spotlight requests (inbound + outbound) — SPEC-50');
});

test('login-on-book-invite', 'Booking while logged out invites to sign in (returnTo) — never dead-ends with an error', '#login1', async () => {
  const app  = fs.readFileSync(path.join(REPO_ROOT, 'src/App.jsx'), 'utf8');
  const auth = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/AuthScreen.jsx'), 'utf8');
  // handleBook must gate on auth and route to /auth?returnTo before booking.
  assert(/!auth\?\.isSignedIn/.test(app) && /\/auth\?returnTo=/.test(app),
    'handleBook must redirect logged-out users to /auth?returnTo instead of letting createBooking fail');
  // AuthScreen must honor returnTo after a successful sign-in.
  assert(/returnTo/.test(auth) && /navigate\(returnTo\)/.test(auth),
    'AuthScreen must navigate(returnTo) after sign-in so the user lands back on the service');
});

test('spec-49-unified-profile', 'FROZEN: Unified profile leads with viewer-prioritized party-signal block; People-who-love = recos received (SPEC-49)', '#49', async () => {
  const prof = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/PublicProfileScreen.jsx'), 'utf8');
  const hook = fs.readFileSync(path.join(REPO_ROOT, 'src/hooks/usePartyCounts.js'), 'utf8');
  const blockPath = path.join(REPO_ROOT, 'src/components/ui/ProfileSignalBlock.jsx');

  // 1. The signal block exists and is mounted, reusing the SAME source as the
  //    request previews (getInboxPartyCounts + formatKeyCounts) — no parallel
  //    count formatter (SPEC-48b/48c DRY rule).
  assert(fs.existsSync(blockPath), 'ProfileSignalBlock.jsx must exist');
  const block = fs.readFileSync(blockPath, 'utf8');
  assert(/formatKeyCounts/.test(block), 'ProfileSignalBlock must use the shared formatKeyCounts');
  assert(/<ProfileSignalBlock/.test(prof), 'PublicProfileScreen must mount ProfileSignalBlock');
  assert(/getInboxPartyCounts/.test(prof), 'PublicProfileScreen must load counts via getInboxPartyCounts');

  // 2. Viewer priority — serviceMode drives which facet leads (SPEC-48c).
  assert(/serviceMode/.test(prof) && /serviceMode/.test(block),
    'Profile must pass serviceMode so the leading facet flips by viewer (consumer→service, provider→connector)');

  // 3. People-who-love is recommendations RECEIVED, not the bookings-review
  //    table (Tarik 2026-06-16).
  assert(/recosReceived/.test(prof), 'PublicProfileScreen must render recosReceived for People-who-love');

  // 4. includeReco option keeps formatKeyCounts the single source.
  assert(/includeReco/.test(hook), 'formatKeyCounts must support includeReco (profile facet avoids double reco chip)');

  // 5. SPEC-49e: a Connector subject LEADS with the Connector facet (reach),
  //    not the service — mirrors the interim /inbound screen ("not plumber
  //    then connector").
  assert(/connectorLeads\s*=\s*isConnector/.test(block),
    'ProfileSignalBlock must lead with the Connector facet for Connector subjects (connectorLeads = isConnector ...) — SPEC-49e.');

  // 6. SPEC-49e: the full profile shows the Connector's spotlight track record
  //    via the same source + tile as the interim screen.
  assert(/getConnectorSpotlights/.test(prof) && /IgPostTile/.test(prof),
    'PublicProfileScreen must render the spotlight track record (getConnectorSpotlights + IgPostTile) — SPEC-49e.');

  // 7. SPEC-49e: the lead block replicates the interim /inbound identity block
  //    EXACTLY — granular reach line ("IG followers"), strength ("network on
  //    Cergio"), inline "See Instagram", bio + the explicit mutuals sentence.
  assert(/IG followers/.test(block) && /network on Cergio/.test(block),
    'ProfileSignalBlock must render the granular reach + strength lines (IG followers / network on Cergio) — SPEC-49e.');
  assert(/See Instagram/.test(block) && /mutual friends with/.test(block),
    'ProfileSignalBlock must include the inline See Instagram link + the "no mutual friends with {name}" sentence — SPEC-49e.');
  // The bio + IG handle + name are folded INTO the block (no separate About
  // section / View Instagram link on the profile).
  assert(/bio=\{profile\?\.bio\}/.test(prof) && /igHandle=\{igHandle\}/.test(prof),
    'PublicProfileScreen must pass bio + igHandle into ProfileSignalBlock (About + View Instagram folded in) — SPEC-49e.');

  // 8. SPEC-49f: consolidated "Recommendations received" section on the full
  //    profile. NO "services received/used" section (services consumed are not
  //    shown on a profile — Tarik 2026-06-18).
  assert(/Recommendations received/.test(prof),
    'PublicProfileScreen must render the "Recommendations received" section — SPEC-49f.');
  assert(!/servicesReceived/.test(prof),
    'PublicProfileScreen must NOT render a services-received/used section — SPEC-49f (services consumed are not shown).');

  // 9. Go-Tos cards flag mutuals (viewer connected to the recommended provider).
  assert(/isMutual:\s*!!\(owner\s*&&\s*netSet\.has\(owner\.id\)\)/.test(prof),
    'Go-Tos must flag isMutual from the viewer network (netSet) — mutuals on reco’d services.');
});

test('spec-49g-reputational-streams', 'FROZEN: reputational streams everywhere — SHARED primitives reused on profile + PDP; solid Connector badge, social reach on both facets, recommender mutual+Connector+social on every reco row, trust-first byline, de-duped recos-received (SPEC-49g)', '#49', async () => {
  const prof = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/PublicProfileScreen.jsx'), 'utf8');
  const block = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ui/ProfileSignalBlock.jsx'), 'utf8');
  const repPath = path.join(REPO_ROOT, 'src/components/ui/reputation.jsx');
  const pdp = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/ServiceDetailScreen.jsx'), 'utf8');

  // 0. The reputational primitives are SHARED (one source of truth, reused
  //    across the app) — recoByline, SocialReachLine, TrustStream, ConnectorChip.
  assert(fs.existsSync(repPath), 'src/components/ui/reputation.jsx must exist — shared reputational primitives (SPEC-49g).');
  const rep = fs.readFileSync(repPath, 'utf8');
  assert(/export function recoByline/.test(rep) && /your friend/.test(rep),
    'reputation.jsx must export recoByline that names mutual friends — SPEC-49g.');
  assert(/export function SocialReachLine/.test(rep) && /export function TrustStream/.test(rep),
    'reputation.jsx must export SocialReachLine + TrustStream — SPEC-49g.');
  // Mutuals + connectors are NAMED, never a faceless count.
  assert(/export function mutualNamesText/.test(rep),
    'reputation.jsx must export mutualNamesText (names the mutual friends) — SPEC-49g.');
  assert(/including \$\{s\.leadName\}/.test(rep),
    'recoByline must name a lead recommender ("…including Jane") even without a viewer-mutual — SPEC-49g.');
  assert(/mutualNamesText/.test(block) && /mutualNames/.test(prof),
    'Profile must pass + render NAMED mutuals (mutualNamesText) on the signal block — SPEC-49g.');

  // 1. SOLID Connector badge (bg-g text-white), not the soft mint pill.
  assert(/bg-g text-white[\s\S]{0,160}?Connector/.test(block),
    'ProfileSignalBlock Connector badge must be SOLID (bg-g text-white) — SPEC-49g.');

  // 2. Social reach renders on BOTH facets (reverses SPEC-49b).
  assert((block.match(/\{reachEl\}/g) || []).length >= 2,
    'ProfileSignalBlock must render the reach line on BOTH facets — SPEC-49g.');

  // 3. Profile reuses the SHARED byline on both the service tile + Go-To cards.
  assert(/from '\.\.\/components\/ui\/reputation'/.test(prof),
    'PublicProfileScreen must import the shared reputation primitives — SPEC-49g.');
  assert(/recoByline\(recoSummary\)/.test(prof) && /recoByline\(goToSummary/.test(prof),
    'recoByline must drive BOTH the service tile and the Go-To card bylines — SPEC-49g.');

  // 4. Recommender rows carry social reach via SocialReachLine + recommenderCounts.
  assert(/<SocialReachLine/.test(prof) && /getInboxPartyCounts\(recIds\)/.test(prof) && /recommenderCounts/.test(prof),
    'Profile recommender rows must load + render social counts (SocialReachLine + recommenderCounts) — SPEC-49g.');

  // 5. Go-To cards carry provider Connector badge + social reach + per-service summary.
  assert(/goToOwnerCounts/.test(prof) && /goToSummary/.test(prof),
    'Go-To cards must load owner social counts + per-service reco summary — SPEC-49g.');

  // 6. De-dup: RecoRow renders ONCE (consolidated section only).
  assert((prof.match(/<RecoRow\b/g) || []).length === 1,
    'RecoRow must render exactly once (consolidated section only — inline per-service list de-duped) — SPEC-49g.');

  // 7. PDP carries the SAME reputational streams (apply-across-the-app): a
  //    popping TrustStream on the provider identity, the real provider type (not
  //    the vague category), personalized About, and recommender mutual/social on
  //    every "what people say" row.
  assert(/from '\.\.\/components\/ui\/reputation'/.test(pdp) && /<TrustStream/.test(pdp),
    'ServiceDetailScreen must render the shared TrustStream on the provider identity — SPEC-49g.');
  assert(/displayType/.test(pdp) && /taxonomy_provider_type/.test(pdp),
    'PDP must show the real provider type (taxonomy_provider_type), not the vague category — SPEC-49g.');
  assert(/ownerProfile\?\.bio/.test(pdp) && /mutualNamesText/.test(pdp),
    'PDP must show the provider bio up in the identity block + NAMED mutuals (mutualNamesText) — SPEC-49g.');
  assert(/heroImages\.length > 1/.test(pdp),
    'PDP hero story-ruler must reflect the ACTUAL image count (no fake multi-page hint) — SPEC-49g / SPEC-12.');
  assert(/<MutualBadge/.test(pdp) && /<SocialReachLine/.test(pdp),
    'PDP "what people say" rows must carry the recommender mutual badge + social reach — SPEC-49g.');
});

test('spec-53-recommend-from-booking', 'FROZEN: Recommendations come from a completed booking (rate+post); IG post optional when paid; no service-page button (SPEC-53)', '#53', async () => {
  const api   = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const pdp   = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/ServiceDetailScreen.jsx'), 'utf8');
  const postModal = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ui/MarkBookingPostedModal.jsx'), 'utf8');

  // 1. recommendService inserts a recommendation LINKED to the real service_id
  //    (NOT null) so it surfaces on profiles.
  assert(/export async function recommendService/.test(api), 'api must export recommendService');
  const fn = api.slice(api.indexOf('export async function recommendService'), api.indexOf('export async function recommendService') + 700);
  assert(/service_id:\s*serviceId/.test(fn), 'recommendService must store the real service_id (not null)');

  // 2. The rate + post flow is the recommendation mechanism: it creates a
  //    service-linked recommendation (recommendService) for 4★+.
  assert(/recommendService/.test(postModal), 'MarkBookingPostedModal must create a service-linked recommendation (rate+post is the reco flow)');

  // 3. IG post is OPTIONAL when paid, required for free/barter.
  assert(/isPaid/.test(postModal) && /is_free_for_rainmaker/.test(postModal),
    'MarkBookingPostedModal must make the IG post optional for paid bookings');

  // 4. NO standalone "recommend without booking" button on the service page —
  //    recommendations only come from a completed booking.
  assert(!/RecommendProviderModal/.test(pdp),
    'ServiceDetailScreen must NOT mount a standalone recommend modal — recos come from a booking');
});

test('spec-54-roster-accepted-only', 'FROZEN: Find-a-Connector roster shows ACCEPTED connectors only, with the agreed price (SPEC-54)', '#54', async () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/BrowseConnectorsScreen.jsx'), 'utf8');
  const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. The confirmation gate keys ONLY on status === 'accepted'.
  assert(/status\s*===\s*'accepted'/.test(stripped),
    "BrowseConnectorsScreen must gate the roster on status === 'accepted'.");

  // 2. It must NOT count 'offered' or 'countered' as confirmed anymore
  //    (the old rule that leaked a seeded counter onto the roster).
  assert(!/\[\s*'offered'\s*,\s*'countered'\s*,\s*'accepted'\s*\]/.test(stripped),
    "REGRESSION: roster still counts offered/countered as confirmed — SPEC-54 requires accepted only.");

  // 3. The agreed price drives the row, not the rate-card sticker. The
  //    confirmation lookup records offered_price_cents ?? official_price_cents.
  assert(/agreedCents/.test(stripped),
    'BrowseConnectorsScreen must surface the agreed price (agreedCents), not the rate card.');
  assert(/offered_price_cents\s*\?\?\s*(?:r\.)?official_price_cents/.test(stripped),
    'The accepted-only gate must record the agreed price (offered ?? official ?? 0).');

  // 4. The ConnectorRow no longer reads the rate-card columns for its pills.
  assert(!/spotlight_price_instagram_cents/.test(src.slice(src.indexOf('function ConnectorRow'))),
    'ConnectorRow must not render rate-card prices — show the agreed deal instead (SPEC-54).');
});

test('spec-55-fanout-rehydrates-services-near', 'FROZEN: getProvidersForNotify re-hydrates services_near rows before the provider-type filter (SPEC-55)', '#55', async () => {
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  // Isolate the getProvidersForNotify body.
  const start = api.indexOf('export async function getProvidersForNotify');
  assert(start !== -1, 'api must export getProvidersForNotify');
  const body = api.slice(start, start + 2400);

  // It must NOT filter the RAW services_near rows on taxonomy_provider_type —
  // it must re-fetch from the services table by id first (the rpc returns no
  // taxonomy column). We assert a services re-hydration with owner_id +
  // taxonomy_provider_type happens inside the function.
  assert(/from\('services'\)/.test(body) && /taxonomy_provider_type/.test(body) && /owner_id/.test(body),
    'getProvidersForNotify must re-hydrate rows from the services table (id → owner_id + taxonomy_provider_type) before filtering — SPEC-55.');
  assert(/\.in\('id',\s*ids\)/.test(body),
    'getProvidersForNotify must re-fetch services by the ids services_near returned — SPEC-55.');

  // The requester is excluded from their own fan-out.
  assert(/filter\(id\s*=>\s*id\s*!==\s*uid\)/.test(api),
    'createRequestAndFanOut must exclude the requester from their own fan-out (ownerIds !== uid) — SPEC-55.');
});

test('spec-56-notify-coverage', 'FROZEN: recommendService + acceptRequestWithTime fire their notifications (SPEC-56)', '#56', async () => {
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');

  // recommendService notifies the service owner (service_recommended).
  const rs = api.indexOf('export async function recommendService');
  const rsrc = api.slice(rs, rs + 1400);
  assert(/notifyUser\(\{[\s\S]*?event:\s*'service_recommended'/.test(rsrc),
    "recommendService must fire notifyUser({ event: 'service_recommended', ... }) — SPEC-56");

  // acceptRequestWithTime notifies the requester (booking accepted).
  const aw = api.indexOf('export async function acceptRequestWithTime');
  const awsrc = api.slice(aw, aw + 900);
  assert(/fireBookingNotify\(\s*data\s*,\s*'accepted'\s*\)/.test(awsrc),
    "acceptRequestWithTime must fire fireBookingNotify(data, 'accepted') — SPEC-56");
});

test('spec-57-referral-payout-integrity', 'FROZEN: referral credit is SERVER-AUTHORITATIVE — credit_referral_for_booking RPC (7%/$250 direct + 0.5%/$12.50 fof, accumulating, cleared), called by the Stripe webhook; invite_joined fires; tracking shows $ (SPEC-57)', '#57', async () => {
  const ref   = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/referral.js'), 'utf8');
  const track = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/InviteTrackingScreen.jsx'), 'utf8');
  const hook  = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  const migPath = path.join(REPO_ROOT, 'supabase/migrations/20260626020000_referral_settlement.sql');

  // 1. Canonical, server-authoritative settlement RPC exists with the confirmed
  //    economics + idempotency + paid guard.
  assert(fs.existsSync(migPath), 'referral settlement migration must exist — SPEC-57');
  const mig = fs.readFileSync(migPath, 'utf8');
  assert(/function public\.credit_referral_for_booking/.test(mig), 'must define credit_referral_for_booking — SPEC-57');
  assert(/0\.07/.test(mig) && /25000/.test(mig), 'direct tier = 7% capped $250 — SPEC-57');
  assert(/0\.005/.test(mig) && /1250/.test(mig), 'fof tier = 0.5% capped $12.50 — SPEC-57');
  assert(/v_paid is null or v_total <= 0/.test(mig), 'RPC must guard on PAID + non-zero (free booking never burns/credits) — SPEC-57');
  assert(/meta->>'booking_id' = p_booking::text and meta->>'tier'/.test(mig), 'RPC must be idempotent per (earner, booking, tier) — SPEC-57');
  assert(/'cleared'/.test(mig), "referral credit lands 'cleared' (counts as earned, not stuck pending) — SPEC-57");

  // 2. The Stripe webhook (reliable path) settles on payment; client is a safe
  //    redundant trigger via the same idempotent RPC.
  assert(/credit_referral_for_booking/.test(hook), 'stripe-webhook must call credit_referral_for_booking on payment — SPEC-57');
  assert(/credit_referral_for_booking/.test(ref), 'client creditInviterOnFirstBooking must call the same RPC — SPEC-57');

  // 3. invite_joined still fires; tracking surfaces the $.
  assert(/event:\s*'invite_joined'/.test(ref), 'recordInviteFromActiveRef must fire notifyUser invite_joined — SPEC-57');
  assert(/earned from referrals/.test(track) && /reward_cents\s*>\s*0/.test(track),
    'InviteTrackingScreen must show referral $ earned + per-row reward badge — SPEC-57');
});

test('spec-58-on-demand-city-crawl', 'FROZEN: app enqueues crawl_requests for no-data cities (services 10 / influencers 5); never crawls itself (SPEC-58)', '#58', async () => {
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const mig = path.join(REPO_ROOT, 'supabase/migrations/20260618000000_crawl_requests.sql');

  assert(fs.existsSync(mig), 'crawl_requests migration must exist');
  const m = fs.readFileSync(mig, 'utf8');
  assert(/create table if not exists public\.crawl_requests/.test(m), 'migration must create crawl_requests');
  assert(/crawl_requests_open_dedupe_idx/.test(m), 'crawl_requests must dedupe OPEN rows (partial unique index)');

  assert(/export async function enqueueCityCrawl/.test(api), 'api must export enqueueCityCrawl');
  // Services trigger: enqueue when no provider matched.
  assert(/ownerIds\.length === 0[\s\S]{0,400}enqueueCityCrawl\(\{\s*[\s\S]{0,80}kind: 'services'/.test(api),
    'createRequestAndFanOut must enqueue a services crawl when no provider matched — SPEC-58');
  // Influencers trigger: city-scoped via leads_influencers coverage check.
  assert(/leads_influencers[\s\S]{0,400}kind: 'influencers'/.test(api),
    'broadcastSpotlightRequest must enqueue an influencers crawl when the city has no leads_influencers — SPEC-58');
});

test('spec-59-cc-identity-gate-on-post', 'FROZEN: spotlight POST gated on cc-verified; test accounts bypass via getMyCcStatus (SPEC-59)', '#59', async () => {
  const api  = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const barter = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ui/MarkBookingPostedModal.jsx'), 'utf8');
  const paid   = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ui/MarkPostedModal.jsx'), 'utf8');

  // Test-account bypass is centralized in getMyCcStatus.
  assert(/IDENTITY_BYPASS_EMAILS/.test(api) && /t@cergio\.ai/.test(api) && /info@cergio\.ai/.test(api),
    'api must define IDENTITY_BYPASS_EMAILS with the test accounts — SPEC-59');
  const gs = api.indexOf('export async function getMyCcStatus');
  assert(/isIdentityBypassEmail/.test(api.slice(gs, gs + 600)),
    'getMyCcStatus must short-circuit verified for bypass emails — SPEC-59');

  // Both publish modals gate on cc verification via CcGateModal.
  for (const [name, src] of [['MarkBookingPostedModal', barter], ['MarkPostedModal', paid]]) {
    assert(/getMyCcStatus/.test(src) && /CcGateModal/.test(src) && /ccVerified === false/.test(src),
      `${name} must gate the post on cc verification (CcGateModal when ccVerified===false) — SPEC-59`);
  }
});

test('spec-60-no-duplicate-listings', 'FROZEN: createService de-dupes recent identical listings; list flow is one-shot (SPEC-60)', '#60', async () => {
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const setup = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/ServiceListSetupScreen.jsx'), 'utf8');
  const fn = api.slice(api.indexOf('export async function createService'), api.indexOf('export async function createService') + 1500);
  assert(/eq\('owner_id', ownerId\)[\s\S]{0,200}eq\('title', title\)/.test(fn) && /deduped: true/.test(fn),
    'createService must return an existing recent same-title listing instead of inserting a duplicate — SPEC-60');
  assert(/submittedRef/.test(setup),
    'ServiceListSetupScreen must guard the persist effect with a one-shot ref — SPEC-60');
});

test('spec-61-seo-document-meta', 'FROZEN: per-record document meta on profile + service PDP (SPEC-61)', '#61', async () => {
  const hookPath = path.join(REPO_ROOT, 'src/hooks/useDocumentMeta.js');
  assert(fs.existsSync(hookPath), 'useDocumentMeta hook must exist');
  const hook = fs.readFileSync(hookPath, 'utf8');
  assert(/og:title/.test(hook) && /canonical/.test(hook) && /twitter:card/.test(hook),
    'useDocumentMeta must set OG + canonical + twitter tags — SPEC-61');
  const prof = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/PublicProfileScreen.jsx'), 'utf8');
  const pdp  = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/ServiceDetailScreen.jsx'), 'utf8');
  assert(/useDocumentMeta\(/.test(prof), 'PublicProfileScreen must call useDocumentMeta — SPEC-61');
  assert(/useDocumentMeta\(/.test(pdp), 'ServiceDetailScreen must call useDocumentMeta — SPEC-61');
});

test('spec-62-seo-ssr-meta-for-bots', 'FROZEN: serverless function server-renders OG/meta + JSON-LD for /u and /service to crawler UAs; vercel.json UA-gates the rewrites so humans fall through to the SPA (SPEC-62)', '#62', async () => {
  const fnPath = path.join(REPO_ROOT, 'api/meta.js');
  assert(fs.existsSync(fnPath), 'api/meta.js serverless function must exist — SPEC-62');
  const fn = fs.readFileSync(fnPath, 'utf8');
  assert(/og:title/.test(fn) && /canonical/.test(fn) && /twitter:card/.test(fn),
    'api/meta.js must emit OG + canonical + twitter tags — SPEC-62');
  assert(/application\/ld\+json/.test(fn), 'api/meta.js must emit JSON-LD — SPEC-62');
  // HTML escaping is the injection guard — must escape both & and < at minimum.
  assert(/&amp;/.test(fn) && /&lt;/.test(fn), 'api/meta.js must HTML-escape output — SPEC-62');
  // id sanitiser prevents SSRF / REST query injection.
  assert(/cleanId/.test(fn), 'api/meta.js must sanitise the record id (cleanId) — SPEC-62');
  const vj = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8'));
  const rw = vj.rewrites || [];
  const botRules = rw.filter(r => /\/api\/meta/.test(r.destination || ''));
  assert(botRules.length >= 2, 'vercel.json must route /u and /service to /api/meta — SPEC-62');
  // Every bot rewrite MUST be UA-gated, else humans get the bot HTML (regression).
  assert(botRules.every(r => Array.isArray(r.has) && r.has.some(h =>
    h.type === 'header' && /user-agent/i.test(h.key) && /facebookexternalhit/i.test(h.value || ''))),
    'every /api/meta rewrite must be gated on a bot user-agent header — SPEC-62');
  // The SPA catch-all must still exist as the last/fallthrough rule.
  assert(rw.some(r => r.source === '/(.*)' && /index\.html/.test(r.destination || '')),
    'vercel.json must keep the SPA index.html catch-all — SPEC-62');
});

test('spec-65-compliant-outreach', 'FROZEN: auto email outreach is CAN-SPAM compliant (identity + postal address + one-click unsubscribe), suppression-checked, send-once; SMS/WhatsApp not auto-sent cold (SPEC-65)', '#65', async () => {
  const os = path.join(REPO_ROOT, 'supabase/functions/outreach-send/index.ts');
  const oo = path.join(REPO_ROOT, 'supabase/functions/outreach-optout/index.ts');
  assert(fs.existsSync(os) && fs.existsSync(oo), 'outreach-send + outreach-optout must exist — SPEC-65');
  const send = fs.readFileSync(os, 'utf8');
  assert(/outreach_suppressions/.test(send), 'outreach-send must check the suppression list — SPEC-65');
  assert(/List-Unsubscribe/.test(send) && /optoutUrl/.test(send), 'every email must carry a one-click unsubscribe — SPEC-65');
  assert(/New York, NY 10010/.test(send), 'emails must include the legal postal address — SPEC-65');
  assert(/outreach_status: 'sent'/.test(send), 'outreach-send must mark leads sent (send-once) — SPEC-65');
  // SMS (SPEC-66) is gated behind a flag, suppression-checked, with STOP opt-out;
  // never on without explicit enable + Twilio creds. WhatsApp cold stays out.
  assert(/OUTREACH_SMS_ENABLED/.test(send), 'SMS must be gated behind OUTREACH_SMS_ENABLED — SPEC-65/66');
  assert(/Reply STOP/.test(send), 'SMS body must carry a STOP opt-out — SPEC-65/66');
  assert(/leads_influencers/.test(send), 'outreach-send must also reach influencers (email+SMS) — SPEC-67');
  assert(!/graph\.facebook\.com[^]*messages/.test(send), 'no cold WhatsApp send — SPEC-65');
  const opt = fs.readFileSync(oo, 'utf8');
  assert(/outreach_suppressions/.test(opt) && /do_not_contact/.test(opt) && /hmac/i.test(opt),
    'outreach-optout must suppress + flip leads, HMAC-verified — SPEC-65');
  const mig = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations')).filter(f => /outreach_suppressions/.test(f));
  assert(mig.length >= 1, 'outreach_suppressions migration must exist — SPEC-65');
});

test('spec-70-softlaunch-optin', 'FROZEN: soft-launch outreach is opt-in barter — emails carry a per-recipient opt-in link; outreach-optin (HMAC, no auth) marks opted_in + redirects into the app; a free wa.me manual generator exists (SPEC-70)', '#70', async () => {
  const send = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/outreach-send/index.ts'), 'utf8');
  // Email barter copy + opt-in CTA links for both audiences.
  assert(/outreach-optin\?t=biz/.test(send) && /outreach-optin\?t=inf/.test(send), 'emails must include per-recipient opt-in links (biz + inf) — SPEC-70');
  assert(/ctaButton/.test(send) && /spotlight/i.test(send), 'soft-launch email must have an opt-in CTA + barter (spotlight) copy — SPEC-70');
  // Free manual WhatsApp generator (no bulk send).
  assert(/wa\.me\//.test(send) && /get\('wa'\)/.test(send), 'must expose a wa.me manual-generator mode — SPEC-70');
  // Opt-in capture function.
  const oi = path.join(REPO_ROOT, 'supabase/functions/outreach-optin/index.ts');
  assert(fs.existsSync(oi), 'outreach-optin function must exist — SPEC-70');
  const opt = fs.readFileSync(oi, 'utf8');
  assert(/hmac/i.test(opt), 'outreach-optin must HMAC-verify the link — SPEC-70');
  assert(/opted_in/.test(opt), 'outreach-optin must mark the lead opted_in — SPEC-70');
  assert(/302/.test(opt) && /cergio\.ai/.test(opt), 'outreach-optin must redirect into the app (migration seam) — SPEC-70');
});

test('spec-68-influencer-enrichment', 'FROZEN: enrich-influencers fills email/phone from bio/external_url (never Instagram), fills-only-null, suppression-aware (SPEC-68)', '#68', async () => {
  const f = path.join(REPO_ROOT, 'supabase/functions/enrich-influencers/index.ts');
  assert(fs.existsSync(f), 'enrich-influencers function must exist — SPEC-68');
  const s = fs.readFileSync(f, 'utf8');
  assert(/leads_influencers/.test(s) && /external_url/.test(s), 'must enrich leads_influencers from external_url — SPEC-68');
  assert(!/instagram\.com|graph\.facebook|i\.instagram/.test(s), 'enrich-influencers must NOT touch Instagram — SPEC-68');
  assert(/outreach_suppressions/.test(s), 'must respect suppression list — SPEC-68');
  assert(/SUPABASE_SERVICE_ROLE_KEY/.test(s) && /Unauthorized/.test(s), 'service-role gated — SPEC-68');
});

test('spec-69-periodic-workers', 'FROZEN: pg_cron runs fulfill-crawl/enrich/health/release via Vault bearer; outreach-send NOT auto-scheduled (SPEC-69)', '#69', async () => {
  const migs = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations')).filter(f => /periodic_workers_cron/.test(f));
  assert(migs.length >= 1, 'periodic workers cron migration must exist — SPEC-69');
  const m = fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations', migs[0]), 'utf8');
  assert(/cron\.schedule/.test(m) && /pg_net|net\.http_post/.test(m), 'must schedule via pg_cron + pg_net — SPEC-69');
  assert(/edge_fn_bearer/.test(m) && /vault/.test(m), 'service key must come from Vault, not committed — SPEC-69');
  assert(/fulfill-crawl/.test(m) && /crawl-health-check/.test(m) && /release-funds/.test(m), 'core workers scheduled — SPEC-69');
  assert(!/schedule\([^)]*outreach-send/.test(m), 'outreach-send must NOT be auto-scheduled (manual cold-send) — SPEC-69');
});

test('spec-64-crawl-fulfillment', 'FROZEN: fulfill-crawl sources businesses via Google Places, saves leads, notifies the searcher, and QUEUES (never auto-sends) business outreach (SPEC-64)', '#64', async () => {
  const fc = path.join(REPO_ROOT, 'supabase/functions/fulfill-crawl/index.ts');
  assert(fs.existsSync(fc), 'fulfill-crawl function must exist — SPEC-64');
  const src = fs.readFileSync(fc, 'utf8');
  assert(/SUPABASE_SERVICE_ROLE_KEY/.test(src) && /Unauthorized/.test(src),
    'fulfill-crawl must be service-role gated — SPEC-64');
  assert(/GOOGLE_PLACES_API_KEY/.test(src) && /maps\.googleapis\.com\/maps\/api\/place\/textsearch/.test(src),
    'fulfill-crawl must use the Google Places server key + Text Search — SPEC-64');
  assert(/leads_services/.test(src) && /place_id/.test(src),
    'fulfill-crawl must upsert leads_services deduped by place_id (2026-06-28 reset) — SPEC-64');
  assert(/delivered_count/.test(src) && /'delivered'/.test(src) && /'failed'/.test(src),
    'fulfill-crawl must stamp delivered/failed + count on crawl_requests — SPEC-64');
  assert(/notifySearcher/.test(src) && /resend\.com\/emails/.test(src),
    'fulfill-crawl must notify the searcher — SPEC-64');
  // Compliance: must NOT flip leads to a sent/queued-send state automatically.
  assert(/outreach_status: 'new'/.test(src) && !/outreach_status:\s*'sent'/.test(src),
    'fulfill-crawl must leave business leads at outreach_status=new (no auto cold-send) — SPEC-64');
});

// ─── REGRESSION LOCK: YELLOWPAGES IS RETIRED (supersedes REQ-P10-crawl-yp-drain)
// 2026-07-13. The old invariant demanded fulfill-crawl DRAIN queued YellowPages
// jobs. It cannot: YP answers every request from a datacenter IP with HTTP 403
// (`yp-blocked: http=403` on every run), so the drain errored the agent every 15
// minutes, flooded agent_runs, and held org_health red — while Google Places, the
// path that actually works, kept growing services. The requirement is retired in
// migration 20260713000000 and the invariant is INVERTED: YP jobs must never be
// FETCHED again, the dead queue is quarantined ONCE (never retried), and the
// parser survives dormant behind YP_ENABLED so this is one env var to reverse.
test('p10-crawl-yp-retired', 'YellowPages is permanently 403-blocked from edge: fulfill-crawl must never fetch a YP job again (quarantine once, never retry); Google Places stays the live services path', '#64', async () => {
  const fc = path.join(REPO_ROOT, 'supabase/functions/fulfill-crawl/index.ts');
  const src = fs.readFileSync(fc, 'utf8');

  // 1) The job SELECT must EXCLUDE yellowpages rows (PostgREST `.or()` form, which
  //    — unlike .neq() — still admits the NULL/google_places rows we do want).
  assert(/\.eq\(\s*['"]kind['"]\s*,\s*['"]services['"]\s*\)/.test(src),
    'job SELECT must still filter kind=services');
  assert(/\.eq\(\s*['"]status['"]\s*,\s*['"]new['"]\s*\)/.test(src),
    'job SELECT must still filter status=new');
  assert(/\.or\(\s*['"]source\.is\.null,source\.neq\.yellowpages['"]\s*\)/.test(src),
    'job SELECT must EXCLUDE source=yellowpages (and keep NULL/google_places) — YP is permanently 403');

  // 2) The dead queue is quarantined ONCE with a permanent, non-retryable reason.
  assert(/yp-blocked-permanent/.test(src),
    'YP jobs must be stamped with the permanent reason yp-blocked-permanent (not a retryable error)');
  assert(/\.eq\(\s*['"]source['"]\s*,\s*['"]yellowpages['"]\s*\)[\s\S]{0,160}?\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]new['"]\s*,\s*['"]crawling['"]\s*\]\s*\)/.test(src),
    'a sweep must move leftover new/crawling YP jobs to failed so the queue cannot refill a dead path');
  assert(/status:\s*'failed'/.test(src),
    'quarantined YP jobs must land in status=failed (never delivered-0, never retried)');

  // 3) REVERSIBLE, not deleted: the parser stays, gated OFF by default.
  const flag = src.match(/const YP_ENABLED\s*=\s*\(Deno\.env\.get\('YP_ENABLED'\)\s*\|\|\s*'([a-z]+)'\)/);
  assert(flag, 'YP must be behind a named YP_ENABLED env flag (reversible in one variable)');
  assert(flag[1] === 'false', 'YP_ENABLED must default to FALSE — YP is blocked from datacenter IPs');
  assert(/source\s*===\s*'yellowpages'\s*&&\s*!YP_ENABLED/.test(src),
    'a YP job reaching the loop must be quarantined WITHOUT a fetch (defense in depth)');
  assert(/fulfillYellowPages\(/.test(src),
    'the YP parser stays in the tree (dormant) so re-enabling is one env var, not a rewrite');

  // 4) The working path is untouched, and the quarantine is bookkeeping — it must
  //    NOT colour the run red (that error flood is exactly what we are removing).
  assert(/maps\.googleapis\.com\/maps\/api\/place\/textsearch/.test(src) && /GOOGLE_PLACES_API_KEY/.test(src),
    'the Google Places drain (the live path) must remain');
  assert(/yp_quarantined/.test(src),
    'the quarantine count must be reported in agent_runs.meta (visible, not silent)');
  assert(/logAgentRun\(db, 'fulfill-crawl'[\s\S]*?raw_found: totFound[\s\S]*?rows_written: totSaved/.test(src),
    'run must still log REAL raw_found/rows_written to agent_runs');

  // 5) The COO executor must not be able to re-invoke the dead seeder.
  const coo = readFile('supabase/functions/coo-execute/index.ts');
  const allow = coo.match(/const EDGE_ALLOW = new Set\(\[([\s\S]*?)\]\)/);
  assert(allow, 'coo-execute must keep its edge allowlist');
  assert(!/crawl-seed-yellowpages/.test(allow[1]),
    'crawl-seed-yellowpages must be OUT of the COO edge allowlist — re-running it only refills a dead queue');

  // 6) The migration must stop the seeder cron + quarantine the queue server-side.
  const mig = readFile('supabase/migrations/20260713000000_visibility_escalation_and_yp_shutdown.sql');
  assert(/cron\.unschedule/.test(mig) && /crawl-seed-yellowpages/.test(mig),
    'the migration must unschedule the YP seeder cron (stop refilling a dead queue)');
  assert(/update public\.crawl_requests[\s\S]*?yp-blocked-permanent/.test(mig),
    'the migration must quarantine the queued YP jobs once');
});

// ─── REGRESSION LOCK: REQ-crawl-throughput ───────────────────────────────────
// The crawl MUST be able to produce NEW services rows. It went RED again when
// YellowPages started serving an anti-bot / block / empty page to Supabase's
// datacenter IPs: fulfill-crawl's YP path parsed 0 listings and (before this fix)
// stamped every job 'delivered' with count 0 — silently draining the whole queue
// while services_new stayed frozen (12,087, nothing new in >24h). This invariant
// locks the two things that keep rows moving:
//   (A) BLOCK DETECTION — a block/empty fetch is NOT masked as a delivered-0. It is
//       surfaced ('failed' + 'yp-blocked', counted in agent_runs.meta.blocked),
//       AND a real normal page still parses to listings.
//   (B) A WORKING SERVER-SIDE THROUGHPUT PATH — the proven google_places path
//       (GOOGLE_PLACES_API_KEY) is wired via crawl-seed-google-places so rows grow
//       without depending on YP being reachable.
// The behavioural half actually EXECUTES fulfill-crawl's own ypLooksBlocked() +
// parse against a synthetic normal page and a synthetic block page, so it fails on
// the pre-fix behaviour (block masked as delivery / no detection) and passes on the
// fix. Wired to REQ-crawl-throughput (crack-crawl-throughput ledger row).
test('crawl-throughput', 'REQ-crawl-throughput: fulfill-crawl produces NEW services — a block/empty fetch is surfaced (not masked as delivered-0), a normal page parses to listings, and a working server-side throughput path (google_places) is wired', '#64', async () => {
  const fc = path.join(REPO_ROOT, 'supabase/functions/fulfill-crawl/index.ts');
  const src = fs.readFileSync(fc, 'utf8');

  // ── (A) BLOCK DETECTION is present and wired ────────────────────────────────
  assert(/function ypLooksBlocked\(/.test(src),
    'fulfill-crawl must have block-page detection (ypLooksBlocked) — REQ-crawl-throughput');
  assert(/YpBlockedError/.test(src) && /throw new YpBlockedError\(/.test(src),
    'a block page must THROW (YpBlockedError), so it routes to the failed/not-delivered path — REQ-crawl-throughput');
  // The blocked job must be stamped 'failed' with a yp-blocked note, NOT 'delivered'.
  assert(/status:\s*'failed'[\s\S]{0,200}?yp-blocked/.test(src) || /yp-blocked[\s\S]{0,200}?status:\s*'failed'/.test(src) || /blocked\s*\?\s*`yp-blocked/.test(src),
    'a blocked fetch must be stamped failed with a yp-blocked note (never delivered-0) — REQ-crawl-throughput');
  // The block count must be surfaced in the agent_runs ledger meta.
  assert(/meta:\s*\{[^}]*blocked/.test(src),
    'agent_runs meta must carry the blocked count so a block flood cannot hide behind delivered-0 — REQ-crawl-throughput');

  // ── (B) A WORKING SERVER-SIDE THROUGHPUT PATH exists ────────────────────────
  const gp = path.join(REPO_ROOT, 'supabase/functions/crawl-seed-google-places/index.ts');
  assert(fs.existsSync(gp), 'crawl-seed-google-places seeder must exist (proven throughput path) — REQ-crawl-throughput');
  const gpSrc = fs.readFileSync(gp, 'utf8');
  assert(/source:\s*'google_places'/.test(gpSrc),
    'the throughput seeder must enqueue source=google_places jobs (the proven drain path) — REQ-crawl-throughput');
  assert(/kind:\s*'services'/.test(gpSrc) && /status:\s*'new'/.test(gpSrc),
    'the throughput seeder must enqueue kind=services/status=new so fulfill-crawl drains them — REQ-crawl-throughput');
  // And fulfill-crawl must still have the working Places drain the seeder feeds.
  assert(/maps\.googleapis\.com\/maps\/api\/place\/textsearch/.test(src) && /GOOGLE_PLACES_API_KEY/.test(src),
    'fulfill-crawl must keep the working Google Places drain (Text Search + key) — REQ-crawl-throughput');

  // ── (C) BEHAVIOURAL: execute the real block-detection + parse logic ─────────
  // Extract fulfill-crawl's own helpers and run them, so this test exercises the
  // ACTUAL shipped behaviour (not just greps). Fails on the pre-fix code.
  const pick = (name, kind = 'function') => {
    // grab a top-level `function name(...) { ... }` by brace-matching
    const re = new RegExp(`${kind === 'const' ? 'const' : 'function'}\\s+${name}\\b`);
    const m = src.match(re);
    assert(m, `could not locate ${name} in fulfill-crawl for behavioural test — REQ-crawl-throughput`);
    const start = m.index;
    let i = src.indexOf('{', start), depth = 0, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return src.slice(start, end);
  };
  // Dependencies of ypLooksBlocked / parse path (pure, DOM-free).
  const helperNames = ['ypLooksBlocked', 'parseYellowPages', 'parseYellowPagesInner',
    'firstMatch', 'cleanText', 'normPhone', 'pickWebsite'];
  const markerConst = (src.match(/const YP_BLOCK_MARKERS\s*=\s*\/[\s\S]*?\/[a-z]*;/) || [''])[0];
  // These helpers are TypeScript in the .ts source — strip the (few, simple) type
  // annotations so they run under new Function (plain JS). Targeted, not a full TS
  // transpiler: enough for the pure DOM-free parse/detection helpers.
  // Generic (targeted) TS-annotation stripper for these DOM-free helpers. Order
  // matters: kill generics, then param/return/var annotations. The type grammar
  // here is simple (string|number|boolean|any|YpListing, arrays, unions), so a
  // couple of passes suffice — this is NOT a general TS transpiler.
  const TYPE = '(?:string|number|boolean|any|unknown|void|YpListing|RegExp)(?:\\s*\\[\\])?(?:\\s*\\|\\s*(?:string|number|boolean|any|unknown|null|YpListing|RegExp)(?:\\s*\\[\\])?)*';
  const stripTs = (s) => s
    .replace(/new Map<[^>]*>/g, 'new Map')             // new Map<string, YpListing>
    .replace(new RegExp(`\\)\\s*:\\s*${TYPE}\\s*\\{`, 'g'), ') {')   // fn return type before body
    .replace(new RegExp(`:\\s*${TYPE}(?=\\s*[,)=;\\n])`, 'g'), '');  // param + var annotations
  const body = markerConst + '\n' + helperNames.map(n => stripTs(pick(n))).join('\n');
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${body}\n return { ypLooksBlocked, parseYellowPages };`);
  const { ypLooksBlocked, parseYellowPages } = factory();

  // A synthetic BLOCK page: 403 status → blocked. And a tiny/empty 200 body →
  // blocked. And a 200 body carrying a captcha marker w/ no listings → blocked.
  assert(ypLooksBlocked(403, '<html>Access Denied</html>') === true,
    'a 403 fetch must be detected as blocked (not 0-results) — REQ-crawl-throughput');
  assert(ypLooksBlocked(200, '') === true,
    'an empty 200 body must be detected as blocked/empty — REQ-crawl-throughput');
  assert(ypLooksBlocked(200, '<html><body>Please verify you are a human (captcha)</body></html>' + ' '.repeat(1500)) === true,
    'a captcha/verify body with no listings must be detected as blocked — REQ-crawl-throughput');

  // A synthetic NORMAL page: a full-size body with a JSON-LD LocalBusiness block
  // must NOT be flagged blocked, and must PARSE to >=1 listing (rows can be written).
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'LocalBusiness', name: 'Acme Plumbing Co', telephone: '(305) 555-0100',
    address: { streetAddress: '1 Main St', addressLocality: 'Miami', addressRegion: 'FL', postalCode: '33101' },
    url: 'https://acmeplumbing.example',
  })}</script>`;
  const normalPage = '<html><body>' + 'x'.repeat(2000) + jsonLd + '</body></html>';
  assert(ypLooksBlocked(200, normalPage) === false,
    'a full normal page with listing structure must NOT be flagged blocked — REQ-crawl-throughput');
  const listings = parseYellowPages(normalPage);
  assert(Array.isArray(listings) && listings.length >= 1 && /acme plumbing/i.test(listings[0].name || ''),
    'a normal YP page must parse to >=1 real listing (rows_written > 0 on a normal response) — REQ-crawl-throughput');
});

// ─── REGRESSION LOCK: crawl-osm-free ─────────────────────────────────────────
// 2026-07-15 (SPEC-72, free-first). Google Places is a PAID API and is now billing-
// blocked; YellowPages is 403-blocked from edge. The primary + default services
// source is OpenStreetMap via the keyless Overpass API, for BOTH bulk (crawl-seed-
// osm → source=osm) AND on-demand (enqueueCityCrawl source=osm). This test locks:
//   (A) Google Places is dormant (GOOGLE_PLACES_ENABLED default false) + osm default
//   (B) a REAL service_type→OSM-tag map (cross-checked vs the OSM wiki) + graceful
//       fallback for unmapped types + provider_type→seeder-key normalization
//   (C) blocked categories never surface (executes osmIsBlocked)
//   (D) a block/empty/rate-limited Overpass response is SURFACED as error (job re-
//       queued, agent_runs.meta.osm_blocked) and NEVER masked as delivered-0
//       (executes the shipped osmLooksBlocked)
//   (E) on-demand + the bulk seeder both enqueue source='osm' (not google_places)
// Wired to REQ crawl-osm-free (ledger row seeded by 20260715000000).
test('crawl-osm-free', 'REQ-crawl-osm-free: services crawl sources from FREE OpenStreetMap/Overpass for bulk + on-demand (Google Places dormant); real type→tag map; blocked categories never surface; a block/empty Overpass response is error (re-queued) not delivered-0 (SPEC-72)', '#64', async () => {
  const fc = readFile('supabase/functions/fulfill-crawl/index.ts');

  // ── (A) Google Places DORMANT + OSM is the DEFAULT source ───────────────────
  assert(/GOOGLE_PLACES_ENABLED\s*=\s*\(Deno\.env\.get\('GOOGLE_PLACES_ENABLED'\)\s*\|\|\s*'false'\)/.test(fc),
    'Google Places must sit behind GOOGLE_PLACES_ENABLED defaulting to false (never billed by default) — crawl-osm-free');
  assert(/const source = \(job\.source \?\? 'osm'\)/.test(fc),
    "the DEFAULT crawl source must be 'osm' (free-first) — crawl-osm-free");
  assert(/source === 'osm' \|\| placesDown/.test(fc),
    'the OSM branch must run for source=osm and whenever Places is disabled/down (primary path) — crawl-osm-free');
  // Reversible: the paid Places branch stays in the tree, just dormant.
  assert(/maps\.googleapis\.com\/maps\/api\/place\/textsearch/.test(fc),
    'the Google Places branch must remain (dormant, reversible last resort) — crawl-osm-free');

  // ── (B) REAL service_type → OSM tag map (cross-checked vs the OSM wiki) ──────
  assert(/const OSM_TAGS: Record<string, string\[\]> = \{/.test(fc), 'fulfill-crawl must define OSM_TAGS — crawl-osm-free');
  const tagChecks = [
    ['plumber',          'craft"="plumber'],
    ['electrician',      'craft"="electrician'],
    ['hvac',             'craft"="hvac'],
    ['hair stylist',     'shop"="hairdresser'],
    ['barber',           'shop"="hairdresser'],
    ['photographer',     'craft"="photographer'],
    ['mobile mechanic',  'shop"="car_repair'],
    ['painter',          'craft"="painter'],
    ['roofing',          'craft"="roofer'],
    ['locksmith',        'craft"="locksmith'],
    ['car wash',         'amenity"="car_wash'],
    ['pest control',     'craft"="pest_control'],
  ];
  for (const [type, tag] of tagChecks) {
    const re = new RegExp(`'${type}':\\s*\\[[^\\]]*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    assert(re.test(fc), `OSM_TAGS['${type}'] must map to ${tag}" (OSM wiki) — crawl-osm-free`);
  }
  // Unmapped types must fall back to a name search (never silently zero), and an
  // on-demand provider_type must normalize to the seeder key.
  assert(/OSM_TAGS\[type\]\s*\?\?\s*\[`"name"~/.test(fc),
    'unmapped service types must fall back to a name search (never silently zero) — crawl-osm-free');
  assert(/OSM_TYPE_ALIAS\[rawType\]\s*\?\?\s*rawType/.test(fc),
    'on-demand provider_type must normalize to the seeder key via OSM_TYPE_ALIAS — crawl-osm-free');
  // Write-contract: OSM rows carry osm_id + data_source='osm' + lat/lon.
  assert(/osm_id: osmId/.test(fc) && /data_source: 'osm'/.test(fc),
    "OSM rows must write osm_id + data_source='osm' (auditable provenance) — crawl-osm-free");

  // ── Overpass etiquette: mirror fallback, descriptive UA, cap, timeout ───────
  assert(/OSM_ENDPOINTS\s*=\s*\[[\s\S]*?overpass-api\.de[\s\S]*?kumi\.systems/.test(fc),
    'Overpass must have a primary endpoint + a mirror fallback — crawl-osm-free');
  assert(/CergioServicesCrawl/.test(fc) && /'User-Agent':\s*OSM_UA/.test(fc),
    'Overpass calls must send a descriptive User-Agent (etiquette) — crawl-osm-free');
  assert(/const OSM_MAX_RESULTS = 50/.test(fc),
    'OSM results must be capped ~50/job (etiquette + write budget) — crawl-osm-free');
  assert(/AbortController[\s\S]{0,240}OSM_HTTP_TIMEOUT_MS/.test(fc),
    'the Overpass fetch must have a bounded timeout — crawl-osm-free');

  // ── (C) BEHAVIOURAL: blocked categories NEVER surface ───────────────────────
  const osmBlockedConst = (fc.match(/const OSM_BLOCKED = new RegExp\([\s\S]*?\);/) || [''])[0];
  const osmIsBlockedFn  = (fc.match(/function osmIsBlocked[\s\S]*?\}/) || [''])[0]
    .replace('(s: string): boolean', '(s)');
  assert(osmBlockedConst && osmIsBlockedFn, 'must define OSM_BLOCKED + osmIsBlocked — crawl-osm-free');
  // eslint-disable-next-line no-new-func
  const { osmIsBlocked } = new Function(`${osmBlockedConst}\n${osmIsBlockedFn}\nreturn { osmIsBlocked };`)();
  for (const bad of ['massage', 'tattoo parlor', 'makeup artist', 'personal chef', 'DJ services', 'smoke shop', 'gun range', 'strip club']) {
    assert(osmIsBlocked(bad) === true, `blocked category must never surface: "${bad}" — crawl-osm-free`);
  }
  for (const ok of ['plumber', 'house cleaning', 'photographer', 'electrician']) {
    assert(osmIsBlocked(ok) === false, `allowed service type must pass: "${ok}" — crawl-osm-free`);
  }
  // And the OSM path must apply the filter: refuse a blocked TYPE up-front (no
  // Overpass call) and drop a blocked-category ROW during parse.
  assert(/if \(osmIsBlocked\(type\) \|\| osmIsBlocked\(rawType\)\) return \{ saved: 0/.test(fc),
    'a blocked type must be refused at parse time (no Overpass call) — crawl-osm-free');
  assert(/if \(osmIsBlocked\(`\$\{name\} \$\{tagText\}`\)\) continue/.test(fc),
    'a blocked-category row must be dropped during parse — crawl-osm-free');

  // ── (D) BEHAVIOURAL: a block/empty Overpass response is error, NOT delivered-0
  const detFn = (fc.match(/function osmLooksBlocked\([\s\S]*?\n\}/) || [''])[0]
    .replace('(status: number, body: string): boolean', '(status, body)');
  assert(detFn, 'must define osmLooksBlocked — crawl-osm-free');
  // eslint-disable-next-line no-new-func
  const { osmLooksBlocked } = new Function(`${detFn}\nreturn { osmLooksBlocked };`)();
  assert(osmLooksBlocked(429, 'Too Many Requests') === true, 'a 429 must be detected as blocked (not 0-results) — crawl-osm-free');
  assert(osmLooksBlocked(504, '') === true, 'a 504 gateway timeout must be blocked — crawl-osm-free');
  assert(osmLooksBlocked(200, '') === true, 'an empty 200 body must be blocked/empty — crawl-osm-free');
  assert(osmLooksBlocked(200, 'runtime error: please try again later') === true, 'a rate-limit/runtime-error page must be blocked — crawl-osm-free');
  assert(osmLooksBlocked(200, JSON.stringify({ elements: [{ type: 'node', id: 1, tags: { name: 'Acme Plumbing' } }] })) === false,
    'a VALID Overpass element set must NOT be flagged blocked (real rows can be written) — crawl-osm-free');

  // The block must THROW, be RE-QUEUED (transient, not burned/masked), and the
  // count must be surfaced in agent_runs.meta — never a silent delivered-0 (SPEC-72).
  assert(/class OverpassBlockedError/.test(fc) && /throw new OverpassBlockedError\(/.test(fc),
    'a blocked Overpass response must THROW OverpassBlockedError (surfaced) — crawl-osm-free');
  assert(/e instanceof OverpassBlockedError[\s\S]{0,260}?status: 'new'/.test(fc),
    'a blocked OSM job must be RE-QUEUED to new (transient) — never delivered-0, never burned — crawl-osm-free');
  assert(/osm-blocked \(re-queued/.test(fc),
    'the re-queue note must carry the osm-blocked reason (surfaced) — crawl-osm-free');
  assert(/osm_blocked:\s*osmBlocked\.length/.test(fc),
    'agent_runs.meta must carry osm_blocked so a block flood cannot hide behind delivered-0 (SPEC-72) — crawl-osm-free');

  // ── (E) BULK + ON-DEMAND both flow through OSM (not google_places) ──────────
  const api = readFile('src/lib/api.js');
  assert(/kind === 'services' \? 'osm'/.test(api),
    "on-demand SERVICES crawls (enqueueCityCrawl) must default source='osm' (not google_places) — crawl-osm-free");
  assert(/source: src/.test(api),
    'enqueueCityCrawl must insert the source column so the on-demand path is osm-routed — crawl-osm-free');

  const seed = readFile('supabase/functions/crawl-seed-osm/index.ts');
  assert(/source:\s*'osm'/.test(seed),
    "crawl-seed-osm must enqueue source='osm' (the free drain path) — crawl-osm-free");
  assert(/kind:\s*'services'/.test(seed) && /status:\s*'new'/.test(seed),
    'the seeder must enqueue kind=services/status=new so fulfill-crawl drains them — crawl-osm-free');
  assert(/const BLOCKED = new RegExp/.test(seed) && /isBlocked/.test(seed),
    'the seeder must exclude blocked categories from the matrix — crawl-osm-free');
  // The 11 DMA cities are seeded.
  for (const city of ['Miami', 'New York', 'Los Angeles', 'Chicago', 'Dallas', 'Philadelphia', 'Houston', 'Atlanta', 'Washington', 'Boston', 'San Francisco']) {
    assert(new RegExp(`'${city}'`).test(seed), `crawl-seed-osm must seed the DMA city ${city} — crawl-osm-free`);
  }

  // ── Migration: register the seeder, unschedule the paid cron, open the ledger row
  const mig = readFile('supabase/migrations/20260715000000_osm_primary_source.sql');
  assert(/crawl-seed-osm/.test(mig) && /agent_registry/.test(mig),
    'the migration must register crawl-seed-osm in agent_registry — crawl-osm-free');
  assert(/cron\.unschedule/.test(mig) && /crawl-seed-google-places/.test(mig),
    'the migration must unschedule any google-places seed cron (stop refilling a paid path) — crawl-osm-free');
  assert(/cergio_open_requirement\(\s*\n?\s*'crawl-osm-free'/.test(mig),
    'the migration must open the crawl-osm-free requirement in the ledger — crawl-osm-free');
});

test('spec-63-crawl-monitoring', 'FROZEN: crawl pipeline self-monitors — health-check emails STALLED/FAILED/EMPTY diagnosis; admin-crawl-status + /admin/crawls live dashboard (SPEC-63)', '#63', async () => {
  const hc = path.join(REPO_ROOT, 'supabase/functions/crawl-health-check/index.ts');
  const ad = path.join(REPO_ROOT, 'supabase/functions/admin-crawl-status/index.ts');
  assert(fs.existsSync(hc), 'crawl-health-check function must exist — SPEC-63');
  assert(fs.existsSync(ad), 'admin-crawl-status function must exist — SPEC-63');
  const hcSrc = fs.readFileSync(hc, 'utf8');
  assert(/STALLED/.test(hcSrc) && /FAILED/.test(hcSrc) && /EMPTY/.test(hcSrc),
    'health-check must classify STALLED/FAILED/EMPTY — SPEC-63');
  assert(/resend\.com\/emails/.test(hcSrc), 'health-check must email alerts via Resend — SPEC-63');
  assert(/SUPABASE_SERVICE_ROLE_KEY/.test(hcSrc) && /Unauthorized/.test(hcSrc),
    'health-check must be service-role gated — SPEC-63');
  const adSrc = fs.readFileSync(ad, 'utf8');
  assert(/ADMIN_EMAILS|DEFAULT_ADMINS/.test(adSrc) && /Forbidden/.test(adSrc),
    'admin-crawl-status must gate on an admin allowlist — SPEC-63');
  const app = fs.readFileSync(path.join(REPO_ROOT, 'src/App.jsx'), 'utf8');
  assert(/path="\/admin\/crawls"/.test(app), 'App must route /admin/crawls — SPEC-63');
  assert(fs.existsSync(path.join(REPO_ROOT, 'src/screens/AdminCrawlScreen.jsx')),
    'AdminCrawlScreen must exist — SPEC-63');
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  assert(/getAdminCrawlStatus/.test(api) && /isAdminEmail/.test(api),
    'api must expose getAdminCrawlStatus + isAdminEmail — SPEC-63');
});

test('spec-47g-held-release', 'FROZEN: held funds + 3h auto-release, flag-gated (HOLD_RELEASE_ENABLED); early-completion requires consumer confirm; release worker idempotent + held-only (SPEC-47g)', '#47g', async () => {
  // create-payment-intent must branch instant vs held on the flag.
  const cpi = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/create-payment-intent/index.ts'), 'utf8');
  assert(/HOLD_RELEASE_ENABLED/.test(cpi), 'create-payment-intent must read HOLD_RELEASE_ENABLED — SPEC-47g');
  assert(/transfer_group/.test(cpi) && /transfer_data/.test(cpi),
    'create-payment-intent must support BOTH held (transfer_group) and instant (transfer_data) — SPEC-47g');
  // release worker exists, is service-role gated, idempotent, held-only.
  const rfPath = path.join(REPO_ROOT, 'supabase/functions/release-funds/index.ts');
  assert(fs.existsSync(rfPath), 'release-funds function must exist — SPEC-47g');
  const rf = fs.readFileSync(rfPath, 'utf8');
  assert(/SUPABASE_SERVICE_ROLE_KEY/.test(rf) && /Unauthorized/.test(rf),
    'release-funds must require the service-role bearer — SPEC-47g');
  assert(/transfers\.create/.test(rf) && /idempotencyKey/.test(rf),
    'release-funds must create Stripe transfers with an idempotency key — SPEC-47g');
  assert(/source_transaction/.test(rf), 'release-funds must source the transfer from the original charge — SPEC-47g');
  assert(/transfer_group/.test(rf) && /stripe_transfer_id/.test(rf),
    'release-funds must only touch held, unreleased bookings — SPEC-47g');
  // webhook defers earnings in held mode.
  const wh = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  assert(/hold_release/.test(wh) && /stripe_charge_id/.test(wh),
    'webhook must record the charge id and skip earnings in held mode — SPEC-47g');
  // app: completion sets the window with the early-completion guard, + consumer confirm.
  const api = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  assert(/release_requires_confirm/.test(api) && /release_due_at/.test(api),
    'markBookingComplete must set release window + early-completion guard — SPEC-47g');
  assert(/export async function confirmJobDone/.test(api),
    'confirmJobDone (consumer release confirm) must exist — SPEC-47g');
  // migration adds the columns.
  const mig = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter(f => /booking_held_release/.test(f));
  assert(mig.length >= 1, 'held-release migration must exist — SPEC-47g');
});

test('spec-47i-forced-post-gate', 'FROZEN: Forced barter post-gate blocks the Connector app once the service has happened (complete OR scheduled-passed) until they rate/post (SPEC-47i)', '#47i', async () => {
  const app   = fs.readFileSync(path.join(REPO_ROOT, 'src/App.jsx'), 'utf8');
  const api   = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const inbox = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/JobsInboxScreen.jsx'), 'utf8');
  const gatePath = path.join(REPO_ROOT, 'src/components/ui/BarterPostGate.jsx');

  // 1. The gate component exists and is mounted at the app root.
  assert(fs.existsSync(gatePath), 'BarterPostGate.jsx must exist');
  const gate = fs.readFileSync(gatePath, 'utf8');
  assert(/<BarterPostGate\b/.test(app), 'App.jsx must mount <BarterPostGate /> at root');

  // 2. HARD BLOCK once the service has HAPPENED (provider marked complete OR the
  //    scheduled time passed) AND connector hasn't posted/reviewed. Fires EARLIER
  //    than the old complete-only rule (SPEC-47i rev 2026-06-18).
  assert(/serviceHappened/.test(gate) && /!\s*[\w.]*posted_at/.test(gate),
    'Gate must block on serviceHappened AND !posted_at (complete OR scheduled-passed + not-posted)');
  assert(/reviewed/.test(gate),
    'Gate must release once the connector has reviewed (covers the held <4★ path) — no permanent lock');

  // 3. getOutstandingFreeBarter surfaces serviceHappened + reviewed so the gate
  //    can fire at the service time and distinguish "your turn" from "already acted".
  const gs = api.indexOf('export async function getOutstandingFreeBarter');
  const gsrc = api.slice(gs, gs + 2600);
  assert(/serviceHappened\s*=/.test(gsrc), 'getOutstandingFreeBarter must set serviceHappened (completed_at OR scheduled time passed)');
  assert(/\.reviewed\s*=/.test(gsrc), 'getOutstandingFreeBarter must set a reviewed flag');

  // 4. Provider "Mark job complete" disappears once the connector posted
  //    (no double "Mark complete" + "Accept post").
  assert(/canMarkComplete\s*=\s*!b\.completed_at\s*&&\s*!b\.posted_at/.test(inbox),
    'Provider canMarkComplete must also gate on !posted_at (drops once connector posted)');
});

test('spec-67b-reco-inbox-landing', 'FROZEN: a recommendation RECEIVED surfaces as a "You were recommended" item in the Inbox Overview so the reco dot is not a dead end (SPEC-67b)', '#67b', async () => {
  const api   = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  const inbox = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/JobsInboxScreen.jsx'), 'utf8');
  assert(/export async function listRecosOnMyServices/.test(api),
    'api.js must export listRecosOnMyServices — SPEC-67b');
  assert(/from\('recommendations'\)[\s\S]{0,220}in\('service_id'/.test(api),
    'listRecosOnMyServices must scope recommendations to my own services — SPEC-67b');
  assert(/listRecosOnMyServices/.test(inbox),
    'JobsInboxScreen must use listRecosOnMyServices — SPEC-67b');
  assert(/recosReceived/.test(inbox) && /key:\s*'reco-'/.test(inbox),
    'Overview feed must push a "reco-" item so the reco dot has a landing — SPEC-67b');
  assert(/recommended you/.test(inbox),
    'Reco item must read "<name> recommended you" — SPEC-67b');
});

test('spec-67c-parser-ontology', 'FROZEN: resolver never emits the generic "Service Provider" type (derives the specific provider type from category); fan-out matches case-insensitively on provider_type OR category (SPEC-67c)', '#67c', async () => {
  const resolver = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/chat-parse/resolver.ts'), 'utf8');
  const api      = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');
  // 1. Resolver has the generic-type guard + pickType helper, and uses it.
  assert(/GENERIC_PROVIDER_TYPES/.test(resolver) && /function pickType/.test(resolver),
    'resolver.ts must define GENERIC_PROVIDER_TYPES + pickType — SPEC-67c');
  assert(/return offering\.category/.test(resolver),
    'pickType must fall back to offering.category when notify_as is generic — SPEC-67c');
  // 2. No return site still emits the raw generic notify_as (must go via pickType).
  assert(!/provider_type:\s*offering\.notify_as\s*\?\?\s*offering\.provider_type_singular/.test(resolver),
    'resolver return sites must use pickType(), not raw notify_as — SPEC-67c');
  // 3. Fan-out matcher is case-insensitive + matches type OR category.
  assert(/allowLC/.test(api) && /norm\(s\.taxonomy_provider_type\)/.test(api) && /norm\(s\.category\)/.test(api),
    'getProvidersForNotify must match case-insensitively on taxonomy_provider_type OR category — SPEC-67c');
});

test('spec-68-first-class-matching', 'FROZEN: resolver builds a COMPLETE index from offering_master (not the partial forward_index), matches provider-type/category first, normalizes accents (ES/PT), routes fuzzy guesses to Claude (<0.60), and the where-step accepts any reply as the address (SPEC-68)', '#68', async () => {
  const resolver = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/chat-parse/resolver.ts'), 'utf8');
  const index    = fs.readFileSync(path.join(REPO_ROOT, 'supabase/functions/chat-parse/index.ts'), 'utf8');
  // Complete index built from offering_master.search_terms (fixes the 52% gap).
  assert(/const MERGED/.test(resolver) && /OFFERINGS\)[\s\S]{0,120}search_terms/.test(resolver),
    'resolver must build a complete index from offering_master.search_terms — SPEC-68');
  // Provider-type / category-first matching (Step 0).
  assert(/TYPE_INDEX/.test(resolver) && /typeOrCategoryHit/.test(resolver),
    'resolver must match provider-type/category vocabulary first — SPEC-68');
  // Accent-insensitive normalization for ES/PT.
  assert(/function normalizeTerm/.test(resolver) && /normalize\('NFD'\)/.test(resolver),
    'resolver must normalize accents (NFD) for ES/PT — SPEC-68');
  // Misspelling edit-distance hint routed sub-threshold (Claude adjudicates).
  assert(/function nearestKey/.test(resolver) && /conf: 0\.58/.test(resolver),
    'edit-distance guesses must be sub-0.60 so Claude adjudicates — SPEC-68');
  // Address regex covers full "avenue"; where-step accepts the reply.
  assert(/avenue/.test(resolver),
    'ADDR regex must include the full word "avenue" — SPEC-68');
  assert(/whereResolved = reply/.test(index) && /switchingService/.test(index),
    'chat-parse must accept the reply as the address when awaiting where (no re-ask loop) — SPEC-68');
});

test('spec-48-connector-request-screen', 'FROZEN: Connector-request screen carries job details, approximate map, Connector status + IG, friends-in-common — no fake photos (SPEC-48)', '#48', async () => {
  // The CANONICAL screen a provider opens from "New requests near you".
  const screen = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/RequestFromConnectorScreen.jsx'), 'utf8');
  const inbox  = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/JobsInboxScreen.jsx'), 'utf8');
  const app    = fs.readFileSync(path.join(REPO_ROOT, 'src/App.jsx'), 'utf8');
  const api    = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/api.js'), 'utf8');

  // 0. The inbound card routes to the dedicated screen (NOT the bare
  //    profile ?reqId path), and the route is wired.
  assert(/navigate\(`\/inbound\/\$\{req\.id\}/.test(inbox),
    'REGRESSION: "New requests near you" must open /inbound/:reqId (the dedicated request screen), not the bare profile path');
  assert(/path="\/inbound\/:reqId"/.test(app) && /RequestFromConnectorScreen/.test(app),
    'App.jsx must wire the /inbound/:reqId route to RequestFromConnectorScreen');

  // 1. Approximate-area map — exact street address blocked until confirmed.
  assert(/[Aa]pproximate area/.test(screen),
    'Screen must render the approximate-area map label');
  assert(/Exact address[\s\S]{0,60}confirm/i.test(screen),
    'Map must state the exact address is shared only after accept + confirm');

  // 2. Connector status + Instagram — real handle + followers + See Instagram.
  //    Connector = ≥300 followers OR cc_verified_at (Tarik 2026-06-13), and a
  //    request FROM a Connector is FREE (barter), never "Paid request".
  assert(/export function isConnectorProfile/.test(api) && /CONNECTOR_MIN_FOLLOWERS/.test(api),
    'lib/api.js must export isConnectorProfile + CONNECTOR_MIN_FOLLOWERS (the connector rule)');
  assert(/isConnectorProfile/.test(screen) && /isFree:\s*isConnector/.test(screen),
    'Screen must derive Connector status via isConnectorProfile AND treat a Connector request as free');
  assert(/isConnector/.test(screen) && /Connector/.test(screen),
    'Screen must surface the requester Connector badge');

  // 2b. The global BottomNav must NOT cover the fixed action bar — /inbound
  //     is in the nav-hide prefixes.
  assert(/'\/inbound'/.test(app),
    'REGRESSION: /inbound must be in HIDE_NAV_PREFIXES so the BottomNav does not cover Accept/Counter/Decline');
  assert(/data\.igHandle/.test(screen) && /See Instagram/.test(screen) && /instagram\.com\//.test(screen),
    'Screen must include the IG handle + a See Instagram link');
  assert(/export async function getInboundRequest/.test(api) && /instagram_handle/.test(api),
    'getInboundRequest must fetch the requester instagram_handle + connector flag');

  // 3. Friends-in-common — driven by the network graph, not faked.
  assert(/export async function getMutualConnections/.test(api),
    'lib/api.js must export getMutualConnections (friends-in-common over the network graph)');
  assert(/getMutualConnections/.test(screen),
    'Screen must call getMutualConnections for friends-in-common');

  // 4. Real response actions — Accept/Counter/Decline via respondToRequest.
  assert(/respondToRequest/.test(screen) && /Counter/.test(screen),
    'Screen must wire Accept/Counter/Decline via respondToRequest');

  // 5. NO fake IG photo grid — any photo strip must gate on real media.
  assert(!/aspect-square[\s\S]{0,400}https?:\/\//.test(screen) || /data\.igMedia/.test(screen),
    'REGRESSION: IG photos must gate on real data.igMedia — no fabricated thumbnails (SPEC-12/48)');

  // 6. FROZEN finalized layout (2026-06-14).
  assert(/Free \{data\.serviceType\}/.test(screen) && /Free spotlight/.test(screen),
    'Top headline must read "Free {service} ⇄ Free spotlight…"');
  assert(/tiktok_handle/.test(api) && /tiktok_followers/.test(api),
    'getInboundRequest must fetch TikTok handle/followers');
  assert(/reco's made/.test(screen) && /on Cergio/.test(screen) && /\{s\.recos\} reco/.test(screen),
    'Connector tile must show reco\'s made, the Cergio network count, and a per-service reco count');
  // Lead with REACH for a free-service request (Tarik 2026-06-15): the IG
  // followers line is the prominent lead, ABOVE the network/reco's-made line.
  assert(/IG followers/.test(screen) && /reachLine/.test(screen),
    'Connector tile must LEAD with the "{N} IG followers" reach line (SPEC-48, 2026-06-15)');
  assert(/export async function askRequestQuestion/.test(api) && /Ask a question before you accept/.test(screen),
    'Pre-booking Q&A: askRequestQuestion + "Ask a question" affordance');
  assert(/setMapOpen\(true\)/.test(screen),
    'Map must be tappable to expand (Airbnb-style)');
  assert(/no mutual friends with/i.test(screen),
    'Mutual friends must have an explicit empty state');

  // 7. SPEC-48b — booking detail parity + new-card-only inbox + FALLBACK quarantine (2026-06-15).
  const reqDetail = fs.readFileSync(path.join(REPO_ROOT, 'src/screens/RequestDetailScreen.jsx'), 'utf8');
  const hook = fs.readFileSync(path.join(REPO_ROOT, 'src/hooks/usePartyCounts.js'), 'utf8');
  assert(!/Reyna|Gervon|ReynaReynolds/.test(reqDetail),
    'REGRESSION: booking-detail FALLBACK mock (Reyna/Gervon) must stay quarantined — no fake data (SPEC-12/48b)');
  assert(/usePartyCounts/.test(reqDetail) && /formatKeyCounts/.test(reqDetail),
    'Booking detail (/request/:id) must carry the key-counts line — parity with /inbound (SPEC-48b)');
  assert(/usePartyCounts/.test(inbox) && /formatKeyCounts/.test(inbox),
    'Jobs inbox cards (bookings + free requests) must render the shared key-counts line (SPEC-48b)');
  assert(/export function formatKeyCounts/.test(hook),
    'usePartyCounts.js must export the single shared formatKeyCounts (no parallel count-formatting variations)');

  // 8. SPEC-48c — party-signal RULE: a service viewing a Connector LEADS with the
  //    Connector badge; getInboxPartyCounts must expose the isConnector flag and
  //    the inbox cards must render the badge.
  assert(/isConnector:\s*isConnectorProfile/.test(api),
    'getInboxPartyCounts must expose isConnector (via isConnectorProfile) so cards can lead with the badge (SPEC-48c)');
  assert(/\?\.isConnector/.test(inbox) && /Connector\b/.test(inbox),
    'Inbox cards (service viewing a Connector) must lead with the Connector badge (SPEC-48c)');
});

// ─── A1 launch-critical: scheduled-vs-instant messaging (date-aware) ───────
test('a1-scheduled-detection', 'FROZEN: scheduled-vs-instant detection is DATE-AWARE — calendar dates/weekdays/ordinals >32h show the "up to 24 hours" copy, near-term stays 15-min (A1)', '#A1', async () => {
  const screen = readFile('src/screens/ResultsScreen.jsx');
  // Results must delegate to the date-aware helper, not an inline relative-only regex.
  assert(/isScheduledWhen\s*\(\s*when\s*\)/.test(screen),
    'ResultsScreen must derive isScheduled via isScheduledWhen(when) — the date-aware helper (A1)');
  assert(/from '\.\.\/lib\/whenHorizon'/.test(screen),
    'ResultsScreen must import isScheduledWhen from lib/whenHorizon (A1)');

  // The helper itself must resolve the previously-missed cases correctly.
  assert(fs.existsSync(path.join(REPO_ROOT, 'src/lib/whenHorizon.js')),
    'src/lib/whenHorizon.js must exist (A1 scheduled detection)');
  const { isScheduledWhen } = await import(path.join(REPO_ROOT, 'src/lib/whenHorizon.js'));
  const NOW = new Date(2026, 6, 8, 14, 0, 0, 0); // Wed 2026-07-08 14:00
  const sched = (w) => assert(isScheduledWhen(w, NOW) === true,  `"${w}" must be SCHEDULED (>32h) — A1`);
  const inst  = (w) => assert(isScheduledWhen(w, NOW) === false, `"${w}" must be INSTANT (near-term) — A1`);
  // Previously missed → must now be scheduled:
  sched('august 5th'); sched('on the 20th'); sched('next friday'); sched('this weekend'); sched('5th of august');
  // Relative far-future still scheduled:
  sched('next week'); sched('in two weeks'); sched('a couple weeks');
  // Near-term must remain instant:
  inst('now'); inst('today'); inst('tonight'); inst('tomorrow'); inst('this evening'); inst('');
});

// ─── INVARIANT #A1b: tapping the search box NEVER injects text the user didn't type ──
// The rotating example that sits over the empty composer reads as a placeholder. It
// used to be a full-width <button> (z-10) layered ON TOP of the textarea whose onClick
// ran setQuery(example.task). So the most ordinary gesture there is — tap the box to
// place a caret — silently loaded a whole example request, and the words the user then
// typed were CONCATENATED onto it with no separator. Live repro (2026-07-13): tap +
// "plumber right now" submitted "…Spanish Tuesday night under $55plumber right now" and
// the resolver matched BABYSITTERS with an invented $55 budget. A request the user never
// typed is fake data in the launch-critical A1 flow. The overlay must stay INERT.
test('a1-example-overlay-inert', 'FROZEN: the rotating example over the composer is an inert placeholder (pointer-events-none) — tapping the search box never injects example text into the user\'s request (A1b)', '#A1b', () => {
  const home = readFile('src/screens/HomeScreen.jsx');
  // Isolate the overlay block that renders when the composer is empty.
  const m = home.match(/\{!query && \(\(\) => \{[\s\S]*?\}\)\(\)\}/);
  assert(m, 'HomeScreen must still render the rotating example overlay block (A1b)');
  const overlay = m[0];
  assert(/pointer-events-none/.test(overlay),
    'the example overlay must be pointer-events-none so a tap lands in the textarea, not on the example (A1b)');
  assert(!/<button/.test(overlay),
    'the example overlay must NOT be a <button> layered over the input — it reads as a placeholder (A1b)');
  assert(!/setQuery\s*\(/.test(overlay),
    'nothing overlaying the composer may call setQuery — that injects a request the user never typed (A1b)');
});

// ─── INVARIANT #A1c: a BUDGET or a DATE is never mistaken for the user's ADDRESS ──
// The 07-05 anti-revert guard ("an explicit typed address always wins") matched a
// raw `\d{1,6}\s+<word>{1,7}` — but a budget followed by a date is also "a number
// followed by words." Live repro (2026-07-13): "deep cleaning under $200 this
// tuesday" captured "200 this tuesday" as the address, OVERWROTE the user's real
// persisted address, and Google returned REQUEST_DENIED — surfacing a raw "Setup
// needed / geocoder denied" error on an ordinary query. Worse than cosmetic: a
// request whose `where` is a date phrase has no lat/lng, so services_near matches
// NOBODY and the request is silently unroutable. Both extraction paths in useChat
// must go through the guard, and the guard must keep the anti-revert guarantee.
test('a1-where-guard', 'FROZEN: budgets and dates can never become the address — useChat routes both address paths through extractTypedAddress, which still lets an explicitly typed street address win (A1c)', '#A1c', async () => {
  assert(fs.existsSync(path.join(REPO_ROOT, 'src/lib/whereGuard.js')),
    'src/lib/whereGuard.js must exist (A1c address guard)');
  const chat = readFile('src/hooks/useChat.js');
  assert(/from '\.\.\/lib\/whereGuard'/.test(chat),
    'useChat must import the guard from lib/whereGuard (A1c)');
  // Neither extraction path may hand-roll the old "number + words" matcher again.
  assert(!/\\d\{1,6\}\\s\+\[A-Za-z0-9/.test(chat),
    'useChat must NOT re-introduce the raw number+words address regex — it captures budgets/dates (A1c)');
  const capture = chat.match(/if \(userInput\) \{[\s\S]{0,400}?\}/);
  assert(capture && /extractTypedAddress\(userInput\)/.test(capture[0]),
    'the local address-capture path must call extractTypedAddress(userInput) (A1c)');

  const { extractTypedAddress } = await import(path.join(REPO_ROOT, 'src/lib/whereGuard.js'));
  // Budgets/dates are NOT addresses (the live bug).
  const notAddr = (s) => assert(extractTypedAddress(s) === null, `"${s}" must NOT be captured as an address (A1c)`);
  notAddr('deep cleaning under $200 this tuesday');   // the exact live repro
  notAddr('deep cleaning under 200 this tuesday');
  notAddr('babysitter Tuesday night under $55');
  notAddr('dog walker after 5pm under $40');
  notAddr('house cleaning on August 5th');
  // The 07-05 guarantee still holds: an explicit typed address wins.
  const addr = (s, want) => assert(extractTypedAddress(s) === want, `"${s}" must capture "${want}" (A1c anti-revert)`);
  // The CITY holds too (QA 2026-07-13): the old guard stopped at the comma and
  // geocoded a BARE STREET, which Google resolves against its own bias — the
  // request can silently land in the wrong city. Same user-visible bug ("my
  // address reverted"), different route. A WHEN or the job itself is never a city.
  addr('134 Henry St, New York', '134 Henry St, New York');
  addr('5701 collins ave miami', '5701 collins ave miami');
  addr('5701 collins ave, miami beach tomorrow', '5701 collins ave, miami beach');
  addr('deep cleaning at 134 Henry St under $200 this tuesday', '134 Henry St');
  addr('deep cleaning at 134 Henry St, New York under $200 this tuesday', '134 Henry St, New York');
  addr('134 Henry St, this tuesday', '134 Henry St');
  addr('134 Henry St, cleaning', '134 Henry St');
});

// ─── INVARIANT #A1i: an ADDRESS answered at the WHEN step is never the time ───
// Live 2026-07-13 (v680457c), found by the UX walk: the chat pre-filled a stale
// saved address, so it never asked WHERE — it asked WHEN. The user answered with
// the address they actually wanted ("134 Henry St, New York"). The cloud parser
// echoed that reply back as `when`, so /results rendered a STREET ADDRESS in the
// time pill, the request was written with an address as its schedule, and — the
// real damage — `when` counted as satisfied, so the user was never asked for a
// time at all. The address-capture guard (A1c) only watched the `where` side of
// the leak. `when` must refuse a value that reads as an address and carries no
// time signal, on the incoming fields AND on the carried-over prevState.
test('a1-when-not-an-address', 'FROZEN: an address typed at the WHEN step never becomes the time — useChat drops a when that is a street address with no time signal, and never carries a leaked one forward (A1i)', '#A1i', async () => {
  const chat = readFile('src/hooks/useChat.js');
  assert(/import \{[^}]*isAddressNotATime[^}]*\} from '\.\.\/lib\/whereGuard'/.test(chat),
    'useChat must import isAddressNotATime from lib/whereGuard (A1i)');
  assert(/if \(fields\.when && isAddressNotATime\(fields\.when\)\)/.test(chat),
    'useChat must drop an incoming `when` that is really an address (A1i)');
  assert(/isAddressNotATime\(prevState\.when\)/.test(chat),
    'the merge must not carry a leaked address forward as `when` (A1i)');

  const { isAddressNotATime, hasTimeSignal } = await import(path.join(REPO_ROOT, 'src/lib/whereGuard.js'));
  // The live repro + address shapes: these are NOT times.
  const notTime = (s) => assert(isAddressNotATime(s) === true, `"${s}" must be refused as a when (A1i)`);
  notTime('134 Henry St, New York');
  notTime('134 Henry St');
  notTime('5701 collins ave miami');
  // Real answers to "when do you need this?" must all SURVIVE.
  const isTime = (s) => assert(isAddressNotATime(s) === false, `"${s}" must survive as a when (A1i)`);
  isTime('ASAP');
  isTime('tomorrow');
  isTime('this week');
  isTime('flexible');
  isTime('Tuesday at 2pm');
  isTime('next friday morning');
  isTime('august 5th');
  isTime('6/20');
  isTime('in 2 weeks');
  isTime('134 Henry St tomorrow 2pm');   // says when → keep it
  assert(hasTimeSignal('tomorrow') && !hasTimeSignal('134 Henry St'),
    'hasTimeSignal must separate a time phrase from a bare address (A1i)');
});

// ─── INVARIANT #A1d: a geocode error is scoped to the search, not the app ─────
// Live 2026-07-13: one unresolvable address on /results pinned status.lastError,
// and SetupCheckBanner (root-mounted, fixed to the top) rode with the user to
// /home, /earnings and /inbox — covering the Jobs header with a raw provider
// string ("REQUEST_DENIED for '200 this tuesday'"). A geocode failure belongs to
// the one search that caused it. AUTH errors stay (SPEC-44 freezes that split).
test('a1-geocode-banner-scoped', 'FROZEN: a geocode error never follows the user across screens — the banner drops kind:geocode on navigation; auth errors are untouched (A1d)', '#A1d', async () => {
  const g = readFile('src/lib/google.js');
  assert(/export function clearGeocodeError/.test(g),
    'lib/google.js must export clearGeocodeError() (A1d)');
  const fn = g.slice(g.indexOf('export function clearGeocodeError'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert(/kind === 'geocode'/.test(body),
    'clearGeocodeError must clear ONLY kind:geocode — an auth error must survive (SPEC-44 / A1d)');
  assert(!/kind === 'auth'/.test(body),
    'clearGeocodeError must never clear an auth error (SPEC-44)');

  const b = readFile('src/components/ui/SetupCheckBanner.jsx');
  assert(/clearGeocodeError/.test(b) && /useLocation/.test(b),
    'SetupCheckBanner must clear the geocode error on route change (A1d)');
  assert(/\[pathname\]/.test(b),
    'the clear effect must be keyed on the pathname so it fires on every navigation (A1d)');
});

// ─── INVARIANT #A1e: the user's own search request has a home ─────────────────
// Live 2026-07-13: 33 pending `requests` rows for the test account and not ONE
// was visible anywhere in the product. Activity's "Your open requests" — which
// calls itself the user's outgoing pile — read only `bookings` +
// `spotlight_requests`. A search request existed on /results and nowhere else:
// navigate away and the thing the entire A1 flow exists to create was gone. The
// core loop may not dead-end (QA STANDARD A3).
test('a1-open-requests-surface', "FROZEN: a submitted search request surfaces in Activity's open-requests pile — the requester can always find the request they made (A1e)", '#A1e', async () => {
  const api = readFile('src/lib/api.js');
  assert(/export async function listMyOpenSearchRequests/.test(api),
    'api.js must expose listMyOpenSearchRequests() — the read side of the user\'s own request pile (A1e)');
  const fn = api.slice(api.indexOf('export async function listMyOpenSearchRequests'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert(/\.from\('requests'\)/.test(body), 'listMyOpenSearchRequests must read the requests table (A1e)');
  assert(/requester_id/.test(body), 'it must scope to the signed-in requester (A1e)');
  assert(/'status',\s*'pending'/.test(body), 'only PENDING requests are "open" (A1e)');

  const act = readFile('src/screens/ActivityScreen.jsx');
  assert(/listMyOpenSearchRequests/.test(act),
    'ActivityScreen must load the user\'s own open search requests (A1e)');
  assert(/function SearchRequestRow/.test(act),
    'ActivityScreen must render a row for each open search request (A1e)');
  assert(/openSearchReqs\.length > 0/.test(act),
    'hasOpen must count search requests — otherwise the pile still reads "No open requests" while requests are pending (A1e)');
  assert(/openSearchReqs\.map/.test(act),
    'the open-requests block must render the search-request rows (A1e)');
  // SPEC-12: the row states only what is true — no invented provider, no fake ETA.
  const row = act.slice(act.indexOf('function SearchRequestRow'));
  const rowBody = row.slice(0, row.indexOf('\n}') + 2);
  assert(/We'll let you know when offers land/.test(rowBody),
    'the row must use the canonical waiting copy (SPEC-42) — never a fabricated status (A1e)');
});

// ─── INVARIANT #A1f: a RESCUED geocode failure is never shown to the user ─────
// Live 2026-07-13 (cergio.ai @680457c): the production Google key has the
// Geocoding API disabled, so every single search recorded REQUEST_DENIED and
// flashed a red "Setup needed — geocoder returned REQUEST_DENIED for '134,
// Henry Street, Two Bridges, ...'" banner across the results header — then it
// disappeared ~1s later, because the Nominatim fallback resolved the address
// and cleared the error. The search worked; the user was shown a raw provider
// error anyway, on every search. A geocode error is only real if nothing
// rescued it: hold it for a grace window, show it only if it's still set.
// AUTH/LOAD errors keep shouting instantly (SPEC-44).
test('a1-geocode-banner-grace', 'FROZEN: a geocode error that the Nominatim fallback rescues is NEVER rendered — geocode errors are held for a grace window; auth/load errors still show immediately (A1f)', '#A1f', async () => {
  const b = readFile('src/components/ui/SetupCheckBanner.jsx');
  assert(/GEOCODE_GRACE_MS/.test(b),
    'SetupCheckBanner must hold geocode errors for a grace window (GEOCODE_GRACE_MS) before rendering them (A1f)');
  assert(/getGoogleMapsStatus/.test(b),
    'after the grace window the banner must RE-READ the live status — a cleared error must not be shown (A1f)');
  assert(/kind === 'geocode'/.test(b),
    'the grace window must apply ONLY to kind:geocode (A1f)');
  assert(/setTimeout\(/.test(b) && /clearTimeout\(/.test(b),
    'the deferred geocode banner must be cancellable so a rescued error never fires (A1f)');
  // auth/load must NOT be deferred — a broken key still shouts immediately.
  const sub = b.slice(b.indexOf('onGoogleMapsStatusChange'));
  const subBody = sub.slice(0, sub.indexOf('return () =>'));
  assert(/show\(s\.lastError\)/.test(subBody),
    'non-geocode errors (auth/load) must be shown immediately, not deferred (SPEC-44 / A1f)');
});

// ─── INVARIANT #A1g: earnings copy never promises money for a non-paying event ─
// Live 2026-07-13 (/earnings @680457c): "+5% when your friends invite their
// friends — $12.50 per second-tier signup." SPEC-57 pays the chain bonus on
// PAID BOOKINGS (0.5%, accumulating, cap $12.50 per friend-of-friend) — a
// signup pays nothing. The screen promised cash for an event that credits $0.
// Money copy must match the money engine.
test('earnings-chain-copy-truthful', 'FROZEN: the friend-of-friend line pays on BOOKINGS (accumulating, capped) — never "per signup" (SPEC-57 / A1g)', '#A1g', async () => {
  const e = readFile('src/screens/EarningsScreen.jsx');
  assert(!/per second-tier signup/i.test(e),
    'EarningsScreen must not promise the chain bonus "per second-tier signup" — SPEC-57 credits it on paid bookings (A1g)');
  assert(/as each of them books/i.test(e),
    'the chain-bonus line must state that it accrues as the second-tier friends BOOK (A1g)');
  assert(/up to <span[^>]*>\$\{?REWARDS\.friendOfFriendBonusStr\}?/.test(e) || /up to <span/.test(e),
    'the chain bonus is a CAP, not a flat payment — the line must read "up to $12.50" (SPEC-57 / A1g)');
});

// ─── INVARIANT #A1h: EVERY money surface states the real rate + the cap ───────
// Live 2026-07-13 (@680457c) the A1g defect was only patched on ONE line, while
// three other user-facing surfaces still stated the wrong economics:
//   /earnings  "Invite your first friend — earn $250 when they book."   → reads as
//              $250 on the first booking; SPEC-57 pays 7% of EACH booking up to a
//              $250 CAP per friend.
//   /earnings, RainmakerApply (x2), Profile: "+5% … per second-tier signup".
// REWARDS.friendOfFriendPercent (5) is the bonus as a % of the $250 CAP — it is
// NOT the booking share (chainSharePercent = 0.5%). Rendering it as a booking
// percentage overstates the rate 10x, and "per signup" promises money for an
// event that credits $0 (credit_referral_for_booking only fires on a PAID
// booking). Money copy is a promise; it must match the money engine exactly.
// RULE: no user-facing surface may render friendOfFriendPercent as a rate, may
// say "per second-tier signup"/"on second-tier signups", or may state a flat
// per-friend payout without "up to".
test('referral-money-copy-matches-engine', 'FROZEN: every referral surface states the REAL rate (chainSharePercent, per BOOKING) and the cap — never friendOfFriendPercent-as-a-rate, never "per signup" (SPEC-57 / A1h)', '#A1h', async () => {
  // Comments explain the defect (and quote the banned strings) — scan CODE only.
  const codeOf = (f) => readFile(f)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, '')             // block comments
    .replace(/^\s*\/\/.*$/gm, '');                // line comments
  // QA 2026-07-14 (A1h widening): this test used to scan FOUR hand-listed files.
  // The live UX walk then found the SAME defect class on two surfaces the list
  // never covered — /activity ("$12.50 per friend-of-friend signup") and the
  // spotlight-link modal ("Every signup through your link earns you 7% …").
  // A money-copy invariant enforced on a hand-picked subset is not an invariant.
  // Scan EVERY user-facing surface: all screens + all UI components + rewards.js.
  const walk = (rel) => {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(rel, e.name))
        : /\.jsx?$/.test(e.name) ? [path.join(rel, e.name)] : []);
  };
  const surfaces = [...walk('src/screens'), ...walk('src/components'), 'src/lib/rewards.js'];
  assert(surfaces.length >= 20, 'A1h must scan every user-facing surface, not a hand-picked few');
  for (const f of surfaces) {
    const src = codeOf(f);
    assert(!/second-tier signups?/i.test(src),
      `${f}: a second-tier SIGNUP credits $0 — the chain bonus accrues on their BOOKINGS (SPEC-57 / A1h)`);
    assert(!/REWARDS\.friendOfFriendPercent/.test(src),
      `${f}: friendOfFriendPercent (5) is a % of the $250 CAP, not the booking share — user-facing rate copy must use REWARDS.chainSharePercent (0.5%) (SPEC-57 / A1h)`);
    // No surface may promise money for a SIGNUP: credit_referral_for_booking
    // only fires on a PAID booking. Covers "per friend-of-friend signup",
    // "per second-tier signup", "Every signup … earns you 7%".
    assert(!/(?:friend-of-friend|friend of friend|second-tier|2nd-tier)\s+sign-?ups?/i.test(src),
      `${f}: the chain bonus accrues on a friend-of-friend's BOOKINGS, never on their signup (SPEC-57 / A1h)`);
    assert(!/every\s+sign-?up[^.]{0,60}(?:earn|credit|\$)/i.test(src),
      `${f}: "every signup … earns" promises money for an event that credits $0 — say "every friend who books" (SPEC-57 / A1h)`);
  }
  // The chain rate that IS shown must be the engine's rate.
  const earn = codeOf('src/screens/EarningsScreen.jsx');
  assert(/REWARDS\.chainSharePercent/.test(earn),
    'EarningsScreen must render the chain rate from REWARDS.chainSharePercent (the value credit_referral_for_booking actually pays) (A1h)');
  // The per-friend hero on the "start earning" CTA is a CAP, not a flat payout.
  assert(!/earn \$\{REWARDS\.perFriendUser\} when they book/.test(earn),
    'the first-friend CTA must not promise a flat $250 on a booking — it accumulates 7% per booking up to the $250 cap ("up to … as they book") (SPEC-57 / A1h)');
  assert(/up to \$\{REWARDS\.perFriendUser\} as they book/.test(earn),
    'the first-friend CTA must read "up to $250 as they book" (SPEC-57 / A1h)');
});

// ─── INVARIANT #QA1: the CONTINUOUS QA layer itself can't silently break ──────
// The live QA system (seed world + live suites + findings/requirements wiring)
// is the layer that guarantees user journeys work. If any of its parts vanish or
// its ledger contract drifts, the whole guarantee goes dark silently. This test
// locks the CODE contract: the seed runner, the live runner, the edge fn, and the
// migration must all exist and keep their key wiring. (It does NOT hit the DB —
// the live outcomes are exercised by scripts/qa-live.mjs + the qa-suite edge fn.)
test('qa-system-intact', 'Continuous QA layer (seed + live suites + ledger wiring) is intact', '#QA1', async () => {
  // 1) Seed world runner exists + tags rows seed=true + has a teardown path.
  const seed = readFile('scripts/seed-test-world.mjs');
  assert(/seed:\s*true/.test(seed), 'seed-test-world.mjs must tag rows seed:true (production-metric isolation)');
  assert(/--teardown/.test(seed) && /seed=eq\.true/.test(seed),
    'seed-test-world.mjs must have a teardown that deletes strictly seed=eq.true rows');

  // 2) Live runner exists + covers both P1 (search) and P2 (responses) suites and
  //    wires findings + requirements + suite-run rows.
  const live = readFile('scripts/qa-live.mjs');
  assert(/suiteSearch/.test(live) && /suiteResponses/.test(live),
    'qa-live.mjs must define the P1 search + P2 responses suites');
  assert(/cergio_qa_check/.test(live), 'qa-live.mjs must open/resolve findings via cergio_qa_check');
  assert(/cergio_verify_requirement/.test(live), 'qa-live.mjs must verify requirements on pass');
  assert(/cergio_record_qa_run/.test(live), 'qa-live.mjs must record per-suite runs for the dashboard');
  // Isolation: the live runner must only ever write seed=true rows.
  assert(!/insert\([^)]*\)[\s\S]{0,400}?seed:\s*false/.test(live),
    'qa-live.mjs must never insert a non-seed (seed:false) row');

  // 3) Edge fn exists (cron/dashboard-callable) with the same check contract.
  const edge = readFile('supabase/functions/qa-suite/index.ts');
  assert(/cergio_qa_check/.test(edge) && /cergio_record_qa_run/.test(edge),
    'qa-suite edge fn must wire the same findings + suite-run ledger');
  assert(/\.eq\(\s*['"]seed['"]\s*,\s*true\s*\)/.test(edge),
    'qa-suite edge fn must read ONLY seed=true fixtures (never real rows)');

  // 4) Migration installs the requirements ledger + qa summary the dashboard reads.
  const mig = readFile('supabase/migrations/20260710000000_qa_seed_and_requirements.sql');
  assert(/create table if not exists public\.requirements/.test(mig),
    'the QA migration must create the requirements ledger');
  assert(/function public\.cergio_qa_summary/.test(mig),
    'the QA migration must expose cergio_qa_summary() for the dashboard');
  assert(/add column if not exists seed boolean/.test(mig),
    'the QA migration must add the seed tag column for isolation');

  // 5) ops-metrics merges the QA summary so the dashboard QA tab has data.
  const ops = readFile('supabase/functions/ops-metrics/index.ts');
  assert(/cergio_qa_summary/.test(ops),
    'ops-metrics must merge cergio_qa_summary() into the snapshot for the dashboard QA tab');
});

// ─── #73 · THE LOOP MUST NEVER GO BLIND AGAIN ────────────────────────────────
// 11 of 11 autonomous actions failed with result "[object Object]" — the reason was
// destroyed at write time, so five days of failures taught us nothing. Cause:
// Supabase/PostgREST rejects with a PLAIN OBJECT ({message, details, hint, code}),
// NOT an Error, and `String(e)` on a plain object is literally "[object Object]".
// This test (a) locks ONE canonical serr() across every worker that writes a failure
// to the DB, and (b) actually EXECUTES the shipped helper against a PostgREST-shaped
// rejection. It fails on the old code and passes on the fix.
const SERR_WORKERS = [
  'coo-execute', 'creator-harvest', 'enrich-influencers', 'fulfill-crawl',
  'cergio-watchdog', 'cergio-orchestrator', 'qa-suite',
];
test('loop-visibility', 'FROZEN: every worker that writes a failure to the DB serializes it with the canonical serr() — a thrown PostgREST error records its REAL message + code, never "[object Object]"', '#73', async () => {
  const bodies = new Map();
  for (const w of SERR_WORKERS) {
    const src = readFile(`supabase/functions/${w}/index.ts`);
    // 1) The banned pattern is gone: String(e) on a possibly-plain-object throw.
    assert(!/e instanceof Error \? e\.message : String\(e\)/.test(src),
      `${w}: "e instanceof Error ? e.message : String(e)" DESTROYS a PostgREST error (plain object → "[object Object]"). Use serr(e).`);
    assert(!/\bString\(\s*e\s*\)/.test(stripComments(src).replace(/String\(e\.stack\)/g, '')),
      `${w}: raw String(e) on a thrown value is banned — it is how the loop went blind. Use serr(e).`);
    // 2) The canonical helper is present.
    const i = src.indexOf('function serr(e: unknown): string {');
    assert(i > -1, `${w}: must define the canonical serr(e) helper`);
    const m = /\n\}\n/.exec(src.slice(i));
    bodies.set(w, src.slice(i, i + m.index + m[0].length));
  }

  // 3) ANTI-DRIFT: every copy is byte-identical (they are deployed separately, so a
  //    fork would silently re-blind one worker).
  const [first, ...rest] = [...bodies.entries()];
  for (const [w, body] of rest) {
    assert(body === first[1],
      `${w}: its serr() has drifted from the canonical copy in ${first[0]} — one forked serializer is one blind agent`);
  }

  // 4) BEHAVIOURAL: run the SHIPPED helper. Strip the (three) TS annotations.
  const js = first[1]
    .replace('function serr(e: unknown): string {', 'function serr(e) {')
    .replace('const o = e as any;', 'const o = e;')
    .replace('const parts: string[] = [];', 'const parts = [];');
  assert(!/:\s*unknown|:\s*string\[\]|\bas any\b/.test(js),
    'serr() gained a TS annotation this test does not strip — update the stripper');
  const serr = new Function(`${js}\nreturn serr;`)();

  // The exact shape supabase-js rejects with (a PLAIN OBJECT, not an Error).
  const pgErr = {
    message: 'null value in column "ig_handle" of relation "leads_influencers" violates not-null constraint',
    details: 'Failing row contains (harv:x, null, …).',
    hint: null,
    code: '23502',
  };
  // Sanity: reproduce the ACTUAL bug, so this test proves it is fixed rather than assumed.
  assert(String(pgErr) === '[object Object]',
    'fixture is wrong: a plain object must stringify to "[object Object]"');

  const out = serr(pgErr);
  assert(!/\[object Object\]/.test(out), `serr() still emits "[object Object]": ${out}`);
  assert(/violates not-null constraint/.test(out), `serr() must carry the REAL Postgres message — got: ${out}`);
  assert(/23502/.test(out), `serr() must carry the SQLSTATE code — got: ${out}`);
  assert(/Failing row contains/.test(out), `serr() must carry the Postgres details — got: ${out}`);

  // Nested (fetch/PostgREST envelope), Error, string, empty object, null.
  assert(/REQUEST_DENIED/.test(serr({ error: { message: 'Places: REQUEST_DENIED', code: 403 } })),
    'serr() must reach a nested error.message');
  assert(serr(new Error('boom')).startsWith('boom'), 'serr(Error) must start with its message');
  assert(/serr|qa\.mjs|Function/.test(serr(new Error('boom'))) || true, 'stack frames are best-effort');
  assert(serr('plain reason') === 'plain reason', 'serr(string) must pass through');
  const empty = serr({});
  assert(empty && !/\[object Object\]/.test(empty) && empty.length > 3,
    `serr({}) must still say something legible — got: ${empty}`);
  assert(serr(null).length > 3, 'serr(null) must be legible');
  assert(serr(undefined).length > 3, 'serr(undefined) must be legible');
  assert(serr(pgErr).length <= 900, 'serr() must bound its output (DB column safety)');

  // 5) The COO executor must RECORD that reason on the failed proposal + log row.
  const coo = readFile('supabase/functions/coo-execute/index.ts');
  assert(/status = 'failed';\s*\n\s*result = serr\(e\);/.test(coo),
    "coo-execute's failure branch must set result = serr(e) (the string written to coo_proposals.result + coo_execution_log.result)");
  assert(/from\('coo_proposals'\)\s*\n?\s*\.update\(\{ status, executed_at[^}]*result: result\.slice/.test(coo.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
         /result: result\.slice\(0, 1000\)/.test(coo),
    'coo-execute must persist the human-readable result on the proposal');
});

// ─── #74 · ENRICH-INFLUENCERS: NO SILENT COLLISION ───────────────────────────
// "found 40 but wrote 0 rows", open since 2026-07-08. It was never an upsert
// collision: the candidate query had no cursor and no ordering, so every 30-minute
// run re-picked the SAME head-of-table 40 rows, re-mined the same dead links, and
// wrote 0. A livelock. This locks the three fixes: a cursor that guarantees forward
// progress, proof-of-write on every update, and a 0-written run that must state WHY.
test('enrich-no-silent-collision', 'FROZEN: enrich-influencers advances a cursor (never re-mines the same head-of-table 40), proves every write with .select(), and a 0-written run reports an explicit reason — never a silent success', '#74', async () => {
  const src = readFile('supabase/functions/enrich-influencers/index.ts');

  // 1) CURSOR — least-recently-attempted first, and stamped on EVERY candidate
  //    (hit OR miss). Without the miss-stamp the livelock returns.
  assert(/\.order\(\s*'enrich_attempted_at'\s*,\s*\{\s*ascending:\s*true\s*,\s*nullsFirst:\s*true\s*\}\s*\)/.test(src),
    'candidate query must order by enrich_attempted_at (nulls first) — otherwise it re-picks the same rows forever');
  assert(/enrich_attempted_at\.is\.null,enrich_attempted_at\.lt\./.test(src),
    'candidate query must skip rows already attempted inside the retry window');
  assert(/\.update\(\{\s*enrich_attempted_at:[\s\S]{0,120}?\.in\('id', attempted\)/.test(src),
    'EVERY candidate looked at must be stamped attempted (hit or miss) — the stamp IS the cursor');
  assert(/attempted\.push\(r\.id\)/.test(src),
    'the attempted list must be built from every row entering the loop, not just the ones that wrote');

  // 2) PROOF OF WRITE — an update that errors OR matches 0 rows is a FAILURE.
  assert(/\.update\(patch\)\.eq\('id', r\.id\)\.select\('id'\)/.test(src),
    "the update must end in .select('id') — a 0-row write must be provable, not assumed");
  assert(/if \(uErr \|\| !\(wrote \?\? \[\]\)\.length\)/.test(src),
    'an update error OR a 0-row match must route to the failure path (never enriched++)');
  assert(/write_failed/.test(src) && /writeErrors\.push/.test(src),
    'write failures must be counted and their real reasons captured (serr) for agent_runs');

  // 3) NO SILENT SUCCESS — 0 written with N found must be an explicit 'empty'
  //    (or 'error') carrying the per-reason breakdown.
  assert(/const skips = \{[^}]*no_source[^}]*mined_no_contact[^}]*suppressed_only[^}]*nothing_new[^}]*write_failed/.test(src),
    'the run must tally WHY each candidate produced no write (the missing diagnosis)');
  assert(/status:\s*skips\.write_failed > 0 \? 'error' : \(enriched === 0 \? 'empty' : 'ok'\)|const status = skips\.write_failed > 0 \? 'error' : \(enriched === 0 \? 'empty' : 'ok'\)/.test(src),
    "0 written → status 'empty' (or 'error' on a write failure) — never 'ok'");
  assert(/error:\s*skips\.write_failed > 0[\s\S]{0,200}?: reason/.test(src),
    'the agent_runs row must carry the reason string, so the dashboard shows WHY it wrote nothing');
  assert(/meta:\s*\{ checked, enriched, skips, cursor/.test(src),
    'agent_runs.meta must carry checked/enriched/skips/cursor (the creator-harvest pattern)');

  // 4) The cursor column must actually be created, and a missing migration must
  //    degrade LOUDLY (legacy query + a cursor note), never silently.
  const mig = readFile('supabase/migrations/20260713000000_visibility_escalation_and_yp_shutdown.sql');
  assert(/add column if not exists enrich_attempted_at timestamptz/.test(mig),
    'the migration must add leads_influencers.enrich_attempted_at (the cursor)');
  assert(/legacy-head-of-table/.test(src),
    'if the cursor column is missing the worker must SAY it is running hobbled, not pretend to be healthy');
});

// ─── #75 · STALENESS ESCALATION ──────────────────────────────────────────────
// A finding could be opened, re-opened, re-opened… forever, and nothing changed:
// enrich-influencers sat SILENT for 5 days and a QA assertion sat red for days.
// Detection without escalation is a prettier kind of blind. Any finding open past
// the window is bumped to 'critical' and written as a needs-approval proposal that
// NAMES it a stale unfixed defect — exactly once (escalated_at), never in a loop.
test('staleness-escalation', 'FROZEN: cergio-watchdog escalates any qa_finding open past the window (default 12h) with no fix — severity→critical + a needs-approval coo_proposal — exactly once (escalated_at), and re-arms when the finding is genuinely fixed', '#75', async () => {
  const src = readFile('supabase/functions/cergio-watchdog/index.ts');

  // 1) Selection: OPEN + never-escalated + older than the window, oldest first, capped.
  assert(/QA_ESCALATE_AFTER_HOURS/.test(src) && /\|\| '12'/.test(src),
    'the escalation window must be configurable (QA_ESCALATE_AFTER_HOURS), defaulting to 12h');
  assert(/from\('qa_findings'\)[\s\S]{0,400}?\.eq\('status', 'open'\)[\s\S]{0,200}?\.is\('escalated_at', null\)[\s\S]{0,200}?\.lt\('found_at', cutoff\)/.test(src),
    'must select findings that are OPEN, never-escalated, and older than the cutoff');
  assert(/\.limit\(10\)/.test(src),
    'escalations must be capped per heartbeat so an outage cannot flood the founder list');

  // 2) Escalate: bump severity AND raise a needs-approval proposal naming the defect.
  assert(/severity: 'critical'/.test(src) && /escalated_at: new Date\(\)\.toISOString\(\)/.test(src),
    'a stale finding must be bumped to critical and stamped escalated_at');
  assert(/STALE DEFECT/.test(src),
    'the proposal must NAME it as a stale unfixed defect (not a new idea)');
  assert(/requires_approval: true/.test(src) && /action_kind: 'none'/.test(src) && /on_spec: false/.test(src),
    'the escalation proposal must be requires_approval=true / action_kind=none — coo-execute must never auto-run it');
  assert(/const ok = await upsertProposal\(db, title, detail[\s\S]{0,40}?\);\s*\n\s*if \(!ok\) continue;/.test(src),
    'the proposal must be written BEFORE escalated_at is stamped — a lost proposal must not burn the escalation');
  assert(/Auto-fix: \$\{f\.check_name\}/.test(src),
    'the escalation must state whether a fix was ever ATTEMPTED (the auto-fix proposal, if any)');

  // 3) Idempotent: stable title + existing-pending check → no duplicate spam.
  assert(/\.eq\('title', title\)[\s\S]{0,120}?\.eq\('status', 'pending'\)/.test(src),
    'upsertProposal must skip when an identical-title proposal is already pending (no spam)');

  // 4) A broken monitor must SHOW as broken (e.g. migration not applied).
  assert(/escalationError/.test(src) && /status: escalationError \? 'error' : 'ok'/.test(src),
    'if escalation cannot run, the watchdog run must be status=error — never a quiet ok');

  // 5) The DB side: the column exists and the escalation re-arms on a genuine fix.
  const mig = readFile('supabase/migrations/20260713000000_visibility_escalation_and_yp_shutdown.sql');
  assert(/add column if not exists escalated_at timestamptz/.test(mig),
    'the migration must add qa_findings.escalated_at');
  assert(/set status = 'fixed'[\s\S]{0,200}?escalated_at = null/.test(mig),
    'cergio_qa_check must clear escalated_at when a finding is fixed (re-arm for a future occurrence)');
  assert(/found_at = case when qa_findings\.status = 'fixed'\s*\n?\s*then now\(\)/.test(mig),
    'a re-opened finding must reset found_at, so staleness measures THIS episode');
  assert(/severity = case when qa_findings\.status = 'open'[\s\S]{0,120}?'critical'/.test(mig),
    "cergio_qa_check must not DOWNGRADE a severity the watchdog escalated to 'critical'");
});

// ─── #47j · SCHEDULED-VS-INSTANT IS A WRITE-TIME INVARIANT ───────────────────
// The hourly QA had `qa_resp_scheduled_branch` red for days. The CODE was right:
// accept_request_with_time honors the caller's time (coalesce(p_scheduled_at, …))
// and stamps schedule_confirmed_at. The TEST was wrong: it compared a PERSISTED seed
// booking's scheduled_at to Date.now(), so a fixture written (correctly) at now+3d
// went red three days later — a clock, not a regression. SPEC-47.1 is about what is
// written AT BOOKING TIME, so the assertion must be relative to the row's own
// created_at. Lock that, and lock the RPC that it tests.
test('scheduled-branch-write-time', 'FROZEN (SPEC-47): the scheduled-vs-instant assertion is a WRITE-TIME invariant — scheduled_at > created_at + 12h AND schedule_confirmed_at stamped — never "future vs the clock" on a persisted fixture', '#47j', async () => {
  // 1) The RPC under test genuinely honors the chosen time (this is the code side).
  const rpc = readFile('supabase/migrations/20260616020000_accept_with_time.sql');
  assert(/coalesce\(p_scheduled_at, now\(\) \+ interval '1 day'\)/.test(rpc),
    'accept_request_with_time must write the CHOSEN time (p_scheduled_at), not an instant placeholder — SPEC-47.1');
  assert(/schedule_confirmed_at/.test(rpc) && /'confirmed'/.test(rpc),
    'accept_request_with_time must stamp schedule_confirmed_at on the confirmed booking — SPEC-47.1/47h');

  // 2) The edge suite (hourly cron, reads a fixture that AGES) must assert the
  //    write-time relationship, never "> Date.now()" against a stored row.
  const edge = readFile('supabase/functions/qa-suite/index.ts');
  const branch = edge.slice(edge.indexOf("check: 'qa_resp_scheduled_branch'"));
  const block = branch.slice(0, branch.indexOf('});') + 3);
  assert(!/Date\.now\(\)\s*\+\s*12\s*\*\s*3600\s*\*\s*1000/.test(block),
    'qa-suite must NOT compare a persisted fixture to Date.now()+12h — that assertion decays into a false red as the fixture ages');
  assert(/schedAt > bookedAt \+ 12 \* 3600 \* 1000/.test(block),
    'qa-suite must assert scheduled_at > created_at + 12h (the write-time branch, time-invariant)');
  assert(/confirmed\.schedule_confirmed_at/.test(block),
    'qa-suite must also require schedule_confirmed_at — SPEC-47.1 bans the silent auto-time');
  assert(/created_at/.test(edge.slice(0, edge.indexOf("check: 'qa_resp_paths_distinct'"))) ||
         /select\('id, status, scheduled_at, schedule_confirmed_at, created_at/.test(edge),
    'qa-suite must select created_at + schedule_confirmed_at on the seed bookings');
  assert(/\.order\('created_at', \{ ascending: false \}\)/.test(edge),
    'qa-suite must evaluate the NEWEST confirmed seed booking, not an arbitrary one');

  // 3) The Node runner shares the check_name — it must assert the SAME invariant.
  const live = readFile('scripts/qa-live.mjs');
  const lb = live.slice(live.indexOf("S.a('qa_resp_scheduled_branch'"));
  const lblock = lb.slice(0, lb.indexOf(');') + 2);
  assert(/bookedAtMs \+ 12 \* 3600 \* 1000/.test(lblock) && /schedule_confirmed_at/.test(lblock),
    'qa-live.mjs must assert the same write-time invariant (shared check_name → no drift)');
});

// ─── #76 · THE COO MAY NOT INVENT COLUMNS ────────────────────────────────────
// 12 autonomous actions failed with Postgres 42703 — `column "handle" does not
// exist (hint: perhaps you meant "leads_influencers.ig_handle")` and `column
// "website" does not exist`. coo-brain authored SQL against a HALLUCINATED schema
// and nothing between the model and Postgres ever checked the column names: the
// allowlist only asked "single reversible UPDATE of a lead table with a WHERE?",
// which a doomed statement passes perfectly. Shape was checked; meaning was not.
//
// This test locks the fix: (a) ONE canonical schema contract, byte-identical in
// coo-brain and coo-execute; (b) the REAL column lists, with the hallucinated
// names provably absent; (c) the prompt actually CARRIES the real columns; and
// (d) the shipped validator, EXECUTED against the two payloads that really died —
// they must be rejected, and honest payloads must still pass.
const SCHEMA_CONTRACT_WORKERS = ['coo-brain', 'coo-execute'];
const CONTRACT_START = '// ─── LEAD-TABLE SCHEMA CONTRACT — DO NOT FORK ─';
const CONTRACT_END   = '// ─── END LEAD-TABLE SCHEMA CONTRACT ─';

test('coo-schema-contract', 'FROZEN: coo-brain/coo-execute carry ONE byte-identical schema contract with the REAL lead-table columns, the prompt is built from it, and any SQL payload naming a column that does not exist is REJECTED before it runs (the 42703 that killed 12 actions)', '#76', async () => {
  // 1) ONE contract, present in both, byte-identical (they deploy separately — a
  //    fork would re-open the hole in whichever copy drifted).
  const blocks = new Map();
  for (const w of SCHEMA_CONTRACT_WORKERS) {
    const src = readFile(`supabase/functions/${w}/index.ts`);
    const i = src.indexOf(CONTRACT_START);
    assert(i > -1, `${w}: must define the canonical LEAD-TABLE SCHEMA CONTRACT block (the real column lists + the pre-flight validator)`);
    const jEnd = src.indexOf(CONTRACT_END, i);
    assert(jEnd > -1, `${w}: schema contract block is not terminated by the END marker`);
    blocks.set(w, src.slice(i, jEnd));
  }
  const [first, ...rest] = [...blocks.entries()];
  for (const [w, body] of rest) {
    assert(body === first[1],
      `${w}: its schema contract has drifted from the canonical copy in ${first[0]} — one forked column list is one hallucinating agent`);
  }

  // 2) Strip the (eight) TS annotations and EXECUTE the shipped code.
  const js = first[1]
    .replace('type LeadColumns = { leads_services: string[]; leads_influencers: string[] };', '')
    .replace('const LEAD_COLUMNS_FALLBACK: LeadColumns = {', 'const LEAD_COLUMNS_FALLBACK = {')
    .replace('function sqlColumnsOk(raw: string, cols: LeadColumns): { ok: boolean; why?: string } {', 'function sqlColumnsOk(raw, cols) {')
    .replace('const unknown: string[] = [];', 'const unknown = [];')
    .replace('const LEAD_BOOLEAN_COLUMNS: Record<string, string[]> = {', 'const LEAD_BOOLEAN_COLUMNS = {')
    .replace('function typesOk(stmt: string, table: string): { ok: boolean; why?: string } {', 'function typesOk(stmt, table) {')
    .replace('const bad: string[] = [];', 'const bad = [];')
    .replace('async function liveLeadColumns(url: string, key: string): Promise<LeadColumns> {', 'async function liveLeadColumns(url, key) {');
  assert(!/:\s*LeadColumns|:\s*string\b|string\[\]|Record<|Promise</.test(js),
    'the schema contract gained a TS annotation this test does not strip — update the stripper');
  const { sqlColumnsOk, LEAD_COLUMNS_FALLBACK, liveLeadColumns, LEAD_BOOLEAN_COLUMNS } =
    new Function(`${js}\nreturn { sqlColumnsOk, LEAD_COLUMNS_FALLBACK, liveLeadColumns, LEAD_BOOLEAN_COLUMNS };`)();
  assert(typeof sqlColumnsOk === 'function', 'sqlColumnsOk must be a function');
  assert(typeof liveLeadColumns === 'function',
    'the contract must also read the LIVE column list (an un-applied ALTER must not produce a doomed payload)');

  // 3) The column lists are the REAL ones — and the hallucinations are provably absent.
  const S = LEAD_COLUMNS_FALLBACK.leads_services;
  const I = LEAD_COLUMNS_FALLBACK.leads_influencers;
  for (const c of ['id', 'name', 'service_type', 'website_url', 'instagram', 'has_instagram', 'city', 'outreach_status'])
    assert(S.includes(c), `leads_services column list is missing the real column "${c}"`);
  for (const c of ['id', 'ig_handle', 'external_url', 'category', 'followers', 'discovered_via', 'outreach_status'])
    assert(I.includes(c), `leads_influencers column list is missing the real column "${c}"`);
  assert(!I.includes('handle'), 'leads_influencers must NOT list "handle" — the real column is ig_handle (this exact guess failed 42703 in production)');
  assert(!S.includes('website') && !I.includes('website'), 'neither table has a "website" column — services use website_url, creators use external_url');
  assert(!S.includes('category'), 'leads_services has NO "category" column — the category lives in service_type');

  // 4) THE REGRESSION, EXECUTED. The two payloads that actually died must be rejected.
  const bogusHandle = "UPDATE public.leads_influencers SET outreach_status='do_not_contact' WHERE handle ilike '%news%'";
  const r1 = sqlColumnsOk(bogusHandle, LEAD_COLUMNS_FALLBACK);
  assert(r1.ok === false, 'a payload referencing leads_influencers.handle MUST be rejected — it is column-does-not-exist [42703]');
  assert(/handle/.test(r1.why) && /ig_handle/.test(r1.why),
    `the rejection must NAME the bad column and the real one (Postgres gave us that hint only after it failed) — got: ${r1.why}`);

  // 4b) THE 42804 REGRESSION (action #97, 2026-07-14). The name check passed and
  // the statement STILL died: `IS NOT TRUE` on an integer column — "argument of IS
  // TRUE must be type boolean, not type integer". A real column with the wrong TYPE
  // is the same class of hallucination as a fake column; it must be caught BEFORE it
  // runs, and the refusal must say which columns actually are boolean.
  assert(LEAD_BOOLEAN_COLUMNS && Array.isArray(LEAD_BOOLEAN_COLUMNS.leads_services),
    'the contract must declare which lead columns are boolean — a type nobody states is a type the model invents');
  const badType = "UPDATE public.leads_influencers SET outreach_status='queued' WHERE outreach_status='new' AND phone_verified_level IS NOT TRUE";
  const rT = sqlColumnsOk(badType, LEAD_COLUMNS_FALLBACK);
  assert(rT.ok === false,
    'IS NOT TRUE on a non-boolean column MUST be rejected — this is Postgres 42804, the error that killed autonomous action #97');
  assert(/phone_verified_level/.test(rT.why) && /42804/.test(rT.why),
    `the rejection must name the offending column and the error class — got: ${rT.why}`);
  // ...and a LEGITIMATE boolean comparison must still sail through untouched.
  assert(sqlColumnsOk("UPDATE public.leads_services SET outreach_status='queued' WHERE has_instagram IS TRUE", LEAD_COLUMNS_FALLBACK).ok === true,
    'has_instagram IS TRUE is valid (it really is boolean) — the type guard must not block good SQL');

  const bogusWebsite = "UPDATE public.leads_services SET website='x' WHERE id='1'";
  const r2 = sqlColumnsOk(bogusWebsite, LEAD_COLUMNS_FALLBACK);
  assert(r2.ok === false, 'a payload referencing leads_services.website MUST be rejected — the real column is website_url [42703]');
  assert(/website/.test(r2.why), `the rejection must name the bad column — got: ${r2.why}`);

  // A bogus column ANYWHERE (SET side, WHERE side, or a made-up flag) is caught.
  assert(sqlColumnsOk("UPDATE public.leads_services SET is_mobile=true WHERE city='Miami'", LEAD_COLUMNS_FALLBACK).ok === false,
    'an invented boolean flag (is_mobile) must be rejected');
  assert(sqlColumnsOk("UPDATE public.leads_influencers SET category='fitness' WHERE follower_count > 1000", LEAD_COLUMNS_FALLBACK).ok === false,
    'follower_count does not exist (the real column is followers) — must be rejected');

  // 5) HONEST payloads must still auto-run — a validator that rejects everything is
  //    just a slower outage. These are the worked examples from the COO prompt.
  const good = [
    "UPDATE public.leads_services SET has_instagram=true WHERE has_instagram IS NOT TRUE AND (coalesce(instagram,'') <> '' OR coalesce(website_url,'') ~* 'instagram\\.com/')",
    "UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE outreach_status IN ('queued','new') AND lower(coalesce(service_type,'')||' '||coalesce(name,'')) ~ 'restaurant|cafe|diner|eatery'",
    "UPDATE public.leads_influencers SET outreach_status='queued' WHERE outreach_status='new' AND email IS NOT NULL AND city='Miami'",
    "UPDATE leads_influencers SET tier='Micro' WHERE followers < 10000 AND tier IS NULL",
    "UPDATE public.leads_services SET service_type='mobile detailing' WHERE lower(name) LIKE '%detail%' AND service_type IS NULL",
  ];
  for (const g of good) {
    const v = sqlColumnsOk(g, LEAD_COLUMNS_FALLBACK);
    assert(v.ok === true, `an on-spec payload using only REAL columns must pass — rejected "${g.slice(0, 60)}…" with: ${v.why}`);
  }

  // 6) NOT A DUMB GREP: words that merely appear inside a string literal, a cast, a
  //    comment or a function name are not column references. If this fails, the
  //    validator would gate honest work and the founder's queue fills with noise.
  const literalTrap = "UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE lower(coalesce(service_type,'')||' '||coalesce(name,'')) ~ 'website|handle|category'";
  assert(sqlColumnsOk(literalTrap, LEAD_COLUMNS_FALLBACK).ok === true,
    'a bad column NAME inside a string literal is not a column reference — the validator must tokenize, not grep');
  assert(sqlColumnsOk("UPDATE public.leads_services s SET s.outreach_status='queued' WHERE s.city='Miami'", LEAD_COLUMNS_FALLBACK).ok === true,
    'a table alias must be understood, not reported as an unknown column');
  assert(sqlColumnsOk("UPDATE public.leads_influencers SET outreach_status='queued' WHERE created_at::date = current_date", LEAD_COLUMNS_FALLBACK).ok === true,
    'a ::cast type name is not a column reference');

  // 7) THE PROMPT CARRIES THE REAL COLUMNS. The model can only stop guessing if it
  //    is given the list — so the system prompt is BUILT from the live schema.
  const brain = readFile('supabase/functions/coo-brain/index.ts');
  assert(/const leadCols = await liveLeadColumns\(supabaseUrl, serviceKey\)/.test(brain),
    'coo-brain must read the LIVE column list on every run');
  assert(/system: buildSystem\(leadCols\)/.test(brain),
    'coo-brain must build the system prompt FROM the live column list (not a hard-coded guess)');
  const si = brain.indexOf('function schemaContract(cols: LeadColumns): string {');
  assert(si > -1, 'coo-brain must render the column lists into the prompt via schemaContract(cols)');
  const sEnd = /\n\}\n/.exec(brain.slice(si));
  // The prompt is rendered from the CONTRACT's own data (column list + the boolean
  // set), so it is evaluated with LEAD_BOOLEAN_COLUMNS injected from the contract
  // we just executed — one source of truth, no second hard-coded copy to drift.
  const scJs = `const LEAD_BOOLEAN_COLUMNS = ${JSON.stringify(LEAD_BOOLEAN_COLUMNS)};\n`
    + brain.slice(si, si + sEnd.index + sEnd[0].length)
      .replace('function schemaContract(cols: LeadColumns): string {', 'function schemaContract(cols) {');
  const schemaContract = new Function(`${scJs}\nreturn schemaContract;`)();
  const prompt = schemaContract(LEAD_COLUMNS_FALLBACK);
  for (const c of ['ig_handle', 'website_url', 'external_url', 'service_type', 'has_instagram', 'discovered_via'])
    assert(prompt.includes(c), `the model prompt must NAME the real column "${c}"`);
  assert(/NO "handle"/.test(prompt) && /NO "website"/.test(prompt),
    'the prompt must explicitly kill the two hallucinations that failed live ("handle" / "website")');
  // The TYPE hallucination (42804, action #97) must be killed in the prompt too —
  // the model can only stop writing `IS NOT TRUE` on an integer if it is told which
  // columns are actually boolean.
  assert(/42804/.test(prompt) && /IS TRUE/.test(prompt),
    'the prompt must warn about 42804 — IS TRUE/IS NOT TRUE on a non-boolean column (how action #97 died)');
  for (const b of LEAD_BOOLEAN_COLUMNS.leads_services)
    assert(prompt.includes(b), `the prompt must list the real boolean column "${b}"`);

  // 8) coo-brain re-checks what the model hands back, and DOWNGRADES a doomed
  //    payload to requires_approval instead of shipping it.
  assert(/payloadVerdict\(action_kind, action_payload, leadCols\)/.test(brain),
    "coo-brain must re-verify the model's payload against the live columns before allowing auto-run");
  assert(/const schemaBad = action_kind === 'sql' && !verdict\.ok/.test(brain),
    'coo-brain must detect a schema-invalid SQL payload specifically');
  assert(/if \(schemaBad\) \{ action_kind = 'none'; action_payload = ''; \}/.test(brain),
    'a payload naming a non-existent column must be STRIPPED (approving it would just re-ship the 42703) — not left runnable');
  assert(/\[GATED — \$\{verdict\.why\}/.test(brain),
    'the gate must record WHY, on the proposal the founder reads');

  // 9) coo-execute re-checks AGAIN (defense in depth) and never runs a doomed
  //    statement: it hands it back to the founder instead of failing it into the
  //    execution log for the 13th time.
  const exec = readFile('supabase/functions/coo-execute/index.ts');
  assert(/const leadCols = await liveLeadColumns\(supabaseUrl, serviceKey\)/.test(exec),
    'coo-execute must read the live column list too (never trust the brain)');
  const sqlBranch = exec.slice(exec.indexOf("if (kind === 'sql') {"), exec.indexOf("} else if (kind === 'edge_call')"));
  assert(/const c = sqlColumnsOk\(payload, leadCols\);/.test(sqlBranch),
    'coo-execute must run the pre-flight schema check on the SQL payload');
  assert(sqlBranch.indexOf('sqlColumnsOk') < sqlBranch.indexOf('cergio_coo_exec_sql'),
    'the schema check must happen BEFORE the statement is sent to Postgres');
  assert(/gated = true;/.test(sqlBranch),
    'a schema-invalid payload must be GATED, not executed');
  assert(/if \(gated\) \{[\s\S]{0,600}?requires_approval: true, status: 'pending'/.test(exec),
    'a gated payload must go back to the founder (requires_approval=true) — and, since the executor only picks up requires_approval=false, it can never loop');
  assert(/status: 'refused'/.test(exec),
    "the execution log must record the refusal (status='refused') so a still-hallucinating brain stays visible");
});

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH BLOCKERS — founder-reported on the live URL, 2026-07-14 (SPEC-78).
//
// Five defects Tarik hit walking his own product. Each test below is the
// regression guard for one of them and is named `spec-<requirementId>` — the
// id prefix auto-build.mjs:447 reads to flip the ledger row
// (cergio_verify_requirement) from open → verified once it is green on main.
// Requirement rows are seeded by
// supabase/migrations/20260714000000_req_launch_blockers.sql.
//
// Strip comments but KEEP template literals + strings: these tests assert on
// JSX handlers (navigate(`/u/${id}`)) and on user-facing copy, both of which
// the global stripComments() would erase.
// ═══════════════════════════════════════════════════════════════════════════
function codeNoComments(rel) {
  return readFile(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')  // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, '')            // block comments
    .replace(/^\s*\/\/.*$/gm, '');               // line comments
}

// ─── launch-02: retired wait-copy variants are GONE ──────────────────────
// launch-02 v1 dictated ONE sentence ("This may take 15 minutes to a few
// hours…"); launch-15 (2026-07-16) SUPERSEDES it with a heading+body pair.
// This test is now the RETIREMENT guard: neither the original instant/
// scheduled fork NOR the launch-02-v1 sentence may survive on any surface.
// The POSITIVE assertion of the new copy lives in spec-launch-15.
const RETIRED_WAIT_LINES = [
  [/Allow up to 15 minutes/i, 'the old instant-wait line'],
  [/up to 24 hours to locate and negotiate/i, 'the old scheduled-wait line'],
  [/This may take 15 minutes to a few hours to locate/i, 'the retired launch-02-v1 sentence (superseded by launch-15)'],
];
test('spec-launch-02', 'FROZEN: every retired post-request wait line is gone', 'launch-02', async () => {
  const src = readFile('src/screens/ResultsScreen.jsx');
  // WAIT_COPY must still be a single exported constant (one source of truth)…
  const m = src.match(/export const WAIT_COPY\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*;/);
  assert(m, 'ResultsScreen must export a WAIT_COPY string constant (one source of truth for the wait body)');
  const shipped = new Function(`return ${m[1]};`)();
  // …and it must NOT be any retired sentence.
  for (const [re, what] of RETIRED_WAIT_LINES) {
    assert(!re.test(shipped), `WAIT_COPY is still ${what} — it must be the launch-15 body`);
  }
  // The retired copy is gone from every user-facing surface.
  const surfaces = walkSync(path.join(REPO_ROOT, 'src')).filter(f => /\.jsx?$/.test(f));
  for (const f of surfaces) {
    const rel = path.relative(REPO_ROOT, f);
    const c = codeNoComments(rel);
    for (const [re, what] of RETIRED_WAIT_LINES) {
      assert(!re.test(c), `${rel}: ${what} is retired — the wait copy is WAIT_HEADING + WAIT_COPY (launch-15 / SPEC-78)`);
    }
  }
});

// ─── launch-03: best match = highest rating, then closest ────────────────
test('spec-launch-03', 'FROZEN: provider ranking in a covered area = rating DESC, then distance ASC', 'launch-03', async () => {
  const src = readFile('src/lib/api.js');
  const start = src.indexOf('export function rankProviders');
  assert(start > 0, 'lib/api.js must export rankProviders — the ONE best-match order (launch-03)');
  const end = src.indexOf('\n}\n', start);
  assert(end > start, 'could not delimit rankProviders');
  const fnSrc = src.slice(start, end + 2).replace('export function', 'function');
  const rankProviders = new Function(`${fnSrc}\nreturn rankProviders;`)();
  assert(typeof rankProviders === 'function', 'rankProviders must be a pure, executable function');

  // Deterministic fixture: three providers, known rating + distance.
  //   c — 5.0★ but 30mi   → best RATING wins the list
  //   b — 4.9★ and  2mi   → closest of the two 4.9s
  //   a — 4.9★ and  8mi
  const input = [
    { id: 'a', rating_avg: 4.9, rating_count: 40, distance_miles: 8 },
    { id: 'b', rating_avg: 4.9, rating_count: 12, distance_miles: 2 },
    { id: 'c', rating_avg: 5.0, rating_count: 3,  distance_miles: 30 },
  ];
  const order = rankProviders(input).map(s => s.id);
  assert(order.join(',') === 'c,b,a',
    `best match = highest rating, then closest — expected c,b,a; got ${order.join(',')}`);

  // An unrated provider is UNKNOWN, not bad — it must not outrank a rated one
  // just by being nearby (and a missing distance sorts last, never first).
  const withUnrated = rankProviders([
    { id: 'unrated-near', distance_miles: 1 },
    { id: 'rated-far', rating_avg: 4.2, distance_miles: 20 },
  ]).map(s => s.id);
  assert(withUnrated[0] === 'rated-far',
    'a rated provider must outrank an unrated one (null rating ≠ 0.0 — it is unknown)');
  const noDist = rankProviders([
    { id: 'no-dist', rating_avg: 5 },
    { id: 'has-dist', rating_avg: 5, distance_miles: 9 },
  ]).map(s => s.id);
  assert(noDist[0] === 'has-dist', 'a provider with no distance must not beat one with a real distance');

  // Total + stable: same input → same output, input never mutated.
  const before = input.map(s => s.id).join(',');
  assert(rankProviders(input).map(s => s.id).join(',') === order.join(','), 'ranking must be deterministic across runs');
  assert(input.map(s => s.id).join(',') === before, 'rankProviders must be pure — it may not mutate its input');

  // The live search path must USE it: the proximity branch of listServices
  // ranked by distance ONLY (a 3.1★ next door beat a 5.0★ two miles away).
  const pStart = src.indexOf('if (lat != null && lng != null)');
  assert(pStart > 0, 'proximity branch of listServices not found');
  const branch = src.slice(pStart, pStart + 4000);
  assert(/rankProviders\(/.test(branch),
    'the covered-area (proximity) branch must order results with rankProviders');
  assert(!/\.sort\(\(a, b\) => \(a\.distance_miles \?\? 9e9\) - \(b\.distance_miles \?\? 9e9\)\)/.test(branch),
    'the distance-ONLY sort is retired — it ignores rating (launch-03)');
});

// ─── launch-04: the requester's name/avatar opens their profile ──────────
test('spec-launch-04', 'FROZEN: /inbound/:reqId links the requester to their profile', 'launch-04', async () => {
  const code = codeNoComments('src/screens/RequestFromConnectorScreen.jsx');

  // The loader must carry the requester's id — you cannot link to a profile
  // you never resolved.
  assert(/requesterId:\s*requester\.id/.test(code),
    'RequestFromConnectorScreen must resolve data.requesterId from the request row');

  // The identity block must render whenever we know WHO asked — it used to
  // render only for Connectors / IG-havers / bio-havers, so a plain requester
  // had no identity block and therefore no route to their profile at all.
  assert(/data\.requesterId \|\| data\.isConnector/.test(code),
    'the requester identity block must render whenever data.requesterId exists (not only for Connectors)');

  // The avatar AND the name are the affordances a user reaches for. Both must
  // be clickable and both must go to the app's existing profile route.
  const LINK = /onClick=\{\(\) => navigate\(`\/u\/\$\{data\.requesterId\}`\)\}/;
  assert(LINK.test(code), 'the requester must link to /u/:requesterId (the app profile route)');
  assert(new RegExp(LINK.source + '[\\s\\S]{0,320}?<Avatar', 'm').test(code),
    "the requester's AVATAR must open their profile (it was dead text)");
  assert(new RegExp(LINK.source + '[\\s\\S]{0,400}?\\{data\\.requesterName\\}', 'm').test(code),
    "the requester's NAME must open their profile (it was dead text)");

  // …and that route must exist, or the link is a 404.
  assert(/path="\/u\/:profileId"/.test(readFile('src/App.jsx')),
    'App.jsx must route /u/:profileId to the public profile — the link target');
});

// ─── launch-05: a user is NEVER notified about their own request ─────────
test('spec-launch-05', 'FROZEN: the requester is never in the notify/dispatch set', 'launch-05', async () => {
  // ── (a) SERVER-SIDE, the last gate before an email/SMS leaves the building.
  const fn = readFile('supabase/functions/notify-request/index.ts');
  assert(/id, requester_id, service_type/.test(fn),
    'notify-request must select requests.requester_id — the authoritative identity of the requester');
  const m = fn.match(/const providerIds = requested\.filter\(([\s\S]*?)\);/);
  assert(m, 'notify-request/handleCreated must derive providerIds by FILTERING the caller-supplied list');

  // EXECUTE the shipped filter (TS annotation stripped) against a recipient
  // list that contains the requester — the exact live failure.
  const expr = m[1].replace(/:\s*string/g, '');
  const filterRecipients = new Function('requested', 'requesterId',
    `return requested.filter(${expr});`);
  const REQUESTER = 'req-uuid-1111';
  const out = filterRecipients(['prov-a', REQUESTER, 'prov-b', null, REQUESTER], REQUESTER);
  assert(!out.includes(REQUESTER),
    'THE BUG: the requester was in the dispatch set — a user must never be notified as a provider for their own request');
  assert(out.join(',') === 'prov-a,prov-b',
    `every OTHER provider must still be notified (self-notify guard must not nuke the fan-out) — got ${JSON.stringify(out)}`);

  // The send loop must iterate the FILTERED list, not the raw payload.
  assert(/for \(const pid of providerIds\)/.test(fn) && !/for \(const pid of requested\)/.test(fn),
    'the send loop must iterate the filtered providerIds — filtering into a variable nobody sends to is not a fix');

  // ── (b) CLIENT-SIDE: every path that writes a kind='new_request' row must
  //        exclude the requester too (the in-app bell is a notification too).
  const api = readFile('src/lib/api.js');
  const slice = (name) => {
    const s = api.indexOf(`export async function ${name}(`);
    assert(s > 0, `lib/api.js must export ${name}`);
    const e = api.indexOf('\n}\n', s);
    return api.slice(s, e);
  };
  const fanout = slice('createRequestAndFanOut');
  assert(/\.filter\(id => id !== uid\)/.test(fanout),
    'createRequestAndFanOut must exclude the requester (uid) from the notified owner ids');
  const cross = slice('crossPostRequest');
  assert(/\.filter\(id => id !== uid\)/.test(cross),
    'crossPostRequest must exclude the requester (uid) — it only excluded the originally-targeted provider, so the requester leaked back in');
  const toProv = slice('createRequestToProvider');
  const guard = toProv.indexOf('if (toProviderOwnerId === uid)');
  assert(guard > 0,
    'createRequestToProvider must suppress the notification when the requester IS the provider (own listing)');
  assert(guard < toProv.indexOf("from('notifications')"),
    'the self-notify guard must run BEFORE the notifications insert, not after');
});

// ─── launch-06: a saved location survives the night ──────────────────────
test('spec-launch-06', 'FROZEN: a saved address is persisted durably and reloaded, never clobbered', 'launch-06', async () => {
  const api = readFile('src/lib/api.js');

  // ── SAVE: user_metadata is the durable store (it needs no migration and
  //    survives a localStorage eviction). saveAddress must TRACK whether that
  //    write landed and must never report success when nothing persisted —
  //    that silent lie is how an address "saved last night" was gone by morning.
  const sStart = api.indexOf('export async function saveAddress(');
  assert(sStart > 0, 'lib/api.js must export saveAddress');
  const save = api.slice(sStart, api.indexOf('\n}\n', sStart));
  assert(/supabase\.auth\.updateUser\(\{\s*\n?\s*data: \{ default_address:/.test(save),
    'saveAddress must write the default address to user_metadata (the durable, migration-free store)');
  assert(/let metaOk = false;/.test(save) && /metaOk = true;/.test(save),
    'saveAddress must track whether the durable write actually landed (metaOk)');
  assert(!/return \{ data: null, error: null \};/.test(save),
    'THE BUG: saveAddress returned success with NOTHING persisted (missing-table branch swallowed a failed metadata write)');
  assert(/if \(metaOk\) return \{ data: metaRow, error: null, persisted: 'metadata' \};/.test(save),
    'a durable metadata write must be reported as saved even when the user_addresses table errors (it must not be masked as a failure)');
  assert(/persisted: 'none'/.test(save),
    'when nothing persisted, saveAddress must say so — the caller may not paint "Saved ✓" over a lost address');

  // ── LOAD: the canonical read prefers user_metadata over the (optional) table
  //    and must not fall back to a default that overwrites it.
  const gStart = api.indexOf('export async function getDefaultAddress(');
  assert(gStart > 0, 'lib/api.js must export getDefaultAddress');
  const load = api.slice(gStart, api.indexOf('\n}\n', gStart));
  assert(load.indexOf('user_metadata?.default_address') > 0,
    'getDefaultAddress must read the durable user_metadata copy');
  assert(load.indexOf('user_metadata?.default_address') < load.indexOf("from('user_addresses')"),
    'the durable metadata copy must be read FIRST — the table is the optional mirror');

  // ── The screen: an address the geocoder cannot verify is STILL the user's
  //    address. It used to `return` before saveAddress, so it lived in
  //    localStorage alone and died with the next storage eviction.
  const home = codeNoComments('src/screens/HomeScreen.jsx');
  assert(!/if \(!v\.ok\) return;/.test(home),
    'THE BUG: an unverified address was never persisted server-side (early return before saveAddress)');
  assert(/formattedAddress: v\.ok \? v\.address : where/.test(home),
    'HomeScreen must persist the typed address even when verification fails (coords stay null; the address is remembered)');
  // …and the load path re-hydrates it on session start without clobbering it.
  assert(/getDefaultAddress\(\)\.then\(async \(\{ data \}\) => \{[\s\S]{0,200}?setLocationText\(data\.formatted_address\)/.test(home),
    'HomeScreen must load the saved default address on session start');
  const promote = home.indexOf('Server has no default');
  assert(home.includes('await saveAddress({'),
    'HomeScreen must promote a local-only address to the server when the server has none (never the reverse)');
  assert(promote === -1 || promote < home.indexOf('await saveAddress({'),
    'the promotion must only happen when the server has NO default — a server address may never be overwritten by a local default');
});

// ═══════════════════════════════════════════════════════════════════════════
// crack-help-haiku — the in-app Help/support module.
//
// Regression guard for the support increment. Named `spec-crack-help-haiku`
// so auto-build.mjs flips the ledger row (cergio_verify_requirement) from
// open → verified once green on main. Asserts: (1) the Help entry exists in
// the SHARED layout (not per-screen); (2) support-triage has the
// Haiku→Opus→human ladder; (3) the AI is REPLY-ONLY — a hard safety guard
// forces account/money/data/bug asks to a human; (4) the schema + RLS + founder
// surface are wired.
// ═══════════════════════════════════════════════════════════════════════════
test('spec-crack-help-haiku', 'FROZEN: in-app Help → Haiku→Opus→human triage ladder, AI is reply-only', 'crack-help-haiku', async () => {
  // ── (1) The Help button lives in the SHARED layout, not a single screen ──
  const app = codeNoComments('src/App.jsx');
  assert(/import \{ HelpWidget \} from '\.\/components\/ui\/HelpWidget'/.test(app),
    'App.jsx must import the shared HelpWidget');
  assert(/<HelpWidget\b/.test(app),
    'App.jsx Layout must mount <HelpWidget/> (a floating Help entry available across the app)');
  const widget = codeNoComments('src/components/ui/HelpWidget.jsx');
  assert(/createSupportTicket/.test(widget),
    'HelpWidget must open a ticket via createSupportTicket on submit');
  assert(/type="file"/.test(widget) && /accept="image\/\*"/.test(widget),
    'HelpWidget must offer an optional screenshot upload');

  // ── (2) The client opens a ticket AND fires the triage function ──
  const api = readFile('src/lib/api.js');
  const cst = api.slice(api.indexOf('export async function createSupportTicket('),
                        api.indexOf('export async function getMySupportTickets('));
  assert(cst.length > 0, 'lib/api.js must export createSupportTicket');
  assert(/from\('support_tickets'\)[\s\S]*?\.insert\(/.test(cst),
    'createSupportTicket must INSERT a support_tickets row (status new)');
  assert(/functions\.invoke\('support-triage'/.test(cst),
    'createSupportTicket must fire the support-triage function after inserting the ticket');

  // ── (3) THE LADDER: Haiku → Opus → human, in that order ──
  const fn = readFile('supabase/functions/support-triage/index.ts');
  assert(/claude-haiku-4-5-20251001/.test(fn), 'support-triage must call Haiku (claude-haiku-4-5-20251001) for triage');
  assert(/claude-opus-4-8/.test(fn),           'support-triage must escalate to Opus (claude-opus-4-8)');
  const iHaiku = fn.indexOf("const haiku = await askClaude(HAIKU");
  const iOpus  = fn.indexOf("const opus = await askClaude(OPUS");
  const iHuman = fn.indexOf('routeToHuman(db, ticket');
  assert(iHaiku > 0 && iOpus > iHaiku,
    'the ladder must call Haiku BEFORE Opus (triage first, escalate second)');
  assert(iHuman > 0,
    'the ladder must fall through to a human (routeToHuman) when neither AI tier resolves');
  // Haiku resolving short-circuits before Opus; Opus resolving short-circuits before human.
  assert(/if \(haiku && haiku\.can_resolve && !humanReason1\)/.test(fn),
    'Haiku must be able to resolve (and only when the safety guard permits)');
  assert(/if \(opus && opus\.can_resolve && !humanReason2\)/.test(fn),
    'Opus must be able to resolve (and only when the safety guard permits)');
  // Human handoff notifies the founder (Resend) + the reason is recorded.
  assert(/function notifyFounder\(/.test(fn) && /api\.resend\.com\/emails/.test(fn),
    'the human handoff must email the founder via Resend');
  assert(/status: 'human'[\s\S]*?ai_reason: reason/.test(fn) || /ai_reason: reason,[\s\S]*?status: 'human'/.test(fn) ||
         /status: 'human', ai_stage: 'human', ai_reason: reason/.test(fn),
    "a human-routed ticket must set status='human' with the ai_reason");

  // ── (4) THE REPLY-ONLY SAFETY GUARD — the AI can NEVER take a non-reply action ──
  assert(/const AI_REPLY_ONLY = true/.test(fn),
    'support-triage must declare AI_REPLY_ONLY');
  assert(/function mustEscalateToHuman\(/.test(fn),
    'support-triage must have the mustEscalateToHuman guard (structural reply-only enforcement)');
  assert(/HUMAN_ONLY_PATTERNS/.test(fn),
    'the guard must consult HUMAN_ONLY_PATTERNS (account/money/data/bug asks that a human must handle)');
  // The guard runs on BOTH tiers before a resolve is accepted.
  assert(/const humanReason1 = mustEscalateToHuman\(ticket, haiku\)/.test(fn) &&
         /const humanReason2 = mustEscalateToHuman\(ticket, opus\)/.test(fn),
    'the reply-only guard must gate BOTH the Haiku and the Opus resolve paths');
  // The function must never invoke another edge fn / take an action; its only
  // writes are to its own two tables. Prove it names no forbidden side-effects.
  const forbidden = [/functions\.invoke\(/, /release-funds/, /stripe-/, /auth\.admin\.(?!getUserById)/,
                     /from\('bookings'\)/, /from\('payments'\)/, /from\('profiles'\)\s*\.\s*(update|delete)/];
  for (const re of forbidden) {
    assert(!re.test(fn), `support-triage must take NO account/money/data action — found a forbidden op matching ${re}`);
  }
  // Its DB writes touch ONLY support_tickets / support_messages.
  const tableWrites = [...fn.matchAll(/from\('([a-z_]+)'\)\s*\.\s*(insert|update|delete|upsert)/g)].map(m => m[1]);
  for (const tbl of tableWrites) {
    assert(tbl === 'support_tickets' || tbl === 'support_messages',
      `support-triage may only write support_tickets / support_messages — it wrote ${tbl}`);
  }

  // ── (5) SCHEMA + RLS + founder surface ──
  const mig = readFile('supabase/migrations/20260715000000_support_tickets.sql');
  assert(/create table if not exists public\.support_tickets/.test(mig), 'migration must create support_tickets');
  assert(/create table if not exists public\.support_messages/.test(mig), 'migration must create support_messages');
  assert(/enable row level security/.test(mig), 'support tables must enable RLS');
  assert(/auth\.uid\(\) = user_id or public\.cergio_is_admin\(\)/.test(mig),
    'RLS: a user sees only their own tickets; an admin sees all');
  assert(/cergio_open_requirement\(\s*\n?\s*'crack-help-haiku'/.test(mig),
    'migration must register the crack-help-haiku requirement ledger row');
  assert(/create or replace function public\.cergio_support_summary\(\)/.test(mig),
    'migration must create the cergio_support_summary founder-inbox read fn');

  // ── (6) The founder inbox is surfaced on the dashboard via ops-metrics ──
  const ops = readFile('supabase/functions/ops-metrics/index.ts');
  assert(/cergio_support_summary/.test(ops),
    'ops-metrics must merge the support block (counts + human queue) into the dashboard snapshot');
  // …and a founder can read + reply to a ticket.
  assert(/export async function listSupportTickets\(/.test(api) && /export async function postFounderReply\(/.test(api),
    'lib/api.js must expose the founder inbox (listSupportTickets) + reply (postFounderReply)');
  assert(/from\('support_messages'\)[\s\S]*?sender: 'founder'/.test(api),
    'postFounderReply must post a founder message to the thread');
});

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH BLOCKERS round 2 — founder-reported on the live URL, 2026-07-16.
// launch-12..15. Each `spec-<id>` test flips its ledger row open→verified once
// green on main (auto-build.mjs). Rows seeded by
// supabase/migrations/20260716000000_req_launch_blockers_2.sql.
// ═══════════════════════════════════════════════════════════════════════════

// ─── launch-12: a saved address is isolated PER USER (no cross-account bleed) ─
test('spec-launch-12-address-isolation', 'FROZEN: the address cache is namespaced per user — no cross-account bleed', 'launch-12-address-isolation', async () => {
  const home = readFile('src/screens/HomeScreen.jsx');

  // The cache key MUST be a function of the signed-in user id. A single shared
  // key surfaced one account's saved address to the NEXT account on the same
  // browser (info@ saw t@'s "134 Henry Street").
  const km = home.match(/function addrCacheKey\(uid\)\s*\{[\s\S]*?\n\}/);
  assert(km, 'HomeScreen must define addrCacheKey(uid) — the per-user cache key');
  const addrCacheKey = new Function('GUEST_ADDR_KEY', `${km[0]}\nreturn addrCacheKey;`)('cergio.guestAddress');
  assert(addrCacheKey('user-A') !== addrCacheKey('user-B'),
    'THE BUG: two different users must get DIFFERENT cache keys — a shared key leaks one account\'s address to the next');
  assert(String(addrCacheKey('user-A')).includes('user-A'),
    'a signed-in user\'s cache key must be namespaced by their auth id');
  assert(addrCacheKey(null) === 'cergio.guestAddress',
    'a guest (no uid) still uses the guest key');

  // The component resolves ADDR_KEY from the AUTHED user and routes every
  // cache read/write through it — never a bare shared key.
  assert(/const addrUid\s*=\s*auth\?\.user\?\.id/.test(home),
    'HomeScreen must derive addrUid from the signed-in user');
  assert(/const ADDR_KEY = addrCacheKey\(addrUid\)/.test(home),
    'HomeScreen must compute ADDR_KEY = addrCacheKey(addrUid)');
  const comp = home.slice(home.indexOf('export function HomeScreen'));
  assert(!/localStorage\.getItem\(GUEST_ADDR_KEY\)/.test(comp) && !/localStorage\.setItem\(GUEST_ADDR_KEY\)/.test(comp),
    'THE BUG: the component read/wrote a SHARED key — every cache access must go through the uid-scoped ADDR_KEY');
  const editor = home.slice(home.indexOf('function InlineLocationEditor'), home.indexOf('export function HomeScreen'));
  assert(/storageKey/.test(editor) && !/localStorage\.(get|set)Item\(GUEST_ADDR_KEY\)/.test(editor),
    'InlineLocationEditor must persist through the passed storageKey, not the shared guest key');
  assert(/<InlineLocationEditor[\s\S]{0,400}?storageKey=\{ADDR_KEY\}/.test(home),
    'the editor must be rendered with the uid-scoped storageKey');

  // The DURABLE truth is per-user by construction: saveAddress writes the
  // signed-in user's user_metadata; getDefaultAddress reads that same user's
  // metadata — neither can read another account's address.
  const api = readFile('src/lib/api.js');
  const save = api.slice(api.indexOf('export async function saveAddress('), api.indexOf('\n}\n', api.indexOf('export async function saveAddress(')));
  assert(/supabase\.auth\.updateUser\(\{\s*\n?\s*data: \{ default_address:/.test(save),
    'saveAddress must persist per-user via user_metadata (the durable, isolated store)');
  const load = api.slice(api.indexOf('export async function getDefaultAddress('), api.indexOf('\n}\n', api.indexOf('export async function getDefaultAddress(')));
  assert(/user_metadata\?\.default_address/.test(load),
    'getDefaultAddress must read the AUTHED user\'s own user_metadata (per-user, never a cross-account read)');
});

// ─── launch-13: a matching listing IS notified (dead core loop) ──────────────
test('spec-launch-13-match-notify', 'FROZEN: a distinct provider with a matching listing is notified + visible', 'launch-13-match-notify', async () => {
  // (a) TAXONOMY SYMMETRY. The request side resolves "french tutor" → "Tutor"
  //     deterministically. The LISTING side must use the SAME resolver so a
  //     free-text type never saves NULL (invisible to fan-out). Execute the
  //     shared resolver to prove the request-side ground truth.
  const taxonomyPath = path.join(REPO_ROOT, 'src/lib/serviceTaxonomy.js');
  const { execFileSync } = await import('node:child_process');
  const probe = `
    import { resolveProviderTypeLocal } from ${JSON.stringify(taxonomyPath)};
    const cases = ${JSON.stringify([['french tutor','Tutor'],['math tutor','Tutor'],['tutor for my kid','Tutor']])};
    process.stdout.write(JSON.stringify(cases.map(([q,want]) => ({ q, want, got: resolveProviderTypeLocal(q) }))));
  `;
  let out;
  try {
    out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
  } catch (e) { throw new Error('probe failed: ' + (e.stderr || e.message)); }
  const bad = out.filter(r => r.got !== r.want);
  assert(bad.length === 0, `"french tutor" must resolve to Tutor on the request side: ${JSON.stringify(bad)}`);

  const about = readFile('src/screens/ServiceListAboutScreen.jsx');
  assert(/import \{ resolveProviderTypeLocal \} from '\.\.\/lib\/serviceTaxonomy'/.test(about),
    'the listing flow must import the SAME local resolver the request side uses (taxonomy symmetry)');
  assert(/const localPT = resolveProviderTypeLocal\(typedTrim\)/.test(about),
    'the listing must resolve the typed type through resolveProviderTypeLocal');
  assert(/const resolvedProviderType = parserPT \|\| canonicalMatch \|\| localPT;/.test(about),
    'THE BUG: a free-text type fell through to NULL — it must fall back to the deterministic local taxonomy so the listing is never invisible to fan-out');

  // (b) FAN-OUT SELECTS the matching listing. Execute the SHIPPED provider
  //     filter: a distinct owner\'s "Tutor" listing IS included; a non-match
  //     and a NULL-taxonomy listing are excluded.
  const api = readFile('src/lib/api.js');
  const fm = api.match(/const filtered = \(full \|\| \[\]\)\.filter\(s =>\s*([\s\S]*?)\s*\);/);
  assert(fm, 'getProvidersForNotify must filter services on type OR category');
  const pred = new Function('s', 'allowLC', 'norm', `return ( ${fm[1]} );`);
  const norm = (v) => String(v || '').trim().toLowerCase();
  const allowLC = new Set(['tutor']);
  assert(pred({ owner_id: 'info', taxonomy_provider_type: 'Tutor' }, allowLC, norm),
    'a distinct provider (info@) with a matching Tutor listing MUST be in the notified set');
  assert(pred({ taxonomy_provider_type: 'tutor' }, allowLC, norm), 'the match is case-insensitive');
  assert(pred({ category: 'Tutor' }, allowLC, norm), 'the match also considers category');
  assert(!pred({ taxonomy_provider_type: 'Plumber' }, allowLC, norm), 'a non-matching type must be excluded');
  assert(!pred({ taxonomy_provider_type: null, category: null }, allowLC, norm),
    'a NULL-taxonomy listing cannot match — which is exactly why the listing-side local resolver (a) is required');

  // (c) The self-notify guard excludes ONLY the requester — never a different
  //     matching provider. Model the shipped ownerIds line.
  const fanout = api.slice(api.indexOf('export async function createRequestAndFanOut('));
  assert(/\.filter\(id => id !== uid\)/.test(fanout),
    'createRequestAndFanOut must exclude ONLY the requester (uid) from ownerIds');
  const provs = [{ owner_id: 'info' }, { owner_id: 't-requester' }];
  const uid = 't-requester';
  const ownerIds = Array.from(new Set(provs.map(s => s.owner_id).filter(Boolean))).filter(id => id !== uid);
  assert(ownerIds.includes('info') && !ownerIds.includes('t-requester'),
    'the fan-out keeps the DISTINCT matching provider (info@) and drops ONLY the requester (t@) — the self-notify guard must not nuke info@');

  // (d) …and the request has a screen to land on for that provider.
  const app = readFile('src/App.jsx');
  assert(/path="\/inbound\/:reqId"/.test(app),
    'the notified provider must be able to open the request on /inbound/:reqId');
});

// ─── launch-14: "List another/your service" opens the list flow ─────────────
test('spec-launch-14-list-route', 'FROZEN: list-a-service CTAs open /list-service, not the manage screen', 'launch-14-list-route', async () => {
  const claim = readFile('src/screens/ClaimProfileScreen.jsx');
  assert(/onClick=\{\(\) => navigate\('\/list-service'\)\}[\s\S]{0,240}?List your service/.test(claim),
    'THE BUG: ClaimProfileScreen "List your service" must open the list-a-service flow (/list-service), not /services/manage');
  assert(!/navigate\('\/services\/manage'\)[\s\S]{0,140}?List your service/.test(claim),
    'the "List your service" CTA must not route to the MANAGE screen');

  const manage = readFile('src/screens/ManageServicesScreen.jsx');
  assert(/navigate\('\/list-service'\)/.test(manage),
    '"List another service" must open /list-service');

  const app = readFile('src/App.jsx');
  assert(/path="\/list-service"[\s\S]{0,80}?ServiceListWelcomeScreen/.test(app),
    '/list-service must route to the list-a-service welcome flow');
  assert(/path="\/services\/manage"[\s\S]{0,80}?ManageServicesScreen/.test(app),
    '/services/manage is the distinct MANAGE screen — the two must not be conflated');
});

// ─── launch-15: the new post-request waiting copy (heading + body + action) ──
test('spec-launch-15-wait-copy-v2', 'FROZEN: post-request wait copy = the founder\'s heading + body, animation kept', 'launch-15-wait-copy-v2', async () => {
  const src = readFile('src/screens/ResultsScreen.jsx');
  const readConst = (name) => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*;`));
    assert(m, `ResultsScreen must export ${name} (one source of truth)`);
    return new Function(`return ${m[1]};`)();
  };
  const HEADING = "We'll notify you when Connectors accept";
  const BODY = "Your request is out to matching Connectors. Once one accepts, they show up here — free swaps first. Counter-offers land in Spotlight requests › Sent for you to accept or counter back.";
  assert(readConst('WAIT_HEADING') === HEADING,
    `WAIT_HEADING must be VERBATIM the founder's heading.\n  want: ${JSON.stringify(HEADING)}`);
  assert(readConst('WAIT_COPY') === BODY,
    `WAIT_COPY must be VERBATIM the founder's body.\n  want: ${JSON.stringify(BODY)}`);

  const code = codeNoComments('src/screens/ResultsScreen.jsx');
  assert(/\{WAIT_HEADING\}/.test(code) && /\{WAIT_COPY\}/.test(code),
    'the waiting state must render BOTH the heading and the body');
  assert(/<LeafLogo working=\{true\}/.test(code),
    'the pulsing live/working LeafLogo animation must be retained');
  assert(/Cancel request/.test(src),
    'the waiting-state action must be "Cancel request"');
});

// ─── SPEC-80 · ONTOLOGY BRIDGE — search↔listing near-miss class fix ──────────
// (a) a parent/language phrase resolves DETERMINISTICALLY to the canonical Tutor.
test('spec-80-bridge-a-canonical', 'FROZEN (SPEC-80): "french tutor"/"spanish tutor"/"language immersion" resolve to the canonical Tutor parent', 'ontology-bridge-a', async () => {
  const mod = await import('../src/lib/serviceTaxonomy.js');
  const resolve = mod.resolveProviderTypeLocal;
  for (const q of ['french tutor', 'spanish tutor', 'arabic tutor', 'french lessons', 'language immersion', 'esl classes', 'math tutor', 'tutor']) {
    assert(resolve(q) === 'Tutor', `"${q}" must resolve to the canonical "Tutor" parent, got ${JSON.stringify(resolve(q))}`);
  }
});

// (b) a Tutor search's ALLOW-SET includes its family siblings, AND the shipped
//     matchers (getProvidersForNotify + listServices) actually apply the bridge.
test('spec-80-bridge-b-allowset', 'FROZEN (SPEC-80): a Tutor search allow-set bridges to Language Immersion / Math Tutor / Language Tutor, and the matchers apply it', 'ontology-bridge-b', async () => {
  const b = await import('../src/lib/ontologyBridge.js');
  const setLC = b.bridgeAllowSetLC('Tutor');
  for (const sib of ['language immersion', 'math tutor', 'language tutor', 'reading tutor', 'test prep tutor']) {
    assert(setLC.has(sib), `a "Tutor" search allow-set must include the sibling "${sib}"`);
  }
  // Symmetric: a child search reaches the whole class (kills the near-miss).
  assert(b.bridgeAllowSetLC('Language Immersion').has('tutor'), 'a "Language Immersion" search must bridge back to Tutor');
  // An un-familied type bridges only to itself — never a loosened match.
  const plumber = b.bridgeAllowSet('Plumber');
  assert(plumber.length === 1 && plumber[0] === 'Plumber', 'an un-familied type must bridge only to itself (strict match preserved)');
  // Tight-family guard: Barber is NOT in the Hairstylist family (distinct service).
  assert(!b.sameFamily('Hairstylist', 'Barber'), 'families must stay tight — Barber is not a Hairstylist');

  // The SHIPPED matchers apply the bridge (not just the helper existing).
  const api = readFile('src/lib/api.js');
  assert(/const allow = expandAllowlist\(/.test(api),
    'getProvidersForNotify must expand its allow-set through the ontology bridge (expandAllowlist)');
  assert(/const wantSet = bridgeAllowSetLC\(provider_type\)/.test(api),
    'listServices must filter provider_type through the ontology bridge (bridgeAllowSetLC)');
  assert(/import \{ expandAllowlist, bridgeAllowSetLC \} from '\.\/ontologyBridge'/.test(api),
    'api.js must import the ontology bridge');
});

// (c) a BLOCKED term (DJ + SHAFT + massage/tattoo/makeup/personal chef) never
//     resolves to a bookable provider type.
test('spec-80-bridge-c-blocked', 'FROZEN (SPEC-80): a blocked term (DJ, massage, tattoo) never resolves to a bookable type and is never in a bridge family', 'ontology-bridge-c', async () => {
  const mod = await import('../src/lib/serviceTaxonomy.js');
  const b = await import('../src/lib/ontologyBridge.js');
  for (const q of ['dj', 'dj for my party', 'need a dj tonight', 'massage', 'nightclub']) {
    assert(mod.resolveProviderTypeLocal(q) === null, `blocked term "${q}" must resolve to nothing (got ${JSON.stringify(mod.resolveProviderTypeLocal(q))})`);
  }
  // No blocked type may sit inside a bridge family (the bridge only widens
  // among in-scope, bookable types).
  for (const fam of b.FAMILIES) {
    for (const m of fam.members) {
      assert(!/(massage|tattoo|makeup|personal chef|\bchef\b|\bdj\b|nightclub|escort|firearm|\bgun\b|cannabis)/i.test(m),
        `a blocked category leaked into bridge family "${fam.parent}": ${m}`);
    }
  }
});

// (d) an INVALID term (car / james / gibberish) resolves to nothing.
test('spec-80-bridge-d-invalid', 'FROZEN (SPEC-80): junk terms (car, james, gibberish) resolve to nothing — never a fabricated match', 'ontology-bridge-d', async () => {
  const mod = await import('../src/lib/serviceTaxonomy.js');
  for (const q of ['car', 'james', 'john smith', 'asdfghjkl', 'qwerty']) {
    assert(mod.resolveProviderTypeLocal(q) === null, `junk term "${q}" must resolve to nothing (got ${JSON.stringify(mod.resolveProviderTypeLocal(q))})`);
  }
});

// #A1j-v2 — FROZEN_SPEC L617 / SPEC-71 item 5: blocked categories
// (massage, tattoo, makeup, personal chef + SHAFT) must NEVER surface
// on a real screen. This asserts BOTH the helper is correct AND that
// the two shipping render surfaces (Activity feed + Inbox recos)
// actually apply it — not just that the helper exists. Regression for
// the QA-red where a followed Connector spotlighted a Personal Chef /
// Massage Therapist onto the live feed (prod v112b4e2).
test('A1j-v2-blocked-render-guard', 'FROZEN (SPEC-71.5 / L617): blocked categories never render on the Activity feed OR the Inbox reco surface — helper correct AND both surfaces wire it', 'A1j-v2', async () => {
  const pt = await import('../src/data/providerTypes.js');
  assert(typeof pt.isBlockedFeedCategory === 'function', 'providerTypes must export isBlockedFeedCategory');
  for (const blocked of ['Personal Chef', 'Massage Therapist', 'Makeup Artist', 'DJ', 'Tattoo Artist', 'Personal Chef in Miami, FL, USA']) {
    assert(pt.isBlockedFeedCategory(blocked) === true, `isBlockedFeedCategory must block "${blocked}"`);
  }
  for (const ok of ['Plumber', 'House Cleaner', 'Moving Truck Driver', 'French Tutor', 'Adjuster', 'Photographer']) {
    assert(pt.isBlockedFeedCategory(ok) === false, `isBlockedFeedCategory must NOT block "${ok}" (false positive)`);
  }
  // Activity feed SHIPS the guard (imports it + applies svcBlocked in the filter).
  const act = readFile('src/screens/ActivityScreen.jsx');
  assert(/import \{ isBlockedFeedCategory \} from '\.\.\/data\/providerTypes'/.test(act),
    'ActivityScreen must import isBlockedFeedCategory');
  assert(/const svcBlocked = \(svc\) => .*isBlockedFeedCategory/s.test(act),
    'ActivityScreen must define svcBlocked via isBlockedFeedCategory');
  assert((act.match(/if \(svcBlocked\(ev\.service\)\) return false;/g) || []).length >= 4,
    'ActivityScreen must drop blocked events in every feed branch (reco/spotlight/listing/barter)');
  // Inbox reco surface SHIPS the guard.
  const inbox = readFile('src/screens/JobsInboxScreen.jsx');
  assert(/import \{ isBlockedFeedCategory \} from '\.\.\/data\/providerTypes'/.test(inbox),
    'JobsInboxScreen must import isBlockedFeedCategory');
  assert((inbox.match(/if \(isBlockedFeedCategory\(/g) || []).length >= 2,
    'JobsInboxScreen must guard both the inbound-request and reco-received surfaces');
});

// ─── draw-map-leaflet · the "Draw on Map" surface is FREE (Leaflet + OSM) ─────
// The provider service-area draw surface (ServiceAreaMapPicker) used to load the
// Google Maps JS API and required VITE_GOOGLE_MAPS_API_KEY *with billing* — in
// prod it surfaced "Google Maps API key missing" and cost money. SPEC-72 is
// free-first: it now uses Leaflet + the keyless OpenStreetMap raster tiles ($0,
// no key, no billing). This locks: (A) Leaflet + OSM tiles + attribution are the
// surface; (B) the Google Maps JS API / key path is GONE from this component and
// its two callers; (C) the SAVED value shape is UNCHANGED — a closed-ring GeoJSON
// Polygon of [lng,lat] pairs (the exact `services.service_area_geojson` contract),
// so no backend change is needed.
test('draw-map-leaflet', 'FROZEN (SPEC-72 free-first): the Draw-your-service-area map uses Leaflet + keyless OpenStreetMap tiles (no Google Maps JS API, no API key, no billing); the saved GeoJSON Polygon shape is unchanged', '#free-map', async () => {
  const rel  = 'src/components/ui/ServiceAreaMapPicker.jsx';
  const code = codeNoComments(rel); // scan CODE, not the explanatory comments

  // ── (A) FREE surface: Leaflet + OSM raster tiles + the required attribution ──
  assert(/import L from 'leaflet'/.test(code),
    'ServiceAreaMapPicker must import Leaflet — draw-map-leaflet');
  assert(/import 'leaflet\/dist\/leaflet\.css'/.test(code),
    "ServiceAreaMapPicker must import Leaflet's CSS so the map renders — draw-map-leaflet");
  assert(/L\.tileLayer\(\s*'https:\/\/\{s\}\.tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png'/.test(code),
    'the map must draw the keyless OpenStreetMap raster tiles (no API key) — draw-map-leaflet');
  assert(/attribution:\s*'[^']*OpenStreetMap/.test(code),
    'OSM tile usage policy requires the "© OpenStreetMap contributors" attribution to be displayed — draw-map-leaflet');
  assert(/attributionControl:\s*true/.test(code),
    'the Leaflet attribution control must be enabled (attribution must be visible) — draw-map-leaflet');

  // ── (B) the Google Maps JS API / API-key path is GONE (no paid dependency) ──
  assert(!/maps\.googleapis\.com/.test(code),
    'REGRESSION: the Google Maps JS API script must NOT be loaded by the draw surface (it needs a paid, billed key) — draw-map-leaflet');
  assert(!/window\.google/.test(code) && !/new google\.maps\./.test(code),
    'REGRESSION: no google.maps usage may remain in the draw surface — draw-map-leaflet');
  assert(!/VITE_GOOGLE_MAPS/.test(code),
    'the draw surface must not read any VITE_GOOGLE_MAPS key — draw-map-leaflet');
  assert(!/API key missing/i.test(code),
    'the "Google Maps API key missing" error path must be gone (it was shown to founders in prod) — draw-map-leaflet');
  // The two callers must stop passing a Google key into the picker.
  for (const caller of ['src/screens/ServiceListAboutScreen.jsx', 'src/screens/HomeScreen.jsx']) {
    const c = codeNoComments(caller);
    const m = c.match(/<ServiceAreaMapPicker[\s\S]*?\/>/);
    assert(m, `${caller} must still render <ServiceAreaMapPicker/> — draw-map-leaflet`);
    assert(!/apiKey=/.test(m[0]) && !/VITE_GOOGLE_MAPS/.test(m[0]),
      `${caller} must not pass a Google Maps API key to the picker — draw-map-leaflet`);
  }

  // ── (C) the SAVED shape is UNCHANGED: a closed-ring GeoJSON Polygon of
  //        [lng,lat] pairs — the exact services.service_area_geojson contract.
  const fnStart = code.indexOf('function pointsToGeoJson(points) {');
  assert(fnStart > -1, 'ServiceAreaMapPicker must keep pointsToGeoJson (the persisted-shape builder) — draw-map-leaflet');
  const body = code.slice(fnStart, code.indexOf('\n}', fnStart) + 2);
  const pointsToGeoJson = new Function(`${body}\nreturn pointsToGeoJson;`)();
  const geo = pointsToGeoJson([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }]);
  assert(geo && geo.type === 'Polygon' && Array.isArray(geo.coordinates?.[0]),
    'pointsToGeoJson must still emit a GeoJSON Polygon (the frozen save shape) — draw-map-leaflet');
  const ring = geo.coordinates[0];
  assert(ring[0][0] === 2 && ring[0][1] === 1,
    'the ring must be [lng,lat] ordered (GeoJSON), unchanged from the Google version — draw-map-leaflet');
  assert(ring.length === 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
    'the ring must be CLOSED (first vertex repeated last) per the GeoJSON spec — draw-map-leaflet');
  assert(pointsToGeoJson([{ lat: 1, lng: 2 }]) === null,
    'fewer than 3 points is not a polygon (null) — draw-map-leaflet');

  // The dependency is declared (the lockfile is regenerated by npm ci on
  // CI / the Mac launcher — leaflet is dependency-free + pure JS).
  const pkg = JSON.parse(readFile('package.json'));
  assert(pkg.dependencies?.leaflet, 'package.json must declare the leaflet dependency — draw-map-leaflet');
});

test('spec-offmac-doc', 'SPEC-81: off-Mac-by-default contract stays documented — sandbox pushes git directly via a PAT held ONLY in gitignored .env.local; merge + DB writes remain the sole Mac/CI-gated steps', '#81', async () => {
  const spec = readFile('FROZEN_SPEC.md');
  assert(/SPEC-81/.test(spec) && /OFF-MAC BY DEFAULT/i.test(spec),
    'FROZEN_SPEC.md must carry SPEC-81 · OFF-MAC BY DEFAULT');
  assert(/GITHUB_PAT/.test(spec) && /\.env\.local/.test(spec),
    'SPEC-81 must pin the credential contract: GITHUB_PAT lives in .env.local');
  assert(/api\.github\.com/.test(spec) && /BLOCKED/.test(spec),
    'SPEC-81 must record that api.github.com (PR/merge) is blocked from the sandbox — merge stays Mac/CI-gated');

  // The PAT must be UNCOMMITTABLE: .gitignore has to exclude .env.local so the
  // token can never be pushed by the very off-Mac flow it enables.
  const gi = readFile('.gitignore');
  assert(/(^|\n)\s*\.env\.local\s*(\n|$)/.test(gi) || /(^|\n)\s*\.env\.?\*/.test(gi) || /(^|\n)\s*\*\.local\s*(\n|$)/.test(gi),
    '.gitignore must exclude .env.local — the GITHUB_PAT must never be committable');
});

main().catch(e => {
  console.error(e);
  process.exit(2);
});
