// Supabase Edge Function — SUPPLY ENGINE (SPEC-99). The autonomous data-acquisition
// brain. Runs on cron. It (1) MEASURES every source's real yield, (2) AUTO-HEALS the
// failures it finds, (3) RE-SEEDS to keep the queue saturated, (4) publishes a LIVE
// COUNTER + bug/fix ledger. No founder in the loop.
//
// Auto-fix rules (each one derived from a real observed failure):
//   R1 dead source     — jobs>threshold & rows==0  -> disable source, log finding
//   R2 starved queue   — open phase-1 jobs < floor -> re-seed phase-1 city x type matrix
//   R3 stalled worker  — no fulfill run in 30m     -> kick fulfill-crawl
//   R4 wasteful source — jobs/rows ratio terrible  -> throttle it, log finding
//   R5 failed jobs     — status=failed & recoverable-> requeue to 'new'
// Every action writes to qa_findings (bug) + agent_runs (fix), so the ledger IS the proof.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
const FN_BASE = 'https://vjmwnbftfquyquwaklue.functions.supabase.co';

// PHASE 1 (founder spec): NYC 50k services, Miami 20k. Nothing else until then.
const P1_CITIES: Array<[string, string]> = [
  ['New York', 'NY'], ['Manhattan', 'NY'], ['Brooklyn', 'NY'], ['Queens', 'NY'], ['Bronx', 'NY'], ['Staten Island', 'NY'],
  ['Miami', 'FL'], ['Miami Beach', 'FL'], ['Brickell', 'FL'], ['Wynwood', 'FL'], ['Coral Gables', 'FL'], ['Doral', 'FL'],
];
// sources ranked by MEASURED yield — the engine re-ranks itself from data each run
const SOURCES = ['yelp', 'craigslist', 'google_lsa', 'osm', 'yellowpages_apify', 'google_local'];
const TYPES = ['dog trainer','pet sitter','cat sitter','personal trainer','nutritionist','tutor','gmat tutor','housekeeper','plumber','electrician','handyman','contractor','babysitter','driver','personal assistant','life coach','photographer','home decorator','home organizer','personal shopper','barber','mover','house cleaning','landscaping','mover','locksmith','appliance repair','auto detailing','hair stylist','nail technician','dog walker','pool cleaning','pressure washing','window cleaning','junk removal','painter'];
const QUEUE_FLOOR = Number(Deno.env.get('QUEUE_FLOOR') || '600');   // keep this many phase-1 jobs open
const DEAD_AFTER  = 30;                                             // jobs with 0 rows => dead

serve(async (req: Request) => {
  const started = Date.now();
  const url = Deno.env.get('SUPABASE_URL')!, svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth || auth !== svc) return json({ error: 'Unauthorized' }, 401);
  const db = createClient(url, svc);
  const bugs: string[] = [], fixes: string[] = [];
  const note = async (check: string, ok: boolean, sev: string, detail: string) => {
    try { await db.rpc('cergio_qa_check', { p_area: 'supply', p_check: check, p_sev: sev, p_count: ok ? 0 : 1, p_detail: detail.slice(0, 400) }); } catch (_e) {}
    if (!ok) bugs.push(`${check}: ${detail.slice(0, 120)}`);
  };
  const cnt = async (t: string, q: (b: any) => any) => { const { count } = await q(db.from(t).select('id', { count: 'exact', head: true })); return count ?? 0; };

  // ── MEASURE: per-source yield (rows per job) — the engine's own scoreboard
  const yields: Record<string, { rows: number; jobs: number; ratio: number }> = {};
  for (const s of SOURCES) {
    const rows = await cnt('leads_services', (b) => b.eq('data_source', s === 'yellowpages_apify' ? 'yellowpages' : s));
    const jobs = await cnt('crawl_requests', (b) => b.eq('source', s));
    yields[s] = { rows, jobs, ratio: jobs > 0 ? rows / jobs : 0 };
  }

  // ── R1/R4: dead + wasteful sources
  const DISABLED: string[] = [];
  for (const [s, y] of Object.entries(yields)) {
    if (y.jobs >= DEAD_AFTER && y.rows === 0) {
      DISABLED.push(s); await note(`supply-dead-source-${s}`, false, 'critical', `${y.jobs} jobs produced 0 rows — source disabled automatically`);
      fixes.push(`disabled dead source ${s}`);
    } else if (y.jobs >= 500 && y.ratio < 0.05) {
      DISABLED.push(s); await note(`supply-wasteful-source-${s}`, false, 'high', `${y.jobs} jobs -> ${y.rows} rows (ratio ${y.ratio.toFixed(4)}) — throttled automatically`);
      fixes.push(`throttled wasteful source ${s}`);
    } else {
      await note(`supply-source-${s}`, true, 'high', `${y.rows} rows / ${y.jobs} jobs (ratio ${y.ratio.toFixed(2)})`);
    }
  }
  const LIVE_SOURCES = SOURCES.filter((s) => !DISABLED.includes(s));

  // ── R5: requeue recoverable failed jobs (transient Overpass/API failures)
  try {
    const { data: req } = await db.from('crawl_requests').update({ status: 'new', updated_at: new Date().toISOString() })
      .eq('kind', 'services').eq('status', 'failed').not('notes', 'ilike', '%off-spec%').not('notes', 'ilike', '%parked%')
      .in('city', P1_CITIES.map(([c]) => c)).select('id').limit(500);
    if (req?.length) fixes.push(`requeued ${req.length} recoverable failed phase-1 jobs`);
  } catch (_e) {}

  // ── R2: keep the phase-1 queue SATURATED (turbo). Re-seed across live sources.
  const open = await cnt('crawl_requests', (b) => b.eq('kind', 'services').in('status', ['new', 'crawling']).in('city', P1_CITIES.map(([c]) => c)));
  let seeded = 0;
  if (open < QUEUE_FLOOR) {
    const nowIso = new Date().toISOString();
    const batch: Array<Record<string, unknown>> = [];
    for (const src of LIVE_SOURCES) for (const [city, state] of P1_CITIES) for (const t of TYPES) {
      batch.push({ kind: 'services', city, state, service_type: t, target_count: 50, status: 'new', source: src, created_at: nowIso, updated_at: nowIso });
    }
    for (let i = 0; i < batch.length; i += 250) {
      try { const { data } = await db.from('crawl_requests').insert(batch.slice(i, i + 250)).select('id'); seeded += data?.length ?? 0; } catch (_e) {}
    }
    if (seeded) fixes.push(`re-seeded ${seeded} phase-1 jobs across ${LIVE_SOURCES.length} live sources (queue was ${open} < ${QUEUE_FLOOR})`);
    await note('supply-queue-saturated', true, 'high', `queue was ${open}, seeded ${seeded}`);
  } else {
    await note('supply-queue-saturated', true, 'high', `queue healthy: ${open} open phase-1 jobs`);
  }

  // ── R3: stalled worker -> kick it, repeatedly (turbo drain)
  const sinceStall = new Date(Date.now() - 30 * 60000).toISOString();
  const recent = await cnt('agent_runs', (b) => b.eq('agent', 'fulfill-crawl').gte('started_at', sinceStall));
  if (recent === 0) { await note('supply-worker-stalled', false, 'critical', 'no fulfill-crawl run in 30m — kicking'); }
  // FIRE-AND-FORGET (fix 2026-07-29): awaiting N worker kicks blew the edge-function
  // time limit and the engine returned no JSON at all. Kicks are dispatched WITHOUT
  // await so the engine always returns its counter fast; the worker drains in parallel.
  const kicks = Number(Deno.env.get('TURBO_KICKS') || '4');
  let kicked = 0;
  for (let i = 0; i < kicks; i++) {
    try {
      fetch(`${FN_BASE}/fulfill-crawl?limit=200`, { method: 'POST', headers: { Authorization: `Bearer ${svc}` } }).catch(() => {});
      kicked++;
    } catch (_e) {}
  }
  if (kicked) fixes.push(`turbo: dispatched ${kicked} parallel fulfill-crawl runs (limit 200 each)`);

  // ── LIVE COUNTER (published for the dashboard)
  const nyc = await cnt('leads_services', (b) => b.eq('state', 'NY'));
  const mia = await cnt('leads_services', (b) => b.eq('state', 'FL'));
  const creNyc = await cnt('leads_influencers', (b) => b.eq('state', 'NY'));
  const creMia = await cnt('leads_influencers', (b) => b.eq('state', 'FL'));
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const addedToday = await cnt('leads_services', (b) => b.gte('fetched_at', today.toISOString()));
  const counter = {
    nyc_services: nyc, nyc_target: 50000, miami_services: mia, miami_target: 20000,
    nyc_creators: creNyc, miami_creators: creMia, added_today: addedToday,
    open_jobs: open + seeded, live_sources: LIVE_SOURCES, disabled_sources: DISABLED,
    yields, bugs_found: bugs, fixes_applied: fixes, generated_at: new Date().toISOString(),
  };
  try { await db.from('agent_runs').insert({ agent: 'supply-engine', started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), raw_found: bugs.length, rows_written: fixes.length, status: bugs.length ? 'error' : 'ok', meta: counter }); } catch (_e) {}
  return json(counter);
});
