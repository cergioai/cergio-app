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
    ['massage therapist',                  'Massage Therapist'],

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

// ─── INVARIANT #30: LeafLogo is the sprout v2 (two-leaf, stem, dew) ─────
// User chose option B (sprout) on 2026-05-28. The geometry MUST be
// the two-leaf sprout — single-lobed-leaf-only is a regression.
// Multi-motion CSS classes must also be wired so the plant breathes.
test('sprout-logo', 'LeafLogo renders the sprout v2 (two leaves + stem + dew + multi-motion)', '#30', async () => {
  const src = readFile('src/components/ui/LeafLogo.jsx');
  const code = stripComments(src);
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
  // v5 (2026-05-29): 3-scene model — 01 Invite, 02 Earn, 03 Earn More.
  // Headline-first, with explicit 10%/7%/6-month math chip on Scene 2.
  assert(/num:\s*['"]01['"]/.test(cmp) && /num:\s*['"]02['"]/.test(cmp) && /num:\s*['"]03['"]/.test(cmp),
    'Animation must define exactly three phases: 01, 02, 03.');
  // Scene 1 — Invite. Headline must mention invite + recommend.
  assert(/Invite friends/i.test(cmp) && /Recommend services/i.test(cmp),
    'Scene 1 (Invite) must mention "Invite friends" and "Recommend services".');
  // Scene 2 — Earn. Math chip MUST reference both the platform fee and
  // the referrer share — Tarik's "7% is confusing" fix lives or dies here.
  assert(/platformFeePercent/.test(cmp) && /referrerSharePercent/.test(cmp),
    'Scene 2 (Earn) must derive the fee + share from REWARDS — never hardcode the numbers.');
  assert(/friendCapWindowMonths/.test(cmp),
    'Scene 2 (Earn) must surface the 6-month cap window from REWARDS.');
  // Scene 3 — Earn More. Both upside paths (barter + GPI) must appear.
  assert(/spotlights?/i.test(cmp) && /barter/i.test(cmp),
    'Scene 3 (Earn more) must include the Connector barter story.');
  assert(/Growth Participation/.test(cmp),
    'Scene 3 (Earn more) must include Growth Participation Income (GPI).');

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
  assert(/recoNames\s*=\s*Array\.isArray\(svc\.recommenders\)/.test(screenCode),
    'ResultsScreen must derive recoNames from Array.isArray(svc.recommenders).');
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
  // The Book CTA must reuse the existing handleBook flow.
  assert(/handleBook\(provider\)/.test(pdpCode),
    'PDP Book CTA must call handleBook(provider) so the existing booking flow is reused.');

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
  // User-visible labels.
  assert(/Direct/.test(code) && /Chain \+5%/.test(code),
    'Tier pill labels "Direct" and "Chain +5%" must be present.');
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

main().catch(e => {
  console.error(e);
  process.exit(2);
});
