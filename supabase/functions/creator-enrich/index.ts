// Supabase Edge Function — creator/SP enrichment via data-slayer IG scraper (SPEC-91).
// Fills followers + email + phone onto pending_review creators (and provider-with-
// following) from their ig_handle. Uses Apify data-slayer (public_email/biography_email
// + follower_count + contact_phone_number). Fill-only, never fabricates. NO-OP without
// APIFY_TOKEN. AUTH: service-role bearer (cron/launcher). Batches to bound run-sync time.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb, growthEnvPresent } from '../_shared/growthDb.ts';

const ACTOR = 'data-slayer~instagram-user-info-scraper-cookieless';
const BATCH = 40;            // handles per data-slayer run (run-sync time budget)
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }); }
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

serve(async (req: Request) => {

// ── SPEC-132: GROWTH TABLES LIVE IN THE GROWTH PROJECT ─────────────────────
// crawl_requests / leads_services / leads_influencers are read+written on the
// SEPARATE growth database. The product DB keeps auth, profiles, services,
// requests, bookings — and agent_runs / qa_findings so the ops console and the
// watchdog keep working unchanged.
//
// Two projects = two connection pools. On 2026-07-30 background crawling
// saturated the product pool (/rest/v1/services -> 503 while /auth/v1/user -> 200)
// and the founder could not sign in or list a service. That is now physically
// impossible rather than a matter of restraint.
//
// If the growth env is absent we FAIL LOUD — a silent fallback to the product DB
// would recreate exactly that outage.
const gdb = growthDb();
  const started = Date.now();
  const url = Deno.env.get('SUPABASE_URL')!;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth || auth !== svc) return json({ error: 'Unauthorized' }, 401);
  const TOKEN = Deno.env.get('APIFY_TOKEN');
  if (!TOKEN) return json({ status: 'pending_access', note: 'set APIFY_TOKEN to enable data-slayer enrichment' });
  const db = createClient(url, svc);

  // candidates: pending_review creators with a handle but no follower count yet
  const { data: cands } = await gdb.from('leads_influencers')
    .select('id, ig_handle, followers, email, phone')
    .eq('outreach_status', 'pending_review').is('followers', null)
    .not('ig_handle', 'is', null).limit(BATCH);
  const rows = (cands || []).filter((r: any) => (r.ig_handle || '').trim());
  if (!rows.length) return json({ status: 'ok', enriched: 0, note: 'no un-enriched pending_review creators' });

  const usernames = rows.map((r: any) => String(r.ig_handle).toLowerCase().replace(/^@/, '').trim());
  let items: any[] = [];
  try {
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}&maxItems=${BATCH}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames }) });
    const j = await res.json();
    items = Array.isArray(j) ? j : [];
  } catch (e) { return json({ status: 'error', error: String(e).slice(0, 200) }, 200); }

  const byName: Record<string, any> = {};
  for (const it of items) { const u = String(it.username || '').toLowerCase(); if (u) byName[u] = it; }

  let enriched = 0, withEmail = 0;
  for (const r of rows) {
    const u = String(r.ig_handle).toLowerCase().replace(/^@/, '').trim();
    const it = byName[u];
    if (!it) continue;
    const patch: Record<string, unknown> = {};
    const fol = it.follower_count;
    if (typeof fol === 'number') patch.followers = fol;
    if (!r.email) {
      const em = (it.public_email || it.biography_email || '').toLowerCase();
      if (EMAIL.test(em)) { patch.email = em; withEmail++; }
    }
    if (!r.phone && it.contact_phone_number) patch.phone = String(it.contact_phone_number);
    if (!r.external_url && it.external_url) patch.external_url = it.external_url;
    if (Object.keys(patch).length === 0) continue;
    patch.updated_at = new Date().toISOString();
    const { data: w } = await gdb.from('leads_influencers').update(patch).eq('id', r.id).select('id');
    if (w && w.length) enriched++;
  }
  const out = { status: 'ok', candidates: rows.length, profiles: items.length, enriched, withEmail, ms: Date.now() - started };
  try {
    await db.from('agent_runs').insert({ agent: 'creator-enrich', started_at: new Date(started).toISOString(),
      finished_at: new Date().toISOString(), raw_found: items.length, rows_written: enriched, status: 'ok', meta: out });
  } catch (_e) { /* best-effort */ }
  return json(out);
});
