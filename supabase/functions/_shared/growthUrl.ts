// SPEC-132b — NORMALIZE GROWTH_SUPABASE_URL.
//
// On 2026-07-31 the growth cutover (SPEC-132) began writing crawl_requests /
// leads_services / leads_influencers to a SEPARATE growth project via growthDb().
// The growth URL secret was set, but with a trailing slash / stray "/rest/v1"
// suffix, so supabase-js built ".../rest/v1//rest/v1/table" and PostgREST rejected
// EVERY growth write with "Invalid path specified in request URL [PGRST125]".
// Result: crawl-seed-osm, creator-harvest and enrich-influencers all 0-wrote for
// hours and the ops snapshot raised CREATORS_NOT_GROWING — a silent supply outage.
//
// This function makes any reasonable paste of the secret work, and FAILS LOUD with
// a named error instead of the cryptic PGRST125 if the value is genuinely not a
// Supabase URL. Pure and import-free on purpose: the QA gate executes it directly.
export function normalizeGrowthUrl(raw: string): string {
  let u = String(raw || '').trim().replace(/\s+/g, '');
  u = u.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)$/i.test(u)) {
    throw new Error(
      'GROWTH_SUPABASE_URL is malformed: "' + raw + '". Expected https://<ref>.supabase.co ' +
      '(no trailing slash, no /rest/v1 suffix). This is the PGRST125 "Invalid path" cause.',
    );
  }
  return u;
}
