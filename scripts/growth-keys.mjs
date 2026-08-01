// SPEC-151 — derive service-role keys from the ACCESS TOKENS instead of asking a
// human to paste them, and push the growth connection into the EDGE FUNCTION
// runtime.
//
// Why this exists (two failures that cost a full day and produced zero rows):
//   1. SUPABASE_SERVICE_ROLE_KEY was never created as a repo secret, so every
//      worker kick sent "Authorization: Bearer " and got a bare 401.
//   2. The product key was pasted into GROWTH_SERVICE_ROLE_KEY, so growth auth
//      died with "This API key might also be owned by another Supabase project."
// Both are the same class of bug: a human copying opaque 41-char strings between
// two projects that look identical. The Management API can mint either key from a
// token we ALREADY hold, so the copy step — and the whole error class — is gone.
//
// It also fixes a THIRD, silent blocker: growthDb() reads Deno.env, and GitHub
// secrets are not Deno secrets. Nothing ever pushed GROWTH_* into the function
// runtime, so fulfill-crawl would have thrown even with a perfect kick.
const PRODUCT_REF = 'vjmwnbftfquyquwaklue';
const MGMT = 'https://api.supabase.com/v1';

const out = [];
const lines = [];
// SPEC-155: this step's output lived only in the Actions log, which I cannot read
// from the sandbox — so "did the edge secrets actually land?" was unanswerable and
// I was reduced to inferring it from a bare HTTP 000. Tee every line to a file the
// report pastes verbatim. A diagnostic nobody can read is not a diagnostic.
const log = (s) => { console.log(s); lines.push(String(s)); };
const emit = (k, v) => {
  console.log(`::add-mask::${v}`);
  out.push(`${k}<<__EOK__\n${v}\n__EOK__`);
};

async function serviceKey(ref, token, label) {
  const r = await fetch(`${MGMT}/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    log(`${label}: api-keys -> HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    return null;
  }
  const keys = await r.json();
  // Both key generations are accepted: the legacy JWT named "service_role" and
  // the newer opaque secret keys (type "secret_key" / sb_secret_…).
  // SPEC-158: order matters, and I had it backwards. Preferring name==='service_role'
  // returns the LEGACY JWT (eyJhbGciOiJ…, 219 chars). This project has migrated to
  // the new API key system where the legacy JWTs are DISABLED, so that key is
  // syntactically perfect and rejected — the worker probe returned exactly the same
  // {"error":"Unauthorized"} 401 as when the secret was missing entirely, which is
  // how this hid. Prefer the new sb_secret_ key and fall back to the JWT only for
  // projects that have not migrated.
  const k =
    keys.find((x) => String(x.api_key || '').startsWith('sb_secret_')) ||
    keys.find((x) => x.type === 'secret' || x.type === 'secret_key') ||
    keys.find((x) => x.name === 'service_role');
  if (!k?.api_key) {
    log(`${label}: no service key among [${keys.map((x) => x.name).join(', ')}]`);
    return null;
  }
  log(`${label}: derived "${k.name}" (${String(k.api_key).length} chars, ${String(k.api_key).slice(0, 11)}…)`);
  return k.api_key;
}

const growthUrl = (process.env.GROWTH_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const growthRef = growthUrl ? new URL(growthUrl).hostname.split('.')[0] : null;
const growthTok = process.env.GROWTH_ACCESS_TOKEN;
const prodTok = process.env.SUPABASE_ACCESS_TOKEN;

let growthKey = null;
if (growthRef && growthTok) growthKey = await serviceKey(growthRef, growthTok, 'growth');
else log(`growth: cannot derive (ref=${!!growthRef} token=${!!growthTok})`);
// Only fall back to the pasted secret if minting failed — the derived key is
// authoritative precisely because it CANNOT be the wrong project's.
if (!growthKey && process.env.GROWTH_SERVICE_ROLE_KEY) {
  log('growth: falling back to the pasted GROWTH_SERVICE_ROLE_KEY');
  growthKey = process.env.GROWTH_SERVICE_ROLE_KEY.trim();
}
if (growthKey) emit('GROWTH_SERVICE_ROLE_KEY', growthKey);

let prodKey = prodTok ? await serviceKey(PRODUCT_REF, prodTok, 'product') : null;
if (!prodKey && process.env.SUPABASE_SERVICE_ROLE_KEY) prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
if (prodKey) emit('SUPABASE_SERVICE_ROLE_KEY', prodKey);

// Push the growth connection into the PRODUCT project's edge-function secrets,
// which is where growthDb() actually reads from.
if (prodTok && growthUrl && growthKey) {
  const r = await fetch(`${MGMT}/projects/${PRODUCT_REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${prodTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { name: 'GROWTH_SUPABASE_URL', value: growthUrl },
      { name: 'GROWTH_SERVICE_ROLE_KEY', value: growthKey },
    ]),
  });
  log(`edge secrets GROWTH_* -> HTTP ${r.status}${r.ok ? ' (fulfill-crawl can now reach growth)' : ' ' + (await r.text()).slice(0, 200)}`);
} else {
  log(`edge secrets: SKIPPED (prodToken=${!!prodTok} url=${!!growthUrl} key=${!!growthKey})`);
}

const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/growth-keys.txt', lines.join('\n') + '\n');

if (process.env.GITHUB_ENV && out.length) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_ENV, out.join('\n') + '\n');
}
