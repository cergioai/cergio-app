// Apply the growth schema to the SEPARATE growth project. Run from CI.
// Uses GROWTH_SUPABASE_URL + GROWTH_SERVICE_ROLE_KEY. Never touches the product DB.
// SPEC-148: accept ANY form of the project URL. Measured: the secret was
// 'https://<ref>.supabase.co/rest/v1' (48 chars), so calls became
// '…/rest/v1/rest/v1/' -> 404. Reduce to scheme://host and discard the rest.
const GROWTH_URL = (() => {
  const raw = (process.env.GROWTH_SUPABASE_URL || '').trim();
  try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, ''); }
})();   // NOT `URL` — that shadows the global URL constructor
const KEY = process.env.GROWTH_SERVICE_ROLE_KEY;
if (!GROWTH_URL || !KEY) { console.error('GROWTH_SUPABASE_URL / GROWTH_SERVICE_ROLE_KEY not set'); process.exit(1); }
if (/vjmwnbftfquyquwaklue/.test(GROWTH_URL)) {
  console.error('REFUSING: GROWTH_SUPABASE_URL points at the PRODUCT project. That is the outage.');
  process.exit(1);
}
const fs = await import('node:fs');
const sql = fs.readFileSync('supabase/migrations/20260730190000_growth_schema_reference.sql', 'utf8');
const ref = new URL(GROWTH_URL).hostname.split('.')[0];
// The growth project lives under a DIFFERENT Supabase account than the product,
// so one personal access token can never see both (measured: "token sees 1
// project(s); growth ref present: false"). Prefer a token issued by the GROWTH
// account; fall back to the product token for the case where they are merged
// later.
const TOKEN = process.env.GROWTH_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
const TOKEN_SRC = process.env.GROWTH_ACCESS_TOKEN ? 'GROWTH_ACCESS_TOKEN' : 'SUPABASE_ACCESS_TOKEN';
if (!TOKEN) { console.error('No access token — set GROWTH_ACCESS_TOKEN (issued by the account that owns Cergio Growth)'); process.exit(1); }
console.log(`using ${TOKEN_SRC} for growth DDL`);
console.log(`growth project ref: ${ref.slice(0, 4)}...${ref.slice(-4)} (masked)`);

// Does this access token actually see the growth project? Report it plainly
// instead of failing with an opaque error.
const list = await fetch('https://api.supabase.com/v1/projects', {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (!list.ok) {
  console.error(`cannot list projects: HTTP ${list.status} — the SUPABASE_ACCESS_TOKEN is invalid or expired`);
  process.exit(1);
}
const projects = await list.json();
const found = Array.isArray(projects) && projects.find((p) => p.id === ref);
console.log(`token sees ${Array.isArray(projects) ? projects.length : 0} project(s); growth ref present: ${!!found}`);
if (!found) {
  // The token belongs to a different account than the one owning Cergio Growth,
  // so CI cannot run DDL there. The schema was applied by hand in the growth SQL
  // editor (2026-07-31). Verify the tables EXIST over REST — which uses the growth
  // service key and does work — and pass if they do.
  console.log(`NOTE: ${TOKEN_SRC} cannot see the growth project — skipping DDL.`);
  console.log('To let CI manage the growth schema, add GROWTH_ACCESS_TOKEN — a token');
  console.log('generated on the Supabase account that owns Cergio Growth.');
  const missing = [];
  for (const t of ['crawl_requests', 'leads_services', 'leads_influencers', 'agent_runs']) {
    const rr = await fetch(`${GROWTH_URL}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    console.log(`  ${t} -> HTTP ${rr.status}`);
    if (rr.status >= 400) missing.push(`${t} (${rr.status})`);
  }
  if (missing.length) {
    console.error(`growth schema INCOMPLETE: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('growth schema verified — all four tables answer.');
  process.exit(0);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
if (r.ok) { console.log('growth schema applied'); process.exit(0); }
console.error(`FAILED HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
process.exit(1);
