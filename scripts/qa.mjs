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
