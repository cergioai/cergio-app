// Apply the growth schema to the SEPARATE growth project. Run from CI.
// Uses GROWTH_SUPABASE_URL + GROWTH_SERVICE_ROLE_KEY. Never touches the product DB.
const URL = process.env.GROWTH_SUPABASE_URL;
const KEY = process.env.GROWTH_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('GROWTH_SUPABASE_URL / GROWTH_SERVICE_ROLE_KEY not set'); process.exit(1); }
if (/vjmwnbftfquyquwaklue/.test(URL)) {
  console.error('REFUSING: GROWTH_SUPABASE_URL points at the PRODUCT project. That is the outage.');
  process.exit(1);
}
const fs = await import('node:fs');
const sql = fs.readFileSync('supabase/migrations/20260730190000_growth_schema_reference.sql', 'utf8');
const ref = new URL(URL).hostname.split('.')[0];
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
console.log(r.ok ? 'growth schema applied' : `FAILED ${r.status}: ${(await r.text()).slice(0, 300)}`);
process.exit(r.ok ? 0 : 1);
