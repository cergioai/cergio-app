// ─────────────────────────────────────────────────────────────────────────────
// Cergio — SEEDED TEST WORLD (increment 1 of the Continuous Testing System).
//
// A reproducible, ISOLATED fixture the live QA suites run against. Every row it
// writes is tagged `seed = true` so production metrics / headlines exclude it,
// and teardown deletes strictly `where seed = true` — a real user row can never
// be caught. Idempotent: stable emails + upserts, safe to re-run.
//
// What it builds (see the README block returned at the end):
//   • Users across CLASSES: consumer, creator/connector, provider, referrer, admin
//   • Across DEGREES of connection: a 1st→2nd→3rd chain so referral / reco chains
//     exist (referrer → consumer → connector → provider).
//   • Connectors + services in MIAMI and one OUT-OF-MIAMI city (Austin) to test
//     multi-city live matches (not just rows).
//   • Real lat/lng on services so services_near returns them (geocode holds).
//   • A referral chain + recommendation rows so degree/reco assertions have data.
//   • Stripe test-mode: providers get a placeholder cc_verified stamp via the
//     IDENTITY_BYPASS path (t@cergio.ai family) — money-path suites use test mode;
//     this runner never touches live Stripe or moves money.
//
// Usage:
//   node scripts/seed-test-world.mjs            # (re)build the seed world
//   node scripts/seed-test-world.mjs --teardown # delete ALL seed=true rows
//   node scripts/seed-test-world.mjs --json      # machine-readable census
//
// Requires cergio-app/.env.local with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// No secrets are printed. No npm install — Node built-ins only (fetch, fs, path).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── env (same loader shape as scripts/qa.mjs) ────────────────────────────────
function loadEnv() {
  const p = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(p)) return {};
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const env = loadEnv();
const SUPA_URL = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

const args = new Set(process.argv.slice(2));
const TEARDOWN = args.has('--teardown');
const AS_JSON = args.has('--json');

if (!SUPA_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in cergio-app/.env.local');
  process.exit(2);
}

const REST = `${SUPA_URL}/rest/v1`;
const AUTH = `${SUPA_URL}/auth/v1`;
const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// ── STABLE SEED IDENTITY ─────────────────────────────────────────────────────
// Deterministic emails under a dedicated domain so the seed world is idempotent
// and unmistakably NOT a real user. Password is fixed test-mode.
const SEED_DOMAIN = 'seed.cergio.test';
const SEED_PASSWORD = 'CergioSeed!2026';
const SEED_TAG = 'cergio-qa-seed'; // written into user_metadata for auth-side teardown

async function rest(method, pathAndQuery, body, extraHeaders = {}) {
  const res = await fetch(`${REST}${pathAndQuery}`, {
    method,
    headers: { ...H, Prefer: 'return=representation', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

async function auth(method, pathAndQuery, body) {
  const res = await fetch(`${AUTH}${pathAndQuery}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

// Find-or-create an auth user by email. Idempotent: if the email exists we look
// it up (paginating the admin list) rather than erroring.
async function ensureAuthUser(email, displayName) {
  const create = await auth('POST', '/admin/users', {
    email, password: SEED_PASSWORD, email_confirm: true,
    user_metadata: { display_name: displayName, [SEED_TAG]: true },
  });
  if (create.ok && create.json?.id) return create.json.id;
  // Already exists → look it up.
  const list = await auth('GET', `/admin/users?per_page=200`);
  const found = (list.json?.users || []).find(u => u.email === email);
  if (found) return found.id;
  throw new Error(`could not create or find auth user ${email}: ${JSON.stringify(create.json).slice(0, 200)}`);
}

// Upsert a profile row (seed-tagged). The auth trigger may have created a bare
// row; we merge our fields.
async function upsertProfile(id, fields) {
  await rest('POST', '/profiles', { id, seed: true, ...fields },
    { Prefer: 'resolution=merge-duplicates,return=representation' });
  // Ensure the fields stick even if the row pre-existed from the trigger.
  await rest('PATCH', `/profiles?id=eq.${id}`, { seed: true, ...fields });
}

// ── THE SEED CAST ────────────────────────────────────────────────────────────
// slug | class | display_name | city | lat | lng | is_provider | is_connector | ig_followers
// Degrees are wired below (referrer → consumer → connector → provider chain).
const CAST = [
  // class: referrer (super-user) — top of the referral chain (degree 0)
  { slug: 'referrer',  klass: 'referrer',  name: 'Rita Referrer',  city: 'Miami, FL', lat: 25.7617, lng: -80.1918, provider: false, connector: false, ig: 0 },
  // class: consumer — invited by referrer (degree 1)
  { slug: 'consumer',  klass: 'consumer',  name: 'Cody Consumer',  city: 'Miami, FL', lat: 25.7650, lng: -80.1930, provider: false, connector: false, ig: 0 },
  // class: creator/connector — invited by consumer (degree 2); strong IG reach
  { slug: 'connector', klass: 'connector', name: 'Nadia Connector', city: 'Miami, FL', lat: 25.7700, lng: -80.1900, provider: false, connector: true, ig: 42000 },
  // class: provider (Miami) — recommended by connector (degree 3)
  { slug: 'provider-mia', klass: 'provider', name: 'Paulo Plumber', city: 'Miami, FL', lat: 25.7700, lng: -80.2000, provider: true, connector: false, ig: 0 },
  // class: provider (OUT OF MIAMI — Austin) — multi-city live-match proof
  { slug: 'provider-atx', klass: 'provider', name: 'Cara Cleaner (Austin)', city: 'Austin, TX', lat: 30.2672, lng: -97.7431, provider: true, connector: false, ig: 0 },
  // class: admin/founder
  { slug: 'admin',     klass: 'admin',     name: 'Ada Admin',      city: 'Miami, FL', lat: 25.7617, lng: -80.1918, provider: false, connector: false, ig: 0 },
];

// Services owned by the provider users. taxonomy_provider_type MUST match the
// canonical taxonomy (see scripts/qa.mjs #13) so search resolves + strict-filters.
const SERVICES = [
  {
    ownerSlug: 'provider-mia', title: '[SEED] Paulo Plumber — 24/7 Miami',
    category: 'Plumbing', providerType: 'Plumber',
    description: 'Seed fixture: licensed Miami plumber. Drain unclogging, leak repair, water heaters.',
    city: 'Miami, FL', lat: 25.7700, lng: -80.2000,
    offerings: [
      { name: 'Free-for-Connectors drain check', cents: 0,     kind: 'session', default: true },
      { name: 'Water heater install',            cents: 65000, kind: 'session', default: false },
    ],
  },
  {
    ownerSlug: 'provider-atx', title: '[SEED] Cara Cleaner — Austin deep clean',
    category: 'Cleaning', providerType: 'House Cleaner',
    description: 'Seed fixture: Austin house cleaner. Eco-friendly deep cleans, move-outs.',
    city: 'Austin, TX', lat: 30.2672, lng: -97.7431,
    offerings: [
      { name: 'Free-for-Connectors starter clean', cents: 0,     kind: 'session', default: true },
      { name: 'Move-out deep clean',               cents: 25000, kind: 'session', default: false },
    ],
  },
];

// ── TEARDOWN ─────────────────────────────────────────────────────────────────
// Delete strictly seed=true rows, child→parent, then the seed auth users.
async function teardown() {
  const steps = [];
  // Child rows first (FKs). All carry the seed tag from this runner.
  for (const table of [
    'recommendations', 'request_responses', 'notifications', 'bookings',
    'requests', 'offerings', 'network', 'services',
  ]) {
    const r = await rest('DELETE', `/${table}?seed=eq.true`, null, { Prefer: 'return=minimal' });
    steps.push({ table, ok: r.ok, status: r.status });
  }
  // Profiles: delete the seed-tagged ones (the auth-user delete cascades, but we
  // clear the profile row explicitly too in case cascade is off).
  const rp = await rest('DELETE', `/profiles?seed=eq.true`, null, { Prefer: 'return=minimal' });
  steps.push({ table: 'profiles', ok: rp.ok, status: rp.status });

  // Auth users: delete every user whose metadata carries our seed tag.
  const list = await auth('GET', `/admin/users?per_page=200`);
  const seedUsers = (list.json?.users || []).filter(
    u => u.user_metadata?.[SEED_TAG] === true || (u.email || '').endsWith(`@${SEED_DOMAIN}`)
  );
  let deleted = 0;
  for (const u of seedUsers) {
    const d = await auth('DELETE', `/admin/users/${u.id}`);
    if (d.ok) deleted++;
  }
  steps.push({ table: 'auth.users', deleted, total: seedUsers.length });
  return steps;
}

// ── BUILD ────────────────────────────────────────────────────────────────────
async function build() {
  const idBySlug = {};

  // 1) Users + profiles.
  for (const c of CAST) {
    const email = `${c.slug}@${SEED_DOMAIN}`;
    const uid = await ensureAuthUser(email, c.name);
    idBySlug[c.slug] = uid;
    await upsertProfile(uid, {
      display_name: c.name,
      is_provider: c.provider,
      // cc_verified stamp for provider/connector so money/post-gate suites (test
      // mode) pass without a real card — mirrors IDENTITY_BYPASS semantics.
      ...(c.provider || c.connector ? { cc_verified_at: new Date().toISOString() } : {}),
      // connector reach signal (isConnectorProfile reads instagram_followers).
      ...(c.connector ? { instagram_followers: c.ig, cc_verified_at: new Date().toISOString() } : {}),
    });
  }

  // 2) Services + offerings (Miami + Austin).
  const svcIdByOwner = {};
  for (const s of SERVICES) {
    const owner = idBySlug[s.ownerSlug];
    // Idempotency: reuse an existing seed service with the same title+owner.
    const existing = await rest('GET',
      `/services?owner_id=eq.${owner}&title=eq.${encodeURIComponent(s.title)}&seed=eq.true&select=id`);
    let svcId = existing.json?.[0]?.id;
    if (!svcId) {
      const created = await rest('POST', '/services', {
        owner_id: owner, title: s.title, category: s.category, description: s.description,
        location_text: s.city, taxonomy_category: s.category, taxonomy_provider_type: s.providerType,
        status: 'listed', lat: s.lat, lng: s.lng, seed: true,
      });
      svcId = created.json?.[0]?.id || created.json?.id;
    } else {
      // Ensure lat/lng stay set (geocode-holds invariant) on re-run.
      await rest('PATCH', `/services?id=eq.${svcId}`, { lat: s.lat, lng: s.lng, status: 'listed', seed: true });
    }
    svcIdByOwner[s.ownerSlug] = svcId;

    // Offerings (replace-clean per service so re-runs don't duplicate).
    await rest('DELETE', `/offerings?service_id=eq.${svcId}&seed=eq.true`, null, { Prefer: 'return=minimal' });
    for (const o of s.offerings) {
      await rest('POST', '/offerings', {
        service_id: svcId, name: o.name, kind: o.kind, price_cents: o.cents,
        is_default: o.default, seed: true,
      });
    }
  }

  // 3) Degrees of connection — a 1st→2nd→3rd chain via the network graph.
  //    referrer → consumer → connector → provider-mia (each edge = one degree).
  //    We write directed follow edges (follower_id → followed_id) both ways so
  //    getMutualConnections / getMyNetworkIds (either direction) have data.
  const chain = ['referrer', 'consumer', 'connector', 'provider-mia'];
  const edges = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push([chain[i], chain[i + 1]]);
    edges.push([chain[i + 1], chain[i]]); // mutual
  }
  // Clear existing seed edges, then re-write (idempotent).
  await rest('DELETE', `/network?seed=eq.true`, null, { Prefer: 'return=minimal' });
  for (const [a, b] of edges) {
    await rest('POST', '/network', { follower_id: idBySlug[a], followed_id: idBySlug[b], seed: true });
  }

  // 4) A recommendation (the connector recommends the Miami provider's service)
  //    so reco-chain / social-proof assertions have real rows. Best-effort:
  //    recommendations schema varies; we write the common shape and ignore
  //    column-mismatch (a partial seed still leaves the QA suites runnable).
  await rest('DELETE', `/recommendations?seed=eq.true`, null, { Prefer: 'return=minimal' });
  await rest('POST', '/recommendations', {
    recommender_id: idBySlug['connector'],
    service_id: svcIdByOwner['provider-mia'],
    message: 'Seed reco: Paulo is my go-to Miami plumber.',
    seed: true,
  });

  return { idBySlug, svcIdByOwner };
}

// ── census (for verification + isolation proof) ──────────────────────────────
async function census() {
  const count = async (table, filter = '') => {
    const r = await fetch(`${REST}/${table}?seed=eq.true${filter}&select=id`, {
      headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range') || '*/0';
    return Number(cr.split('/')[1] || 0);
  };
  return {
    profiles: await count('profiles'),
    services: await count('services'),
    offerings: await count('offerings'),
    network_edges: await count('network'),
    recommendations: await count('recommendations'),
    services_miami: await count('services', `&location_text=ilike.*Miami*`),
    services_austin: await count('services', `&location_text=ilike.*Austin*`),
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (TEARDOWN) {
    const steps = await teardown();
    const out = { action: 'teardown', steps };
    console.log(AS_JSON ? JSON.stringify(out, null, 2) : formatTeardown(steps));
    return;
  }
  await build();
  const c = await census();
  const out = { action: 'seed', census: c, classes: CAST.map(x => ({ slug: x.slug, class: x.klass, city: x.city })) };
  console.log(AS_JSON ? JSON.stringify(out, null, 2) : formatSeed(c));
}

function formatSeed(c) {
  return [
    '',
    'Cergio seed test world (re)built — all rows tagged seed=true (excluded from production metrics).',
    '',
    `  profiles:         ${c.profiles}   (consumer, referrer, connector, 2× provider, admin)`,
    `  services:         ${c.services}   (Miami plumber + Austin cleaner)`,
    `  offerings:        ${c.offerings}  (each service: 1 free-for-Connectors + 1 paid)`,
    `  network edges:    ${c.network_edges}  (referrer→consumer→connector→provider, mutual → 1st/2nd/3rd degrees)`,
    `  recommendations:  ${c.recommendations}`,
    `  Miami services:   ${c.services_miami}`,
    `  Austin services:  ${c.services_austin}  (out-of-Miami live-match proof)`,
    '',
    `  Sign in as any: <slug>@${SEED_DOMAIN}  (password: ${SEED_PASSWORD})`,
    '  Teardown: node scripts/seed-test-world.mjs --teardown',
    '',
  ].join('\n');
}
function formatTeardown(steps) {
  return '\nSeed world torn down (deleted strictly seed=true rows + seed auth users):\n' +
    steps.map(s => '  ' + JSON.stringify(s)).join('\n') + '\n';
}

main().catch(e => { console.error('seed-test-world failed:', e.message); process.exit(1); });
