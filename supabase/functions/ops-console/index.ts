// Supabase Edge Function — OPS CONSOLE (SPEC-94). ONE admin endpoint that answers
// "is everything actually working?" across QA, crawls, agents and data — reading
// past RLS server-side. Backs /ops/console. Admin-JWT gated. Read-only.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ADMINS = ['t@cergio.ai', 'info@cergio.ai'];
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

// every agent/cron we claim runs — so "is it on?" is answered by DATA, not belief
const AGENTS = ['fulfill-crawl','creator-harvest','enrich-influencers','creator-enrich','qa-suite','qa-live-verify','crawl-health-check','coo-execute','cergio-watchdog','cergio-orchestrator','ops-metrics'];
const SOURCES = ['yelp','google_local','google_lsa','google_sponsored','craigslist','yellowpages','osm','google_places','openstreetmap'];
// CREATOR sources — the algorithm decided these (each with its own discovery method):
const CREATOR_SOURCES = [
  'modash-vetted-seed',        // founder-vetted Modash handles (seed pool)
  'se:web-harvest',            // SerpAPI/DDG "top <cat> influencers <city>" -> handles
  'ig-creator-marketplace',    // Meta Graph creator_marketplace_creators (first-party)
  'homegrown-feedspot',        // curated city lists (Feedspot etc)
  'ig-scraper-user-search',    // apify~instagram-scraper searchType=user
  'provider-with-following',   // service providers who have an IG audience (dual)
];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await asUser.auth.getUser();
    const email = (u?.user?.email || '').toLowerCase();
    if (!email || !(Deno.env.get('ADMIN_EMAILS') || ADMINS.join(',')).split(',').map(s=>s.trim().toLowerCase()).includes(email)) return json({ error: 'Forbidden' }, 403);
    const db = createClient(url, svc);
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

    // ── 4. USERS / social graph density (for UX realism checks)
    // CREATORS per source (discovered_via) + contactability
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
    // LIVE COUNTER (targets per founder spec)
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
    // The UI now requests ONE source at a time via { download: "<key>" }.
    const download: Record<string, unknown[]> = {};
    const wantDl = typeof body.download === 'string' ? body.download : null;
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

    return json({
      generated_at: new Date().toISOString(),
      qa: { open_bugs: openBugs.length, findings: findings || [], recent_runs: qaRuns || [] },
      agents,
      crawls: { by_source: bySource, job_stats: jobStats, services_total: svcTotal ?? 0, creators_total: creTotal ?? 0, services_new_24h: svcNew24 ?? 0, recent_jobs: (jobs || []).slice(0, 40) },
      product: { profiles: profiles ?? 0, with_avatar: withAvatar, connections, services, requests, bookings },
      counter, creatorsBySource, engine, download,
    });
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
});
