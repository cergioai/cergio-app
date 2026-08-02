// ONE parser for the growth connection. SPEC-204.
//
// Why this file exists: GROWTH_SUPABASE_URL was being parsed THREE different ways.
// seed-growth-queue.mjs reduced it with `new URL(raw).origin`, which throws away any
// path the secret carries. growth-audit-export.mjs only stripped trailing slashes. The
// secret carries a path, so the seeder worked and the audit export requested
//     /rest/v1/rest/v1/leads_services
// and got 404 PGRST125 "Invalid path specified in request URL" on EVERY table. That is
// why the 03:06Z audit reported 0 rows for all 8 sources while the database held
// thousands. Two parsers for one secret is two sources of truth, and the one nobody
// tested was the one reporting to the founder.
export function growthBase() {
  const raw = (process.env.GROWTH_SUPABASE_URL || '').trim();
  if (!raw) return '';
  try { return new URL(raw).origin; } catch { return raw.replace(/\/+$/, '').replace(/\/rest(\/v1)?$/, ''); }
}
export function growthKey() { return (process.env.GROWTH_SERVICE_ROLE_KEY || '').trim(); }
export function growthHeaders() { const k = growthKey(); return { apikey: k, Authorization: `Bearer ${k}` }; }
