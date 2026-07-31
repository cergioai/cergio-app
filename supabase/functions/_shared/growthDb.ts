// SPEC-120 — GROWTH IS A SEPARATE DATABASE.
//
// WHY: on 2026-07-30 background crawling saturated the product's Postgres
// connection pool. /rest/v1/services returned HTTP 503 while /auth/v1/user
// returned 200 — the founder could not sign in or list a service. Throttling
// growth "fixed" it by making growth useless; batching helped but the two still
// shared one pool, so a bad day for growth was still a down day for the product.
//
// Two projects = two pools. Nothing growth does can reach the product. This stops
// being a discipline problem and becomes physically impossible.
//
// RULES:
//   • crawl_requests / leads_services / leads_influencers live ONLY in growth
//   • the product app NEVER reads them; it reads `services`, populated by the
//     one-way, gated, rate-limited bridge
//   • if the growth env is absent we FAIL LOUD rather than silently falling back
//     to the product DB — a silent fallback would recreate the exact outage
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { normalizeGrowthUrl } from './growthUrl.ts';

export function growthEnvPresent(): boolean {
  return !!(Deno.env.get('GROWTH_SUPABASE_URL') && Deno.env.get('GROWTH_SERVICE_ROLE_KEY'));
}

/** Client for ALL crawl/lead traffic. Never use the product client for these. */
// SPEC-148: accept ANY pasted form of the project URL. The GitHub secret carried
// a '/rest/v1' path, which made every CI call resolve to '…/rest/v1/rest/v1/'
// and 404. The EDGE secret is pasted from the same place, so normalise here too —
// otherwise every worker silently builds broken URLs and writes nothing.
function growthOrigin(raw: string | undefined): string {
  const v = (raw || '').trim();
  try { return new URL(v).origin; } catch { return v.replace(/\/+$/, ''); }
}

export function growthDb(): SupabaseClient {
  const url = growthOrigin(Deno.env.get('GROWTH_SUPABASE_URL'));
  const key = (Deno.env.get('GROWTH_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) {
    throw new Error(
      'GROWTH_SUPABASE_URL / GROWTH_SERVICE_ROLE_KEY are not set. Refusing to run crawl ' +
      'traffic against the product database — that is what took the app down on 2026-07-30.',
    );
  }
  return createClient(normalizeGrowthUrl(url), key, { auth: { persistSession: false } });
}

/** Product client — auth, profiles, services, requests, bookings. Users only. */
export function productDb(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}
