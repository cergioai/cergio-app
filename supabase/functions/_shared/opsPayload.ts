// SHARED ops payload builder (SPEC-104, 2026-07-29).
//
// WHY THIS FILE EXISTS: `ops-console` is NOT in the CI deploy list in
// .github/workflows/deploy-functions.yml, and that workflow cannot be edited
// from the off-Mac pipeline (the PAT has no `workflow` scope). Result: fixes to
// ops-console merge but never reach production -> the founder saw a stale
// allowlist return "Forbidden" on /ops/status.
//
// FIX: the payload lives here, and `admin-crawl-status` (which IS in the CI
// deploy list) imports it and serves it at { view: 'ops' }. The Supabase CLI
// bundles imported modules at deploy time, so every future ops change now ships
// off-Mac automatically via CI. `ops-console` keeps the same contract.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

// every agent/cron we claim runs — so "is it on?" is answered by DATA, not belief
export const AGENTS = ['fulfill-crawl','creator-harvest','enrich-influencers','creator-enrich','qa-suite','qa-live-verify','crawl-health-check','coo-execute','cergio-watchdog','cergio-orchestrator','ops-metrics','supply-engine'];
export const SOURCES = ['gmaps_apify','craigslist','yellowpages_apify','ig_services','yelp','google_local','google_lsa','google_sponsored','yellowpages','osm','google_places','openstreetmap'];
// CREATOR sources — the algorithm decided these (each with its own discovery method):
export const CREATOR_SOURCES = [
  'modash-vetted-seed',        // founder-vetted Modash handles (seed pool)
  'se:web-harvest',            // SerpAPI/DDG "top <cat> influencers <city>" -> handles
  'ig-creator-marketplace',    // Meta Graph creator_marketplace_creators (first-party)
  'homegrown-feedspot',        // curated city lists (Feedspot etc)
  'ig-scraper-user-search',    // apify~instagram-scraper searchType=user
  'provider-with-following',   // service providers who have an IG audience (dual)
];

// Admin allowlist — env wins, but the default must contain every address the
// founder actually signs in with (a narrow default is what caused "Forbidden").
export const DEFAULT_ADMINS = ['t@cergio.ai', 'info@cergio.ai', 'tarik.sansal2@gmail.com', 'tarik@cergio.ai', 'tariksansal@gmail.com'];
export function isAdminEmail(email: string, envList?: string | null): boolean {
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  return (envList || DEFAULT_ADMINS.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(e);
}

export async function buildOpsPayload(db: SupabaseClient, body: Record<string, unknown> = {}) {
  const since = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();

  // ── 1. QA: findings (bugs), recent runs, pass/fail
  const { data: findings } = await db.from('qa_findings').select('check_name, area, severity, status, count, detail, found_at, updated_at').order('updated_at', { ascending: false }).limit(100);
  const openBugs = (findings || []).filter((f: any) => f.status === 'open');
  const { data: qaRuns } = await db.from('agent_runs').select('agent, status, started_at, rows_written, raw_found, meta').in('agent', ['qa-suite','qa-live-verify']).order('started_at', { ascending: false }).limit(20);

  // ── 2. AGENTS: on/off proven by runs in last 24h
  const agents: Array<Record<string, unknown>> = [];
  for (const a of AGENTS) {
    const { count: c24 } = await db.from('agent_runs').select('id', { count: 'exact', head: true }).eq('agent', a).gte('started_at', since(24));
    const { data: last } = await db.from('agent_runs').select('started_at, status').eq('agent', a).order('started_at', { ascending: false }).limit(1);
    agents.push({ agent: a, runs24h: c24 ?? 0, live: (c24 ?? 0) > 0, last_run: last?.[0]?.started_at ?? null, last_status: last?.[0]?.status ?? null });
  }

  // ── 3. CRAWLS: per-source counts + job queue health
  const bySource: Record<string, number> = {};
  for (const s of SOURCES) { const { count } = await db.from('leads_services').select('id', { count: 'exact', head: true }).eq('data_source', s); bySource[s] = count ?? 0; }
  const { data: jobs } = await db.from('crawl_requests').select('source, status, city, service_type, delivered_count, updated_at').order('updated_at', { ascending: false }).limit(200);
  const jobStats: Record<string, number> = {};
  for (const j of (jobs || [])) { const k = `${j.source || 'osm'}/${j.status}`; jobStats[k] = (jobStats[k] ?? 0) + 1; }
  const { count: svcTotal } = await db.from('leads_services').select('id', { count: 'exact', head: true });
  const { count: creTotal } = await db.from('leads_influencers').select('id', { count: 'exact', head: true });
  const { count: svcNew24 } = await db.from('leads_services').select('id', { count: 'exact', head: true }).gte('fetched_at', since(24));

  // ── 4. CREATORS per source (discovered_via) + contactability
  const creatorsBySource: Record<string, { total: number; withEmail: number; withFollowers: number; nyc: number; miami: number }> = {};
  for (const cs of CREATOR_SOURCES) {
    const q = (f: (b: any) => any) => f(db.from('leads_influencers').select('id', { count: 'exact', head: true }).eq('discovered_via', cs));
    const { count: total } = await q((b: any) => b);
    const { count: withEmail } = await q((b: any) => b.not('email', 'is', null));
    const { count: withFollowers } = await q((b: any) => b.not('followers', 'is', null));
    const { count: nyc } = await q((b: any) => b.eq('state', 'NY'));
    const { count: miami } = await q((b: any) => b.eq('state', 'FL'));
    creatorsBySource[cs] = { total: total ?? 0, withEmail: withEmail ?? 0, withFollowers: withFollowers ?? 0, nyc: nyc ?? 0, miami: miami ?? 0 };
  }

  // ── 5. LIVE COUNTER (targets per founder spec: NYC 50k / Miami 20k services)
  const { count: nycSvc } = await db.from('leads_services').select('id', { count: 'exact', head: true }).eq('state', 'NY');
  const { count: miaSvc } = await db.from('leads_services').select('id', { count: 'exact', head: true }).eq('state', 'FL');
  const { count: nycCre } = await db.from('leads_influencers').select('id', { count: 'exact', head: true }).eq('state', 'NY');
  const { count: miaCre } = await db.from('leads_influencers').select('id', { count: 'exact', head: true }).eq('state', 'FL');
  const counter = { nyc_services: nycSvc ?? 0, nyc_target: 50000, miami_services: miaSvc ?? 0, miami_target: 20000,
                    nyc_creators: nycCre ?? 0, miami_creators: miaCre ?? 0, services_new_24h: svcNew24 ?? 0 };

  // latest supply-engine run (bugs found + auto-fixes)
  let engine: unknown = null;
  try { const { data } = await db.from('agent_runs').select('meta, started_at, status').eq('agent','supply-engine').order('started_at',{ascending:false}).limit(1); engine = data?.[0] ?? null; } catch (_e) {}

  // DOWNLOAD is OPT-IN (fix 2026-07-29): loading 15 sources x 2000 rows on every
  // page load timed out the function -> the console showed "non-2xx status code".
  // The UI now requests ONE source at a time via { download: "<kind>:<key>" }.
  const download: Record<string, unknown[]> = {};
  const wantDl = typeof body.download === 'string' ? body.download as string : null;
  if (wantDl) {
    const [kind, ...rest] = wantDl.split(':');
    const key = rest.join(':');
    if (kind === 'services') {
      const { data } = await db.from('leads_services')
        .select('name, service_type, phone, owner_email, instagram, city, state, data_source, outreach_status')
        .eq('data_source', key).limit(5000);
      download[wantDl] = data || [];
    } else if (kind === 'creators') {
      const { data } = await db.from('leads_influencers')
        .select('ig_handle, display_name, category, followers, email, phone, city, state, discovered_via, outreach_status')
        .eq('discovered_via', key).limit(5000);
      download[wantDl] = data || [];
    }
  }

  const { count: profiles } = await db.from('profiles').select('id', { count: 'exact', head: true });
  let withAvatar = 0, connections = 0, services = 0, requests = 0, bookings = 0;
  try { const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).not('avatar_url','is',null); withAvatar = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('connections').select('id', { count: 'exact', head: true }); connections = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('services').select('id', { count: 'exact', head: true }); services = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('requests').select('id', { count: 'exact', head: true }); requests = count ?? 0; } catch (_e) {}
  try { const { count } = await db.from('bookings').select('id', { count: 'exact', head: true }); bookings = count ?? 0; } catch (_e) {}

  return {
    generated_at: new Date().toISOString(),
    served_by: 'shared',
    qa: { open_bugs: openBugs.length, findings: findings || [], recent_runs: qaRuns || [] },
    agents,
    crawls: { by_source: bySource, job_stats: jobStats, services_total: svcTotal ?? 0, creators_total: creTotal ?? 0, services_new_24h: svcNew24 ?? 0, recent_jobs: (jobs || []).slice(0, 40) },
    product: { profiles: profiles ?? 0, with_avatar: withAvatar, connections, services, requests, bookings },
    counter, creatorsBySource, engine, download,
  };
}
