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
  // The token belongs to a different account than the one owning Cergio Growth,
  // so CI cannot run DDL there. The schema was applied by hand in the growth SQL
  // editor (2026-07-31). Verify the tables EXIST over REST — which uses the growth
  // service key and does work — and pass if they do.
  console.log('NOTE: SUPABASE_ACCESS_TOKEN cannot see the growth project — skipping DDL.');
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
