// Apply the growth schema to the SEPARATE growth project. Run from CI.
// Uses GROWTH_SUPABASE_URL + GROWTH_SERVICE_ROLE_KEY. Never touches the product DB.
const GROWTH_URL = process.env.GROWTH_SUPABASE_URL;   // NOT `URL` — that shadows the global URL constructor
const KEY = process.env.GROWTH_SERVICE_ROLE_KEY;
if (!GROWTH_URL || !KEY) { console.error('GROWTH_SUPABASE_URL / GROWTH_SERVICE_ROLE_KEY not set'); process.exit(1); }
if (/vjmwnbftfquyquwaklue/.test(GROWTH_URL)) {
  console.error('REFUSING: GROWTH_SUPABASE_URL points at the PRODUCT project. That is the outage.');
  process.exit(1);
}
const fs = await import('node:fs');
const sql = fs.readFileSync('supabase/migrations/20260730190000_growth_schema_reference.sql', 'utf8');
const ref = new URL(GROWTH_URL).hostname.split('.')[0];
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is not set — the Management API needs it to run DDL'); process.exit(1); }
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
  console.error('The SUPABASE_ACCESS_TOKEN cannot see the growth project.');
  console.error('It belongs to a different account/organisation than the one that owns Cergio Growth.');
  console.error('Fix: create a Personal Access Token on the SAME account that owns both projects');
  console.error('(Supabase → Account → Access Tokens) and update the SUPABASE_ACCESS_TOKEN repo secret.');
  process.exit(1);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
if (r.ok) { console.log('growth schema applied'); process.exit(0); }
console.error(`FAILED HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
process.exit(1);
