// Supabase Edge Function — SPEC-64 in-app crawl fulfillment (Option A).
//
// Closes the "no crawl, no notify" gap: when a user searches a city with no
// providers, the app enqueues a crawl_request. This worker FULFILLS it:
//   1. Find real local businesses via the Google Places API (Text Search +
//      Details for phone/website) for the city + service_type.
//   2. Upsert them into leads_services (dedupe by Google place_id), staged at
//      outreach_status='new'. NOTE: we DO NOT send any cold email/SMS here —
//      contacting businesses that never opted in is governed by CAN-SPAM / TCPA,
//      so leads are QUEUED for the operator to review + send. (See FROZEN_SPEC.)
//   3. Stamp crawl_requests status='delivered' + delivered_count (or 'failed').
//   4. Notify the SEARCHER (requested_by) by email so they're never left
//      hanging: "we're adding <type> in <city> — we'll notify you as pros join."
//
// Only handles kind='services' (Google Places is a business directory; influencer
// crawls remain for the external/manual pipeline).
//
// AUTH: service-role bearer only (cron / "Fulfill Crawls.command").
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//          GOOGLE_PLACES_API_KEY  (server key — must NOT be HTTP-referrer
//          restricted, or Google returns REQUEST_DENIED for server calls).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { growthDb, growthEnvPresent } from '../_shared/growthDb.ts';

const FROM_EMAIL = 'Cergio <notify@cergio.ai>';
// Throughput (TUNABLE). Raised so the full YellowPages matrix drains in hours,
// not days. Google Places jobs cost API quota + $ per Details call, so they stay
// modest; YP jobs are free page fetches, so they get a much larger budget. Also
// overridable per-run via ?limit=N (service-role only).
//   NOTE (cron cadence): the pipeline cron runs fulfill-crawl every 15 min
//   (20260622180000_periodic_workers_cron.sql, job 'cergio_fulfill_crawl'). To
//   drain the ~5k-job YP matrix faster, tighten that schedule to '*/2 * * * *'
//   (every 2 min) or '* * * * *' (every minute). At limit=40 jobs/run × 30/min
//   that is ~1,200 jobs/min-cron-hour → the whole matrix in a few hours.
const MAX_REQUESTS_PER_RUN = 200;
const YP_FETCH_JITTER_MS = 1200; // polite pacing between YP page fetches (+ random)


// ── SPEC-116: DECOUPLE GROWTH FROM THE PRODUCT BY BATCHING WRITES ──────────
// Measured 2026-07-30: every source upserted ONE row per HTTP round-trip (11 call
// sites). At ~15,572 rows/day that is ~15,572 PostgREST connections, which starved
// the connection pool the live app shares — /rest/v1/services returned 503 while
// the founder was trying to list a service.
//
// The throttle-growth answer was the wrong trade. Batching gives the SAME row
// throughput for ~1/500th of the connections, so acquisition can run flat out and
// the product is never touched. Rows buffer per invocation and flush in chunks of
// 500; a failed chunk retries row-by-row so one bad row never costs 499 good ones.
const _rowBuf: Record<string, unknown>[] = [];
let _bufSaved = 0;
// SPEC-166 (found live 2026-08-01 in crawl_requests.notes): flushBuf referenced
// `gdb`, which is created INSIDE the serve() handler — this function is module
// level, so gdb was never in scope and EVERY flush threw "gdb is not defined".
// Jobs completed and were stamped delivered while every crawled row was silently
// discarded: 33 jobs delivered, leads_services 0. The failure was invisible at the
// HTTP layer and only the per-job notes exposed it.
// A lazily-created module-level client fixes every call site at once, including
// logAgentRun's internal flush, and lazy (not top-level) so a missing growth env
// cannot 500 the whole function at import time.
let _gdbShared: any = null;
function growthClient(): any {
  if (!_gdbShared) _gdbShared = growthDb();
  return _gdbShared;
}

async function flushBuf(_db: any): Promise<number> {
  if (_rowBuf.length === 0) return 0;
  const batch = _rowBuf.splice(0, _rowBuf.length);
  let ok = 0;
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    const { error } = await growthClient().from('leads_services').upsert(chunk, { onConflict: 'id' });
    if (!error) { ok += chunk.length; continue; }
    // SPEC-177: both of these errors used to be DISCARDED. A single unknown column
    // (zip) made PostgREST reject the entire chunk with 42703, the row-by-row retry
    // failed identically, and the caller had already run saved++ — so a source that
    // wrote nothing reported rows as delivered, for its whole life. A write error is
    // the most important fact a worker can have; it is never swallowed again.
    _lastFlushError = serr(error);
    for (const row of chunk) {
      const { error: e1 } = await growthClient().from('leads_services').upsert(row, { onConflict: 'id' });
      if (!e1) ok++; else _lastFlushError = serr(e1);
    }
  }
  _bufSaved += ok;
  return ok;
}
// SPEC-192 — HARD SPEC, founder 2026-08-01: "the spec specifically calls for email
// and or phone... without it the lead is useless... we can't SPEND on lists that don't
// have email and or phone. This should have been a HARD spec."
//
// It was enforced in three sources and missing from three others (yelp, google_lsa,
// ig_services), and I had actively WEAKENED it for craigslist by accepting a post URL
// as a substitute. A per-source rule is a rule that will be missed. It now lives in the
// ONE function every source writes through, so no crawler can save an unreachable row
// and no future source can forget it.
let _rejectedNoContact = 0;
function hasContact(row: Record<string, unknown>): boolean {
  const p = String(row.phone ?? '').trim();
  const e = String(row.owner_email ?? row.email ?? '').trim();
  return !!(p || e);
}

async function bufUpsert(_db: any, row: Record<string, unknown>): Promise<void> {
  if (!hasContact(row)) { _rejectedNoContact++; return; }   // SPEC-192: unreachable = not a lead
  _rowBuf.push(row);
  if (_rowBuf.length >= 500) await flushBuf(db);
}

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
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  // SPEC-197 — CRAWL SUSPENSION (founder, 2026-08-02): "suspend all crawl work until
  // we've audited 100 pieces since reset and the entire data output from each of the
  // sources." This is the hard stop, placed BEFORE any job is claimed or any vendor is
  // called, so no paid request can leave while the audit is open. Flip CRAWLS_SUSPENDED
  // to false to resume — nothing else needs changing.
  const CRAWLS_SUSPENDED = (Deno.env.get('CRAWLS_SUSPENDED') || 'true').toLowerCase() !== 'false';
  if (CRAWLS_SUSPENDED) {
    return json({ suspended: true, reason: 'CRAWLS_SUSPENDED — founder audit in progress (SPEC-197)', processed: 0 });
  }
  const started = Date.now();
  _runDeadline = started + 138_000;  // SPEC-172: hard wall, safely inside the 150s platform limit
  let dbRef: any = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const placesKey   = Deno.env.get('GOOGLE_PLACES_API_KEY')
      || Deno.env.get('GOOGLE_MAPS_KEY') || '';
    // 2026-07-15 (SPEC-72, free-first): OpenStreetMap/Overpass is the PRIMARY and
    // DEFAULT services source — keyless, no billing account, and it cannot be shut
    // off by a Google account state. Google Places is now DORMANT: its branch stays
    // in the tree (reversible) but is only ever reached when GOOGLE_PLACES_ENABLED=
    // true (default false), so the paid/billing-blocked API is never called unless a
    // human explicitly, reversibly flips one env var.
    const GOOGLE_PLACES_ENABLED = (Deno.env.get('GOOGLE_PLACES_ENABLED') || 'false').toLowerCase() === 'true';
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return json({ error: 'Unauthorized' }, 401);
    // NOTE: Places key is validated conditionally below (only google_places jobs
    // need it; yellowpages jobs are keyless free page fetches).

    const db = createClient(supabaseUrl, serviceKey);
    dbRef = db;

    // Per-run batch size: default high, overridable via ?limit=N (clamped).
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
    const perRun = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : MAX_REQUESTS_PER_RUN, 1), 500);

    // ── YELLOWPAGES IS DEAD FROM EDGE — QUARANTINE, DON'T RETRY ───────────────
    // YP answers every request from a datacenter IP with HTTP 403 (verified: every
    // run errored `yp-blocked: http=403`). Retrying it forever flooded agent_runs
    // with errors and held org_health red while the working path (Google Places)
    // was quietly growing services. So: YP jobs are no longer FETCHED. Any that are
    // still queued get stamped 'failed' ONCE with a permanent reason and are never
    // picked up again. The parser below is kept but dormant behind YP_ENABLED, so
    // this is reversible in one env var if we ever crawl from a residential egress.
    const YP_ENABLED = (Deno.env.get('YP_ENABLED') || 'false').toLowerCase() === 'true';
    const YP_DEAD_NOTE = 'yp-blocked-permanent: YellowPages returns HTTP 403 to datacenter IPs. ' +
      'Not retried. Google Places is the live services path (set YP_ENABLED=true only from a residential/proxy egress).';

    let ypQuarantined = 0;
    let ypSweepError: string | null = null;
    if (!YP_ENABLED) {
      const { data: swept, error: sErr } = await gdb
        .from('crawl_requests')
        .update({ status: 'failed', notes: YP_DEAD_NOTE, updated_at: new Date().toISOString() })
        .eq('kind', 'services')
        .eq('source', 'yellowpages')
        .in('status', ['new', 'crawling'])
        .select('id');
      if (sErr) ypSweepError = serr(sErr); else ypQuarantined = (swept ?? []).length;
    }

    // Pick up unworked service crawls. `source` (nullable) routes fulfillment:
    // NULL/'osm' → OpenStreetMap/Overpass (the free DEFAULT, keyless). 'google_places'
    // → Places API but ONLY when GOOGLE_PLACES_ENABLED=true (dormant by default).
    // 'yellowpages' rows are EXCLUDED here (see above) so a dead queue can never be
    // fetched or re-errored.
    // SPEC-161 (measured 2026-08-01): this read `db` — the PRODUCT client. The
    // SPEC-132 cutover moved every WRITE to gdb but left the primary job query
    // and the YP sweep behind, so the worker asked the product database for work
    // that only exists in growth. It found none; the phase-2 fallback below then
    // EXCLUDES phase-1 cities, which is every city we seed. Net effect: 3,638
    // queued jobs, 0 claimed, 0 rows, for as long as the cutover has been live.
    let jobQ = gdb
      .from('crawl_requests')
      .select('id, kind, city, state, lat, lng, service_type, target_count, requested_by, status, source, notes')
      .eq('kind', 'services')
      .eq('status', 'new');
    if (!YP_ENABLED) jobQ = jobQ.or('source.is.null,source.neq.yellowpages');
    // ── PRIORITY QUEUE (SPEC-97b, 2026-07-29) — ROOT CAUSE OF THE CITY DRIFT.
    // This was pure FIFO on created_at, so every city competed equally for worker
    // capacity: Miami/NYC-first lived only in conversation, never in code. Now
    // PHASE-1 metros (Miami + NYC/boroughs) drain FIRST, every run, always.
    const P1 = ['Miami','New York','Manhattan','Brooklyn','Queens','Bronx','Staten Island',
                'Miami Beach','Brickell','Wynwood','Coral Gables','Doral','South Beach',
                'Coconut Grove','Aventura','Little Havana','Hialeah','North Miami','Kendall','Pinecrest'];
    let jobs: any[] = [];
    {
      // 1) phase-1 metros first — FAIRLY ACROSS SOURCES (SPEC-174).
      // Pure FIFO meant the oldest jobs always won, and the oldest ~3,600 rows are
      // all osm. Measured: osm at 1,067 leads while yelp, google_sponsored,
      // gmaps_apify and ig_services read "no finished job yet" — never STARVED by
      // failing, simply never PICKED. A source the scheduler never runs cannot be
      // diagnosed, and its zero is not evidence of anything.
      const SOURCES_RR = ['osm', 'craigslist', 'yellowpages_apify', 'yelp',
                          'google_lsa', 'google_sponsored', 'gmaps_apify', 'ig_services'];
      const share = Math.max(1, Math.floor(perRun / SOURCES_RR.length));
      const perSource = await Promise.all(SOURCES_RR.map(async (src) => {
        const { data } = await gdb.from('crawl_requests')
          .select('id, kind, city, state, lat, lng, service_type, target_count, requested_by, status, source, notes')
          .eq('kind', 'services').eq('status', 'new').eq('source', src).in('city', P1)
          .order('created_at', { ascending: true }).limit(share);
        return data || [];
      }));
      // Interleave so the pool starts one job of EACH source immediately, rather
      // than filling every worker with osm and only then reaching the others.
      jobs = [];
      for (let i = 0; i < share; i++) for (const list of perSource) if (list[i]) jobs.push(list[i]);
      console.log(`round-robin: ${SOURCES_RR.map((s2, i) => `${s2}=${perSource[i].length}`).join(' ')}`);

      // Rows with a source outside the rota (legacy, google_local, null) still get
      // served with whatever capacity is left, so nothing is stranded.
      if (jobs.length < perRun) {
        const { data: legacy, error: e1 } = await jobQ.in('city', P1)
          .not('source', 'in', `(${SOURCES_RR.map((x) => `"${x}"`).join(',')})`)
          .order('created_at', { ascending: true }).limit(perRun - jobs.length);
        if (e1) throw e1;
        jobs = jobs.concat(legacy || []);
      }
      // 2) only if phase-1 has no work left, spend the remainder elsewhere
      if (jobs.length < perRun) {
        let q2 = gdb.from('crawl_requests')
          .select('id, kind, city, state, lat, lng, service_type, target_count, requested_by, status, source, notes')
          .eq('kind', 'services').eq('status', 'new').not('city', 'in', `(${P1.map(c => `"${c}"`).join(',')})`);
        if (!YP_ENABLED) q2 = q2.or('source.is.null,source.neq.yellowpages');
        const { data: rest } = await q2.order('created_at', { ascending: true }).limit(perRun - jobs.length);
        jobs = jobs.concat(rest || []);
      }
      console.log(`priority-queue: ${(jobs || []).filter((j: any) => P1.includes(j.city)).length}/${jobs.length} jobs are phase-1`);
    }

    // ── RECOVERY (2026-07-14 FORENSIC) ────────────────────────────────────────
    // Un-burn jobs that a previous run stamped 'failed' purely because the Google
    // account was denied (billing). Those jobs were never bad — they were victims
    // of an account state. Put them back in the queue; they now drain via OSM.
    await gdb.from('crawl_requests')
      .update({ status: 'new', updated_at: new Date().toISOString() })
      .eq('status', 'failed')
      .or('notes.ilike.%REQUEST_DENIED%,notes.ilike.%places-infra%,notes.ilike.%enable Billing%');

    // ── ORPHAN RECLAIM (2026-07-20 FORENSIC) ─────────────────────────────────
    // A job is stamped 'crawling' at the top of the loop (below) so concurrent
    // runs don't double-process it. If that run then TIMES OUT or crashes before
    // it reaches the 'delivered'/'failed'/'new' stamp, the job is orphaned in
    // 'crawling' forever — the un-burn block above only reclaims 'failed' rows,
    // never a stuck 'crawling'. Forensic export 2026-07-19 found 18 jobs pinned
    // in 'crawling' with delivered_count=0, the oldest stale ~9h. Reset any job
    // left in 'crawling' whose updated_at is older than a generous 15-minute
    // watchdog window back to 'new' so the next tick retries it. A legitimately
    // in-flight job updates well inside 15 min, so this never touches live work.
    await gdb.from('crawl_requests')
      .update({ status: 'new', notes: 'orphan-reclaim: reset from stuck crawling (run timeout/crash)', updated_at: new Date().toISOString() })
      .eq('kind', 'services')
      .eq('status', 'crawling')
      .lt('updated_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());

    // 2026-07-15 (SPEC-72): OpenStreetMap/Overpass is the free primary source, so a
    // missing/denied/disabled Places account is NEVER fatal. placesDown latches the
    // whole run onto Overpass; it starts TRUE whenever Google is disabled (the
    // default) or unkeyed, so every job flows to the free path unless Google Places
    // is explicitly re-enabled. It also latches mid-run if an enabled Google account
    // returns an infrastructure status (REQUEST_DENIED / OVER_QUERY_LIMIT).
    // FORCE OSM (2026-07-18, SPEC-72.2): billing on the Google project is disabled,
    // so ANY Google Places call returns REQUEST_DENIED (280/283 recent crawls failed
    // this way — while OSM delivered fine, incl. NYC). Pin placesDown=true so every
    // service job flows to the free OpenStreetMap/Overpass path regardless of the
    // GOOGLE_PLACES_ENABLED env (which is stale-true in prod). Google Places code is
    // left intact but unreachable — reversible by reverting this one line + fixing billing.
    let placesDown = true;
    let placesDownReason = GOOGLE_PLACES_ENABLED
      ? 'FORCED OSM: Google billing disabled → Places REQUEST_DENIED; OpenStreetMap is the free source'
      : 'GOOGLE_PLACES_ENABLED=false (OpenStreetMap is the free primary source)';

    const out: Array<Record<string, unknown>> = [];
    // SPEC-164 (measured live 2026-08-01): the platform kills an edge request at
    // 150s. With no budget of its own the worker was killed MID-JOB — which is why
    // the first live run showed 11 jobs delivered and ZERO leads: rows sat in
    // _rowBuf and the process died before flushBuf ever ran, and a job already
    // stamped 'crawling' was abandoned. Stop taking NEW jobs at 105s, flush, and
    // return a real response. Fewer jobs per run that actually PERSIST beat more
    // jobs that vanish, and the 10-minute schedule takes the rest.
    const BUDGET_MS = 105_000;
    let budgetHit = false;
    // SPEC-169 — PARALLEL JOBS. Measured on the live queue: 14.7 jobs/hour, which
    // would take 10.6 DAYS to drain 3,733 open jobs. The cause was not the cron
    // cadence — it was this loop running jobs ONE AT A TIME while a single Overpass
    // query can block for up to 90s. Nearly the whole 105s budget went to one job.
    //
    // A small worker pool fixes it without touching any per-job logic: each task
    // still claims, crawls, records and buffers exactly as before. Concurrency is
    // deliberately modest — these are free public endpoints (Overpass etiquette),
    // and hammering them earns 429s that would cost more throughput than they gain.
    // Writes are unaffected: _rowBuf is append-then-batch-upsert, so more producers
    // simply fill batches faster.
    const CONCURRENCY = Number(Deno.env.get('CRAWL_CONCURRENCY') || '6');
    const queue = [...(jobs ?? [])];
    const runJob = async (job: any) => {
      // SPEC-185 HARD STOP: check the dollar budget BEFORE doing any paid work.
      // This is the only place that can actually prevent a charge — a guard that
      // runs after the fact is a report, not a control.
      const blocked = await spendBlockedReason(String(job.source || ''));
      if (blocked) {
        await gdb.from('crawl_requests').update({
          status: 'parked', notes: blocked, updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        out.push({ id: job.id, source: job.source, spend_blocked: true, note: blocked });
        console.log(blocked);
        return;
      }
      _lastApifyCostUsd = 0;
      // SPEC-190: SerpAPI and Yelp expose no per-run cost we can read from the edge, so
      // charge the published list price per call into the SAME ledger. Otherwise they
      // report $0 forever and the tranche gate can never fire for them.
      _lastNonApifyCostUsd = EST_COST_PER_CALL_USD[VENDOR_OF_SOURCE[String(job.source || '')] || ''] || 0;
      // Mark crawling so concurrent runs don't double-process.
      await flushBuf(db); await gdb.from('crawl_requests').update({ status: 'crawling', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'new');

      try {
        // DEFAULT source is now 'osm' (free-first). Legacy rows were backfilled to
        // 'google_places' by migration 20260707000000; new app + seeder rows set
        // 'osm' explicitly. A null source therefore means a brand-new osm job.
        const source = (job.source ?? 'osm') as string;
        let saved = 0;
        let found = 0;
        let query = '';

        if (source === 'yellowpages' && !YP_ENABLED) {
          // Defense in depth: the query above already excludes YP jobs. If one
          // reaches here (a race with the seeder), stamp it permanently failed
          // WITHOUT a fetch — no 403, no error flood, no retry.
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'failed', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, notes: YP_DEAD_NOTE, updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          ypQuarantined++;
          return;
        } else if (source === 'yellowpages') {
          // ── YellowPages page-scrape path (free, keyless) — DORMANT ──────────
          // Only reachable with YP_ENABLED=true (a residential/proxy egress).
          // A BLOCK page (anti-bot / empty response to datacenter IPs) is NOT a
          // successful delivery: fulfillYellowPages throws YpBlockedError, which
          // is caught below and stamps the job 'failed' (note 'yp-blocked') so the
          // queue is not silently drained to delivered-0 and the block surfaces in
          // agent_runs. Only a real fetch that parsed the page marks 'delivered'.
          const r = await fulfillYellowPages(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: saved === 0 ? (_lastApifyError || 'no YellowPages results for this city/type') : null,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'yellowpages_apify') {
          // ── YellowPages via Apify (trudax) — structured business listings ──
          const r = await fulfillYellowPagesApify(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastFlushError || _lastApifyError || `no YellowPages results (raw items returned: ${r.found ?? 0})`) : 'yellowpages'),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'gmaps_apify') {
          // ── GOOGLE MAPS via APIFY (SPEC-103) — APIFY-FIRST backbone. Replaces the
          //    dead Google Places API path (billing disabled -> 101 failed jobs) and
          //    out-scales Yelp: no daily cap, pay-per-result, returns email+phone.
          const r = await fulfillGmapsApify(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastFlushError || _lastApifyError || `no Google Maps results (raw items returned: ${r.found ?? 0})`) : 'gmaps_apify'),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'ig_services') {
          // ── IG-FOR-SERVICES (SPEC-102): direct Instagram user search per service x
          //    city. Proven in eval (12 real Miami trainers in seconds). Yields the
          //    DUAL creator/service class: a local provider WITH an audience.
          const r = await fulfillIgServices(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastFlushError || _lastApifyError || `no IG accounts for this service/city (raw items returned: ${r.found ?? 0})`) : `ig_services${_lastCreatorError ? ' · ' + _lastCreatorError : ''}`),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'craigslist') {
          // ── Craigslist via Apify actor (memo23/craigslist-scraper). Capped
          //    maxItems (cost), deduped by phone/email/name, first-name parsed.
          const r = await fulfillCraigslist(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastFlushError || _lastApifyError || `no Craigslist results (raw items returned: ${r.found ?? 0})`) : 'craigslist'),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'google_lsa') {
          // ── Google LOCAL SERVICES ADS via SerpAPI (the "Sponsored" service pros
          //    with a published phone + Google Guaranteed badge). data_source=google_lsa.
          // SPEC-193: retired off SerpAPI onto the Apify Google-Maps extractor —
          // same data class (local pros with a published phone), best proven cost per
          // lead on the board, and it satisfies SPEC-192 because Google Maps carries a
          // phone for nearly every place.
          const r = await fulfillGmapsApify(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastFlushError || _lastSerpError || `no Google local-services ads (raw items returned: ${r.found ?? 0})`) : 'google_lsa'),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'google_sponsored') {
          // ── Google Sponsored (SPEC-105, corrected on evidence 2026-07-29) ────
          // The founder's spec for this source was a pasted block of "Sponsored
          // <service> | <city>" listings WITH phone numbers. Those are Google
          // LOCAL SERVICES ADS (engine=google_local_services), NOT the generic
          // engine=google `ads[]` array. Measured: LSA = 88 rows, 100% with a
          // phone; the generic ads[] path = 0 rows across every job it ever ran.
          // So run the PROVEN LSA fetcher first and keep the ads[] scrape only as
          // a supplement. Provenance stays 'google_sponsored' so the founder's
          // dashboard row is the one that fills.
          // SPEC-193: retired off SerpAPI onto the Apify extractor (see google_lsa).
          const lsa = await fulfillGmapsApify(db, job);
          let r = lsa;
          if (lsa.saved === 0) {
            const alt = await fulfillGoogleSponsored(db, job);
            if (alt.saved > 0) r = alt;
            else r = { ...lsa, note: `no LSA + no ads[] (${lsa.note || 'lsa empty'})` };
          }
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastSerpError || `no Google sponsored/LSA results (raw items returned: ${r.found ?? 0})`) : 'google_sponsored via LSA'),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'yelp') {
          // ── Yelp Fusion API (official, keyed, free trial) ─────────────────
          // Structured provider data: name, phone, address, categories, url.
          // No email/website from the search endpoint (enriched later via a
          // provider actor). NO-OP without YELP_API_KEY. Geo-verified + entity-
          // classified (company vs individual) + provenance data_source='yelp'.
          const r = await fulfillYelp(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: r.note || (saved === 0 ? (_lastFlushError || _lastYelpError || `no Yelp results for this city/type (raw items returned: ${r.found ?? 0})`) : 'yelp'),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else if (source === 'osm' || placesDown) {
          // ── PRIMARY services source: OpenStreetMap via Overpass (keyless, free)
          // This is the DEFAULT path for every services crawl (bulk + on-demand).
          // Constitution: free-first. It runs for source='osm', for null-source
          // jobs (default), and whenever Google Places is disabled/denied/unkeyed.
          // A blocked/rate-limited/timed-out Overpass response throws
          // OverpassBlockedError (caught below → job re-queued, run surfaced as
          // 'error' with the reason in agent_runs.meta) and is NEVER masked as a
          // delivered-0 (SPEC-72).
          const r = await fulfillOverpass(db, job);
          saved = r.saved; found = r.found; query = r.query;
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: saved === 0
              ? `no OpenStreetMap results for ${job.service_type || 'this type'} in ${job.city || 'this city'}`
              : `osm (${r.endpoint || 'overpass'})`,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        } else {
          // ── Google Places path — DORMANT (only reached when GOOGLE_PLACES_ENABLED
          //    =true AND a valid key exists AND source='google_places'). Left intact
          //    and reversible as a last-resort; never called by default. ──────────
          const want = Math.min(Math.max(job.target_count || 10, 1), 20);
          const where = [job.city, job.state].filter(Boolean).join(', ');
          query = `${job.service_type || 'local service'} in ${where || 'United States'}`;

          const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${placesKey}`;
          const tsRes = await fetch(tsUrl);
          const ts = await tsRes.json();
          if (ts.status && ts.status !== 'OK' && ts.status !== 'ZERO_RESULTS') {
            const st  = String(ts.status);
            const em  = String(ts.error_message || '');
            // INFRASTRUCTURE status (billing disabled, key denied, quota) — this is
            // an ACCOUNT state, not a bad job. Latch placesDown so every remaining
            // job this run goes to the free OSM path, and throw a typed error so the
            // catch below RE-QUEUES this job instead of burning it to 'failed'.
            if (/REQUEST_DENIED|OVER_QUERY_LIMIT|BILLING_NOT_ENABLED/i.test(st) || /billing/i.test(em)) {
              placesDown = true;
              placesDownReason = `${st}${em ? ' — ' + em : ''}`.slice(0, 200);
              throw new PlacesInfraError(placesDownReason);
            }
            throw new Error(`Places: ${st}${em ? ' — ' + em : ''}`);
          }
          const results = (ts.results || []).slice(0, want);
          found = results.length;

          for (const r of results) {
            let phone = null, website = null, email = null;
            try {
              const dUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.place_id}&fields=formatted_phone_number,website&key=${placesKey}`;
              const dRes = await fetch(dUrl);
              const d = await dRes.json();
              phone = d.result?.formatted_phone_number ?? null;
              website = d.result?.website ?? null;
            } catch { /* details best-effort */ }

            // SPEC-65: best-effort capture of a PUBLIC contact email from the
            // business's own website, so compliant email outreach has an address.
            if (website) email = await scrapeEmail(website);

            const row = {
              id: r.place_id,
              name: r.name,
              service_type: job.service_type || null,
              phone, phone_origin: phone ? 'google_places' : null,
              website_url: website,
              owner_email: email,
              address: r.formatted_address || null,
              city: job.city || null,
              state: job.state || 'FL',
              lat: r.geometry?.location?.lat ?? null,
              lon: r.geometry?.location?.lng ?? null,
              data_source: 'google_places',
              fetched_at: new Date().toISOString(),
              outreach_status: 'new', // raw/ungraded — the gate promotes mobile→'queued'; never auto-sent
              outreach_notes: `auto-sourced via Google Places (${job.city || '?'}) ${new Date().toISOString().slice(0,10)}`,
            };
            // 2026-06-28 reset: service crawls feed leads_services (the real mobile
            // provider bucket that outreach + the gate read). leads_localbiz is
            // dormant (brick-and-mortar Phase 2). The gate quarantines storefront/
            // off-target rows; only mobile/reachable types are promoted to 'queued'.
            await bufUpsert(db, row); const upErr = null;
            if (!upErr) saved++;
          }

          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'delivered', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd, delivered_count: saved,
            notes: saved === 0 ? 'no Google Places results for this city/type' : null,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        }

        // ── Notify the searcher ───────────────────────────────────────────────
        await notifySearcher(db, job, saved);
        await notifyOnDemandProviders(db, job);
        await notifyOnDemandProvidersSMS(db, job);
        out.push({ id: job.id, source, query, found, saved });
      } catch (e) {
        const msg = serr(e);
        // ── INFRASTRUCTURE failure ≠ job failure ──────────────────────────────
        // 2026-07-14 (FORENSIC): Google Places started returning REQUEST_DENIED
        // (billing disabled). The old code stamped every such job 'failed', which
        // at the */2 cron × 40 jobs BURNED ~1,200 queued jobs/hour permanently —
        // silently destroying the crawl queue while the dashboard showed 'error'.
        // An account-state error must put the job BACK to 'new' so it is retried
        // (the next job in this run already falls through to the free OSM source).
        if (e instanceof PlacesInfraError) {
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'new',
            notes: `places-infra (re-queued, not burned): ${msg}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          out.push({ id: job.id, error: msg, infra: true });
          return;
        }
        // ── Overpass rate-limit / block / timeout is TRANSIENT, not a bad job ────
        // SPEC-72: the block is SURFACED (this pushes an error → the run logs
        // 'error' and agent_runs.meta.osm_blocked carries the count + reason, so a
        // block flood can never hide behind a silent delivered-0). But the JOB is
        // RE-QUEUED to 'new' (not burned to 'failed'): Overpass has 2 slots + short
        // cooldowns, so a 429/504 clears on the next run. yp-blocked note appears in
        // the generic branch below (status: 'failed') for the dormant YP path.
        if (e instanceof OverpassBlockedError || /^osm-blocked/i.test(msg)) {
          await flushBuf(db); await gdb.from('crawl_requests').update({
            status: 'new',
            notes: `osm-blocked (re-queued, transient): ${msg}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          out.push({ id: job.id, error: msg, blocked: true, osm: true });
          return;
        }
        const blocked = e instanceof YpBlockedError || /^yp-blocked/i.test(msg);
        // A block page is stamped 'failed' with a distinct 'yp-blocked' note — NOT
        // 'delivered' — so the queue is not silently drained to delivered-0 and the
        // health-check/watchdog can see the anti-bot block for what it is.
        await flushBuf(db); await gdb.from('crawl_requests').update({
          status: 'failed', cost_usd: _lastApifyCostUsd + _lastNonApifyCostUsd,
          notes: (blocked ? `yp-blocked: ${msg}` : msg).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        out.push({ id: job.id, error: msg, blocked });
      }
    };

    // Pool driver: CONCURRENCY workers pull from the shared queue until it is empty
    // or the budget is spent. The budget is checked per TASK (not per batch), so a
    // run still returns cleanly inside the 150s platform limit — SPEC-164 — while
    // doing several jobs' worth of work in the same wall-clock window.
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
      for (;;) {
        if (Date.now() - started > BUDGET_MS) { budgetHit = true; return; }
        const job = queue.shift();
        if (!job) return;
        await runJob(job);
      }
    }));
    if (budgetHit) console.log(`time budget reached after ${out.length} job(s) — flushing and returning cleanly`);
    console.log(`processed ${out.length} job(s) at concurrency ${CONCURRENCY} in ${Date.now() - started}ms`);

    // BACKBONE: unified agent_runs ledger. raw_found = businesses parsed across
    // all jobs this run, rows_written = rows actually upserted to leads_services.
    // 'error' if any job failed; 'empty' if we processed jobs but wrote nothing;
    // 'ok' if we saved rows OR there were simply no jobs to do (idle is not a
    // silent collision — the watchdog only flags raw_found>0 AND rows_written=0).
    const totFound = out.reduce((a, r: any) => a + (Number(r.found) || 0), 0);
    const totSaved = out.reduce((a, r: any) => a + (Number(r.saved) || 0), 0);
    const anyErr   = out.some((r: any) => r.error);
    const blockedCount = out.filter((r: any) => r.blocked).length;
    const osmBlocked   = out.filter((r: any) => r.osm && r.error);
    const osmBlockReasons = Array.from(new Set(osmBlocked.map((r: any) => String(r.error)))).slice(0, 5);
    // SURFACE the block: if every processed job was a source block (e.g. YP anti-bot
    // on datacenter IPs) with zero rows written, this run is NOT 'ok' — it's 'error'
    // so the watchdog/health-check flags it instead of the block hiding behind a
    // silent delivered-0. Meta carries the block count for the crawl dashboard.
    // Quarantining dead YP jobs is BOOKKEEPING, not a failure: it must not colour
    // the run red (that is the error flood we are removing). It is reported in meta.
    await logAgentRun(db, 'fulfill-crawl', {
      started, raw_found: totFound, rows_written: totSaved,
      status: anyErr ? 'error'
              : (out.length > 0 && totSaved === 0 && totFound > 0) ? 'empty' : 'ok',
      error: anyErr ? out.filter((r: any) => r.error).map((r: any) => r.error).join(' | ').slice(0, 500)
             : (ypSweepError ? `yp-quarantine sweep failed: ${ypSweepError}` : null),
      meta: {
        processed: out.length, blocked: blockedCount,
        osm_blocked: osmBlocked.length, osm_block_reasons: osmBlockReasons,
        source_default: 'osm', google_places_enabled: GOOGLE_PLACES_ENABLED,
        yp_enabled: YP_ENABLED, yp_quarantined: ypQuarantined, yp_sweep_error: ypSweepError,
      },
    });
    return json({
      processed: out.length, yp_quarantined: ypQuarantined, yp_enabled: YP_ENABLED,
      // SPEC-164: say so when the run stopped on its budget rather than on an
      // empty queue, so "few jobs processed" is never mistaken for "no work left".
      budget_hit: budgetHit, elapsed_ms: Date.now() - started,
      rejected_no_contact: _rejectedNoContact,   // SPEC-192
      results: out,
    });
  } catch (e) {
    await logAgentRun(dbRef, 'fulfill-crawl', {
      started, raw_found: null, rows_written: 0,
      status: 'error', error: serr(e),
    });
    return json({ error: serr(e) }, 500);
  }
});

// ── CANONICAL ERROR SERIALIZER — DO NOT FORK ─────────────────────────────────
// Supabase/PostgREST rejects with a PLAIN OBJECT ({message, details, hint, code}),
// NOT an Error. `String(e)` on that object yields the opaque "[object Object]" —
// which is exactly how 11/11 failed autonomous actions recorded an unreadable
// `result` and the loop went blind (Forensic Auditor 2026-07-13). Always extract a
// REAL message + code (+ 2 stack frames) so every failure is diagnosable.
// qa.mjs #73 asserts every copy of this helper is byte-identical, unit-tests it
// against a PostgREST-shaped rejection, and fails the push if it can ever emit
// "[object Object]".
function serr(e: unknown): string {
  if (e === null || e === undefined) return 'unknown error (null)';
  if (typeof e === 'string') return e || 'unknown error (empty string)';
  const o = e as any;
  const msg = (e instanceof Error ? e.message : null)
    || o?.message || o?.error?.message || o?.error_description || o?.msg
    || o?.details || o?.hint || null;
  const code = o?.code ?? o?.error?.code ?? o?.status ?? o?.statusCode ?? null;
  const parts: string[] = [];
  if (msg) parts.push(String(msg));
  if (code !== null && code !== undefined && String(code) !== '') parts.push('[' + String(code) + ']');
  if (o?.details && String(o.details) !== String(msg)) parts.push('- ' + String(o.details));
  if (o?.hint && String(o.hint) !== String(msg)) parts.push('(hint: ' + String(o.hint) + ')');
  if (parts.length === 0) {
    let dump = '';
    try { dump = JSON.stringify(e); } catch (_j) { dump = ''; }
    parts.push(dump && dump !== '{}' ? dump : 'unhandled ' + (typeof e) + ' thrown with no message/code/details fields');
  }
  if (e instanceof Error && e.stack) {
    const frames = String(e.stack).split('\n').slice(1, 3).map((s) => s.trim()).filter(Boolean).join(' <- ');
    if (frames) parts.push('| ' + frames);
  }
  return parts.join(' ').trim().slice(0, 900);
}

// BACKBONE helper — write ONE agent_runs row per invocation. NEVER throws.
async function logAgentRun(
  db: any,
  agent: string,
  o: { started: number; raw_found?: number | null; rows_written?: number | null;
       status?: string; error?: string | null; meta?: unknown },
): Promise<void> {
  if (!db) return;
  try {
    await flushBuf(db);   // never strand a buffered row
    await db.from('agent_runs').insert({
      agent,
      started_at: new Date(o.started).toISOString(),
      finished_at: new Date().toISOString(),
      raw_found: o.raw_found ?? null,
      rows_written: o.rows_written ?? null,
      status: o.status ?? 'ok',
      error: o.error ? String(o.error).slice(0, 1000) : null,
      meta: o.meta ?? null,
    });
  } catch (_e) { /* best-effort */ }
}

// ── ON-DEMAND TRANSACTIONAL SMS to the crawled services (SPEC-92b). A genuine
// person->service customer inquiry (NOT Cergio marketing) to a business that
// PUBLISHED its number to receive jobs. Curated list (not autodialer/random per
// Facebook v. Duguid); STOP honored; suppression-checked; throttled; consent basis
// logged (published_number). HARD-GATED on ONDEMAND_SMS_ENABLED — its own
// dedicated flag (separate from the marketing OUTREACH_SMS_ENABLED); sends NOTHING
// until 10DLC is approved + that flag is flipped. Fires only for on-demand crawls.
function toE164svc(raw: string): string | null {
  const d = (raw || '').replace(/[^\d]/g, '');
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length === 10) return '+1' + d;
  return null;
}
async function notifyOnDemandProvidersSMS(db: any, job: any) {
  try {
    if (!job.trigger_request_id) return;
    if ((Deno.env.get('ONDEMAND_SMS_ENABLED') || 'false').toLowerCase() !== 'true') return; // DEDICATED gate (separate from founding-cohort marketing SMS)
    const twSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twUser = Deno.env.get('TWILIO_API_KEY_SID') || twSid;
    const twPass = Deno.env.get('TWILIO_API_KEY_SECRET') || Deno.env.get('TWILIO_AUTH_TOKEN');
    const twFrom = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') || Deno.env.get('TWILIO_FROM_NUMBER');
    if (!twSid || !twUser || !twPass || !twFrom) return;
    const { data: reqRow } = await db.from('requests')
      .select('what, when_text, where_text, provider_type, service_type').eq('id', job.trigger_request_id).maybeSingle();
    const type = job.service_type || reqRow?.provider_type || reqRow?.service_type || 'local pro';
    const where = reqRow?.where_text || job.city || 'your area';
    const when = reqRow?.when_text ? ` (${String(reqRow.when_text).slice(0, 30)})` : '';
    const link = `https://cergio.ai/inbound/${job.trigger_request_id}`;
    // SPEC-188: these notify helpers are MODULE-LEVEL — `gdb` is created inside serve()
    // and was never in scope here. Same defect as SPEC-166 (which silently discarded
    // every crawled row) and SPEC-185. growthClient() resolves at module scope.
    const { data: provs } = await growthClient().from('leads_services')
      .select('id, name, service_type, phone, outreach_notes')
      .eq('city', job.city).eq('service_type', job.service_type)
      .not('phone', 'is', null).neq('outreach_status', 'do_not_contact').limit(20);
    let sent = 0;
    for (const p of (provs || [])) {
      const e164 = toE164svc(p.phone); if (!e164) continue;
      if (osmIsBlocked(`${p.name || ''} ${p.service_type || ''}`)) continue;
      const { data: supp } = await db.from('outreach_suppressions').select('id').eq('channel', 'sms').ilike('address', e164).maybeSingle();
      if (supp) continue;
      // TRANSACTIONAL customer-inquiry copy (never "join Cergio"):
      const body = `A customer near ${where} needs a ${type}${when}. See the job and reply with your price: ${link} — Cergio. Reply STOP to opt out.`;
      const form = new URLSearchParams();
      form.set(twFrom.startsWith('MG') ? 'MessagingServiceSid' : 'From', twFrom);
      form.set('To', e164); form.set('Body', body);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + btoa(`${twUser}:${twPass}`), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (r.ok) {
        sent++;
        // consent-basis audit trail on the lead
        const note = `${(p.outreach_notes || '').slice(0, 180)} | sms:ondemand consent:published_number ${new Date().toISOString().slice(0, 10)}`;
        await growthClient().from('leads_services').update({ outreach_notes: note, outreach_last_at: new Date().toISOString() }).eq('id', p.id);
      }
      await new Promise((res) => setTimeout(res, 2500)); // staggered send (spam-safety)
    }
    if (sent) console.log(`on-demand SMS: notified ${sent} providers for request ${job.trigger_request_id}`);
  } catch { /* best-effort; never fail the crawl */ }
}

// ── ON-DEMAND: email the crawled SERVICES about the real user request (compliant:
// they published email to get customers; personalized to a genuine lead; blocked-
// category + suppression guarded; opt-out + SMS opt-in capture). Fires only for
// on-demand crawls (trigger_request_id). Cold VOICE/SMS stays OFF until they opt in.
async function notifyOnDemandProviders(db: any, job: any) {
  try {
    if (!job.trigger_request_id) return;
    const resendKey = Deno.env.get('RESEND_API_KEY'); if (!resendKey) return;
    const { data: reqRow } = await db.from('requests')
      .select('what, when_text, where_text, service_type, provider_type, city')
      .eq('id', job.trigger_request_id).maybeSingle();
    const type = job.service_type || reqRow?.provider_type || reqRow?.service_type || 'local pro';
    const where = reqRow?.where_text || job.city || 'your area';
    const what = reqRow?.what ? ` for ${String(reqRow.what).slice(0, 80)}` : '';
    const when = reqRow?.when_text ? ` (needed ${String(reqRow.when_text).slice(0, 40)})` : '';
    const link = `https://cergio.ai/inbound/${job.trigger_request_id}`;
    const { data: provs } = await growthClient().from('leads_services')
      .select('name, owner_email, service_type')
      .eq('city', job.city).eq('service_type', job.service_type)
      .not('owner_email', 'is', null).neq('outreach_status', 'do_not_contact').limit(25);
    let sent = 0;
    for (const p of (provs || [])) {
      const email = String(p.owner_email || '').toLowerCase();
      if (!email.includes('@')) continue;
      if (osmIsBlocked(`${p.name || ''} ${p.service_type || ''}`)) continue;
      const { data: supp } = await db.from('outreach_suppressions')
        .select('id').eq('channel', 'email').ilike('address', email).maybeSingle();
      if (supp) continue;
      const subject = `A customer near ${where} needs a ${type}`;
      const html = `<p>Hi${p.name ? ' ' + p.name : ''}, a Cergio user near <b>${where}</b> is looking for a <b>${type}</b>${what}${when}.</p>`
        + `<p>If you can help, <b>reply here with your price</b>: <a href="${link}">${link}</a></p>`
        + `<p>Want jobs like this the moment they come in? <b>Reply YES</b> and we'll text you (opt-in). Reply STOP to stop these emails.</p>`
        + `<p style="color:#888;font-size:12px">Cergio · you're receiving this because your business is listed publicly for ${type} services. Reply STOP to opt out.</p>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: email, subject, html, reply_to: 'jobs@cergio.ai' }),
      });
      sent++;
    }
    if (sent) console.log(`on-demand: notified ${sent} providers for request ${job.trigger_request_id}`);
  } catch { /* best-effort; never fail the crawl */ }
}

async function notifySearcher(db: any, job: any, saved: number) {
  try {
    if (!job.requested_by) return;
    const { data: u } = await db.auth.admin.getUserById(job.requested_by);
    const email = u?.user?.email;
    if (!email) return;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return;
    const place = job.city || 'your area';
    const type = job.service_type || 'local pros';
    const subject = saved > 0
      ? `We're adding ${type} in ${place} to Cergio`
      : `We're working on ${type} in ${place}`;
    const body = saved > 0
      ? `Good news — we found ${saved} ${type} in ${place} and we're bringing them onto Cergio. We'll notify you as they come online so you can book them directly or through your network.`
      : `Thanks for searching ${type} in ${place}. We don't have them yet, but your request told us to source that area — we'll notify you as soon as pros are available.`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: email, subject, html: `<p>${body}</p>` }),
    });
  } catch { /* notify best-effort; never fail the crawl on it */ }
}

// Best-effort: fetch a business homepage and pull the first published contact
// email. Skips role addresses that aren't useful and obvious junk. Times out
// fast so one slow site can't stall the run. Returns null if none found.
async function scrapeEmail(website: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(website, { signal: ctrl.signal, headers: { 'User-Agent': 'CergioBot/1.0 (+https://cergio.ai)' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const htmlText = (await res.text()).slice(0, 200000);
    const matches = htmlText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const m of matches) {
      const e = m.toLowerCase();
      if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/.test(e)) continue; // asset filename false-positives
      if (/(sentry|wixpress|example\.com|godaddy|squarespace)/.test(e)) continue;
      return e;
    }
    return null;
  } catch { return null; }
}

// Mirror of scrapeEmail: pull the first plausible US phone from a page (the
// advertiser's OWN landing page — compliant, same clean-room rule). Never guesses.
async function scrapePhone(website: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(website, { signal: ctrl.signal, headers: { 'User-Agent': 'CergioBot/1.0 (+https://cergio.ai)' } });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200000);
    const tel = html.match(/tel:\+?1?[\s-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i);
    const cand = tel ? tel[0].replace(/^tel:/i, '') : (html.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/) || [])[0];
    return cand ? normPhone(cand) : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// YellowPages fulfillment: parse real business listings from YP search result
// pages and upsert into leads_services — SAME columns / staging / gate as the
// Google Places path. No API, no key. Free page fetches with polite pacing.
// ─────────────────────────────────────────────────────────────────────────────

const YP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const YP_RESULTS_PER_PAGE = 30; // YP renders ~30 organic results per page
// Max bytes of a YP page we hold in memory. Bounds against a pathological/OOM
// response (the HTTP-546 crash) WITHOUT slicing off the (late-in-document) JSON-LD
// listing block on a normal ~1.5–2.5 MB YP results page. See the fetch site.
const YP_MAX_PAGE_BYTES = 4_000_000;

// BLOCKED categories (SECOND safety net — the seeder never enqueues these, but a
// stray hand-inserted job or an ad/sponsored slot could still surface one).
// Word-bounded where a bare token would false-match ("bar" in "barber").
const YP_BLOCKED = new RegExp(
  '(massage|tattoo|makeup|\\bpersonal chef\\b|private chef' +
  '|plastic surgery|cosmetic surgery|\\bsurgeon\\b' +
  '|weight ?loss (?:clinic|cent(?:er|re)|md\\b|m\\.d|doctor|physician|surgeon|surgery|institute)|\\bpeptide|bariatric|semaglutide|ozempic|wegovy|tirzepatide|med.?spa|medi.?spa|med.?aesthetic|medical aesthetic|botox|\\bfiller|injectable|dermatolog|liposuction|\\bbbl\\b|iv drip|iv therapy|hormone (replacement|therapy)|\\bhrt\\b' +
  '|\\bdrug\\b|pharmac|cannabis|dispensary|marijuana' +
  '|liquor|\\bwine\\b|brewery|winery|distillery|\\bwine bar\\b|cocktail bar' +
  '|tobacco|smoke shop|\\bvape\\b|\\bcigar\\b' +
  '|casino|gambling|\\bbetting\\b|firearm|\\bgun\\b|\\bammo\\b' +
  '|\\bescort\\b|strip club|nightclub|night club|disc jockey|\\bdj\\b)',
  'i',
);

// name↔service_type plausibility: reject "restaurant-as-plumber" garbage. If we
// have a keyword profile for the requested type, the business name (or its YP
// category text) must contain at least one on-topic token. Types with no profile
// fall through as accepted (we can't disprove them). Mirrors the DB gate's guard.
const YP_TYPE_KEYWORDS: Record<string, RegExp> = {
  plumber:          /(plumb|drain|\bpipe|rooter|leak|sewer|septic|water heater|faucet|rooterman)/i,
  electrician:      /(electric|electr|wiring|lighting|generator|\bvolt)/i,
  hvac:             /(hvac|heating|cooling|\bair\b|\bac\b|furnace|refrigerat|climate|mechanical)/i,
  handyman:         /(handy|handyman|repair|remodel|home improve|fix)/i,
  'house cleaning': /(clean|maid|housekeep|janitor)/i,
  'maid service':   /(clean|maid|housekeep)/i,
  landscaping:      /(landscap|lawn|garden|yard|\bturf|irrigation|hardscap)/i,
  'lawn care':      /(lawn|landscap|turf|mow|garden|yard)/i,
  'tree service':   /(tree|arborist|stump|\btrim)/i,
  'pest control':   /(pest|extermin|termite|bug|rodent|mosquito|wildlife)/i,
  mover:            /(mov|moving|relocat|hauling|\bhaul|transport)/i,
  'junk removal':   /(junk|haul|debris|removal|clean out|dumpster)/i,
  painter:          /(paint|coating|finish)/i,
  roofing:          /(roof|shingle|gutter)/i,
  flooring:         /(floor|tile|carpet|hardwood|laminate)/i,
  'window cleaning':/(window|glass|pane)/i,
  'pressure washing':/(pressure wash|power wash|soft wash|\bwash)/i,
  'gutter cleaning':/(gutter|downspout|roof)/i,
  'pool cleaning':  /(pool|spa|aquatic)/i,
  'appliance repair':/(appliance|repair|refrigerat|washer|dryer|\boven|dishwasher)/i,
  locksmith:        /(lock|key|security|safe)/i,
  'garage door repair':/(garage|door|opener)/i,
  fencing:          /(fenc|gate|railing)/i,
  drywall:          /(drywall|sheetrock|plaster|texture)/i,
  'carpet cleaning':/(carpet|rug|upholstery|steam|clean)/i,
  photographer:     /(photo|foto|studio|imag|portrait)/i,
  videographer:     /(video|film|cinema|media|product)/i,
  'personal trainer':/(train|fitness|gym|coach|wellness|strength)/i,
  'yoga instructor':/(yoga|studio|wellness|namaste)/i,
  'pilates instructor':/(pilates|studio|reformer|wellness)/i,
  'nutrition coach':/(nutrition|dietit|wellness|diet|health)/i,
  'hair stylist':   /(hair|salon|stylist|beauty|blow|color)/i,
  barber:           /(barber|cuts|grooming|shave|fade)/i,
  'nail technician':/(nail|manicure|pedicure|salon|spa)/i,
  'lash technician':/(lash|brow|beauty|extension)/i,
  'dog walker':     /(dog|pet|paw|canine|walk)/i,
  'dog grooming':   /(groom|dog|pet|paw|canine|mobile)/i,
  'pet sitting':    /(pet|sit|dog|cat|paw|boarding)/i,
  'mobile mechanic':/(mechanic|auto|car|repair|mobile|service)/i,
  'auto detailing': /(detail|auto|car|wash|mobile|ceramic)/i,
  'car wash':       /(wash|auto|car|detail|mobile)/i,
  tutor:            /(tutor|learn|academ|educat|prep|teach|math|reading)/i,
  'music teacher':  /(music|piano|guitar|voice|lesson|studio|academy)/i,
  bookkeeping:      /(bookkeep|account|tax|financ|ledger|payroll)/i,
  'tax preparation':/(tax|account|financ|prep|cpa)/i,
  'computer repair':/(computer|\bpc\b|tech|it\b|laptop|repair|geek)/i,
  'tech support':   /(tech|\bit\b|computer|support|network|geek)/i,
  'interior designer':/(interior|design|decor|home|stag)/i,
  'home staging':   /(stag|design|interior|home|real estate)/i,
  'solar installer':/(solar|energy|panel|photovolt|renewable)/i,
  'window tinting': /(tint|window|auto|film|glass)/i,
  'wedding planner':/(wedding|event|planner|bridal|celebrat)/i,
  'event planner':  /(event|planner|party|celebrat|wedding)/i,
};

function ypPlausible(serviceType: string, name: string, category: string): boolean {
  const kw = YP_TYPE_KEYWORDS[serviceType.toLowerCase()];
  if (!kw) return true; // no profile → can't disprove; accept
  const hay = `${name} ${category}`;
  return kw.test(hay);
}

// BLOCK-PAGE DETECTION — YellowPages serves an anti-bot / block / empty page to
// datacenter IPs (Supabase edge egress). A blocked fetch (403/429/503, an empty
// body, or an HTML body that contains ZERO listing structure AND a known block
// marker) is NOT "0 results" — it must NOT be masked as delivered-0. We surface
// it: the job is stamped 'failed' with a 'yp-blocked' note so the queue is not
// silently drained and the watchdog/health-check can see the real reason.
const YP_BLOCK_MARKERS = /(access denied|captcha|are you a human|verify you are|unusual traffic|px-captcha|perimeterx|distil|cloudflare|request unsuccessful|reference #|bot detection|blocked)/i;
function ypLooksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const body = (html || '').trim();
  if (body.length < 1000) return true; // real YP results page is ~1.5–2.5 MB; a tiny body = block/empty
  // A body with a block marker AND no listing structure is a block page, not results.
  const hasListingStructure = /application\/ld\+json|business-name/i.test(body);
  if (!hasListingStructure && YP_BLOCK_MARKERS.test(body.slice(0, 20000))) return true;
  return false;
}

// ── Google Places ACCOUNT-STATE error (billing off / key denied / over quota) ──
// Typed so the job loop can tell "Google's account is down" (re-queue the job,
// switch the whole run to the free OSM source) apart from "this job is bad"
// (stamp it failed). Conflating the two burned the queue at 1,200 jobs/hr.
class PlacesInfraError extends Error {
  constructor(msg: string) { super(msg); this.name = 'PlacesInfraError'; }
}

// ── FREE, KEYLESS SERVICES SOURCE: OpenStreetMap via Overpass ─────────────────
// Constitution law: free-first. Google Places needs a billing account; Overpass
// needs nothing — no key, no card, no quota approval. Coverage is thinner than
// Google for mobile providers, but it is NON-ZERO and it cannot be switched off
// by an account state, so the crawl always has a floor. Rows land in the same
// leads_services bucket with data_source='osm' (so their origin is auditable)
// and, unlike some Places rows, they ALWAYS carry lat/lon → they are immediately
// visible to services_near (historic failure #9: NULL lat/lng = invisible).
// Public Overpass endpoints, tried in order with a mirror fallback. Both are free
// and keyless. overpass-api.de is the reference instance; kumi.systems is a fast
// community mirror; osm.ch (Switzerland) is a third public fallback added so a
// simultaneous overload of the first two (both 504’d together 2026-08-01T07:00Z,
// flipping org_health=down) still has a live slot to try. If one rate-limits/times
// out we back off and try the next (Overpass etiquette: ≤2 concurrent slots, short
// cooldowns on 429/504).
const OSM_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
// A descriptive User-Agent is REQUIRED etiquette on the public Overpass API (an
// anonymous UA gets throttled/blocked first). Identifies the app + a contact.
const OSM_UA = 'CergioServicesCrawl/1.0 (+https://cergio.ai; contact: t@cergio.ai)';
const OSM_MAX_RESULTS = 100;   // TURBO (SPEC-99): 50 -> 100 (still Overpass-polite)        // hard cap per job (Overpass etiquette + write budget)
const OSM_HTTP_TIMEOUT_MS = 90_000; // Overpass can be slow under load; generous but bounded
const OSM_POLITE_DELAY_MS = 1_000;  // small pause before each query so we never hammer a slot

// ── Overpass BLOCK / rate-limit / timeout — TRANSIENT, must be SURFACED ────────
// Typed so the job loop can tell "Overpass is momentarily unavailable" (re-queue
// the job, log the run 'error' with the reason in agent_runs.meta) apart from a
// genuine "no such providers here" (valid JSON, 0 elements → honest delivered-0).
// SPEC-72: a block/empty/error response is NEVER masked as delivered-0.
class OverpassBlockedError extends Error {
  constructor(public reason: string) { super(`osm-blocked: ${reason}`); this.name = 'OverpassBlockedError'; }
}

// Detect a blocked / rate-limited / timed-out / empty Overpass response. Mirrors
// ypLooksBlocked's contract: HTTP status first, then body shape. A valid Overpass
// answer is JSON that contains an "elements" array — anything else (a runtime-
// error page, a rate-limit notice, an empty body) is treated as blocked.
function osmLooksBlocked(status: number, body: string): boolean {
  if (status === 429 || status === 504 || status === 503 || status === 502 || status === 403) return true;
  const b = (body || '').trim();
  if (b.length === 0) return true; // empty body = gateway/slot drop
  if (/"elements"/.test(b)) return false; // a real result set — not blocked
  // Overpass emits a plain-text/HTML error (not JSON) on rate-limit / timeout.
  if (/rate_limited|too many requests|rate limit|runtime error|dispatch|please try again|gateway timeout|load too high/i.test(b)) return true;
  return false;
}

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }

// Fetch an Overpass query with retry + mirror fallback + polite backoff. Returns
// the parsed JSON and the endpoint that answered. Throws OverpassBlockedError only
// after BOTH endpoints (×2 attempts each) have failed — so a single slow slot does
// not fail a job, but a real outage is surfaced (not silently swallowed).
async function overpassFetch(body: string): Promise<{ json: any; endpoint: string }> {
  let lastReason = 'unknown';
  for (const endpoint of OSM_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await sleep(OSM_POLITE_DELAY_MS + Math.floor(Math.random() * 500));
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), msLeft(OSM_HTTP_TIMEOUT_MS));  // SPEC-172
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': OSM_UA,
            'Accept': 'application/json',
          },
          body: `data=${encodeURIComponent(body)}`,
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const text = await res.text();
        if (osmLooksBlocked(res.status, text)) {
          lastReason = `http=${res.status} bytes=${text.length} @${hostOf(endpoint)}`;
          await sleep(1500 + attempt * 2500 + Math.floor(Math.random() * 800)); // backoff on 429/504
          continue;
        }
        let json: any;
        try { json = JSON.parse(text); }
        catch { lastReason = `non-json response @${hostOf(endpoint)}`; await sleep(1200); continue; }
        return { json, endpoint };
      } catch (e) {
        // Network error / abort (timeout). serr() (never String(e)) keeps the loop
        // from going blind (SPEC-73). Back off, then try the next attempt/mirror.
        lastReason = `fetch-error: ${serr(e)} @${hostOf(endpoint)}`;
        await sleep(1200 + attempt * 1500);
      }
    }
  }
  throw new OverpassBlockedError(lastReason);
}

// On-demand requests carry the taxonomy provider_type (e.g. "Plumber", "House
// Cleaner", "Hairstylist"); the bulk seeder + OSM_TAGS use the lowercase service_
// type keys ("plumber", "house cleaning", "hair stylist"). Normalize the former to
// the latter so an on-demand crawl resolves the SAME OSM tags as the bulk matrix.
const OSM_TYPE_ALIAS: Record<string, string> = {
  'house cleaner':    'house cleaning',
  'housekeeper':      'house cleaning',
  'hairstylist':      'hair stylist',
  'hvac technician':  'hvac',
  'nail tech':        'nail technician',
  'pet groomer':      'dog grooming',
  'pet sitter':       'pet sitting',
  'gardener':         'landscaping',
  'landscaper':       'landscaping',
  'pool cleaner':     'pool cleaning',
  'music teacher':    'music teacher',
};

// BLOCKED categories — SECOND safety net at OSM parse time (the seeder never
// enqueues these, but an on-demand request or an ambiguous OSM tag could surface
// one). Word-bounded where a bare token would false-match. Mirrors YP_BLOCKED.
const OSM_BLOCKED = new RegExp(
  '(massage|tattoo|makeup|\\bpersonal chef\\b|private chef' +
  '|plastic surgery|cosmetic surgery|\\bsurgeon\\b' +
  '|\\bdrug\\b|pharmac|cannabis|dispensary|marijuana' +
  '|liquor|\\bwine\\b|brewery|winery|distillery|\\bwine bar\\b|cocktail bar' +
  '|tobacco|smoke shop|\\bvape\\b|\\bcigar\\b' +
  '|casino|gambling|\\bbetting\\b|firearm|\\bgun\\b|\\bammo\\b' +
  '|\\bescort\\b|strip club|nightclub|night club|disc jockey|\\bdj\\b)',
  'i',
);
function osmIsBlocked(s: string): boolean { return OSM_BLOCKED.test(s || ''); }

// service_type → OSM tag selectors. Keys mirror crawl-seed-osm's SERVICE_TYPES.
// Cross-checked against the OSM wiki (Key:craft, Key:shop, Key:office, Key:amenity).
// Unmapped types fall back to a name-substring search so a new service type never
// silently yields zero.
const OSM_TAGS: Record<string, string[]> = {
  'plumber':            ['"craft"="plumber"', '"shop"="plumber"'],
  'electrician':        ['"craft"="electrician"'],
  'hvac':               ['"craft"="hvac"', '"craft"="heating_engineer"'],
  'handyman':           ['"craft"="handyman"'],
  'house cleaning':     ['"shop"="cleaning"', '"office"="cleaning"', '"craft"="cleaning"'],
  'maid service':       ['"shop"="cleaning"', '"office"="cleaning"'],
  'landscaping':        ['"craft"="gardener"', '"shop"="garden_centre"', '"landuse"="landscaping"'],
  'lawn care':          ['"craft"="gardener"'],
  'tree service':       ['"craft"="gardener"'], // no dedicated OSM tag; arborists map as gardener
  'pest control':       ['"craft"="pest_control"', '"shop"="pest_control"'],
  'mover':              ['"shop"="moving_company"', '"office"="moving_company"'],
  'junk removal':       ['"amenity"="waste_transfer_station"', '"shop"="scrap_yard"'],
  'painter':            ['"craft"="painter"'],
  'roofing':            ['"craft"="roofer"'],
  'flooring':           ['"craft"="floorer"', '"shop"="flooring"'],
  'window cleaning':    ['"shop"="cleaning"'], // window_construction = maker, not cleaner
  'pressure washing':   ['"shop"="cleaning"'],
  'gutter cleaning':    ['"craft"="roofer"'],
  'pool cleaning':      ['"craft"="pool_maintenance"', '"shop"="swimming_pool"'],
  'appliance repair':   ['"shop"="appliance"', '"craft"="electronics_repair"'],
  'locksmith':          ['"craft"="locksmith"', '"shop"="locksmith"'],
  'garage door repair': ['"craft"="door_construction"'],
  'fencing':            ['"craft"="fence_maker"'],
  'drywall':            ['"craft"="plasterer"'],
  'carpet cleaning':    ['"shop"="cleaning"'],
  'photographer':       ['"craft"="photographer"', '"shop"="photo"', '"shop"="photo_studio"'],
  'videographer':       ['"craft"="photographer"', '"shop"="video"'],
  'personal trainer':   ['"leisure"="fitness_centre"', '"sport"="fitness"'],
  'yoga instructor':    ['"sport"="yoga"'],
  'pilates instructor': ['"sport"="pilates"'],
  'nutrition coach':    ['"healthcare"="nutrition_counselling"', '"shop"="nutrition_supplements"'],
  'hair stylist':       ['"shop"="hairdresser"'],
  'barber':             ['"shop"="hairdresser"'],
  'nail technician':    ['"shop"="nails"', '"beauty"="nails"'],
  'lash technician':    ['"shop"="beauty"'],
  'dog walker':         ['"shop"="pet_grooming"', '"amenity"="animal_boarding"'],
  'dog grooming':       ['"shop"="pet_grooming"'],
  'pet sitting':        ['"amenity"="animal_boarding"'],
  'mobile mechanic':    ['"shop"="car_repair"'],
  'auto detailing':     ['"amenity"="car_wash"'],
  'car wash':           ['"amenity"="car_wash"'],
  'tutor':              ['"amenity"="prep_school"', '"office"="educational_institution"'],
  'music teacher':      ['"amenity"="music_school"'],
  'bookkeeping':        ['"office"="accountant"', '"shop"="accountant"'],
  'tax preparation':    ['"office"="tax_advisor"', '"office"="accountant"'],
  'computer repair':    ['"shop"="computer"', '"craft"="electronics_repair"'],
  'tech support':       ['"shop"="computer"', '"office"="it"'],
  'interior designer':  ['"shop"="interior_decoration"', '"office"="interior_design"'],
  'home staging':       ['"shop"="interior_decoration"'],
  'solar installer':    ['"craft"="solar"', '"shop"="solar"'],
  'window tinting':     ['"shop"="car_repair"'],
  'wedding planner':    ['"shop"="wedding"', '"office"="event_management"'],
  'event planner':      ['"office"="event_management"', '"shop"="party"'],
};

// USPS code → full state name. REQUIRED: a bare area["name"="Miami"] in Overpass
// also matches Miami, QUEENSLAND, AUSTRALIA — verified live 2026-07-14 (returned
// +61 phone numbers at lat −28). Every city area must be nested inside its US
// state area, and every row re-checked against the continental-US bbox below.
const US_STATES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',
  IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',
  NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',
  NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',
  RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',
  VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};
// Continental US + AK/HI bbox — a belt-and-braces guard so a geo-ambiguous OSM
// area can never land a foreign business in leads_services.
function inUS(lat: number, lon: number): boolean {
  return lat >= 18 && lat <= 72 && lon >= -180 && lon <= -66;
}

async function fulfillOverpass(db: any, job: any): Promise<{ saved: number; found: number; query: string; endpoint?: string }> {
  const rawType = (job.service_type || '').toLowerCase().trim();
  const type    = OSM_TYPE_ALIAS[rawType] ?? rawType; // provider_type → seeder key
  const city    = (job.city || '').trim();
  const state   = (job.state || '').trim();
  const jlat    = job.lat != null ? Number(job.lat) : null;
  const jlon    = job.lng != null ? Number(job.lng) : null; // crawl_requests uses `lng`
  const want    = OSM_MAX_RESULTS;   // MAX allowed under Overpass etiquette (guarded at 100)
  const query   = `${type || 'local service'} in ${[city, state].filter(Boolean).join(', ')} [osm]`;
  if (!city && !(jlat != null && jlon != null)) return { saved: 0, found: 0, query };

  // BLOCKED category never crawled: if the requested type is off-limits (massage/
  // tattoo/makeup/personal chef + SHAFT), refuse the whole job at parse time — no
  // Overpass call, no rows. (First net is the seeder; this is defense in depth.)
  if (osmIsBlocked(type) || osmIsBlocked(rawType)) return { saved: 0, found: 0, query };

  const selectors = OSM_TAGS[type] ?? [`"name"~"${type.replace(/[^a-z ]/gi, '')}",i`];

  // Two scoping strategies. On-demand requests carry lat/lng → a BBOX around the
  // point (robust anywhere, no area-name ambiguity). Bulk city jobs have no point
  // → the city area nested inside its US state area (admin_level 4). EITHER way the
  // hard geo guarantee is the inUS() bbox re-check on every row below (Overpass has
  // let "Miami, QUEENSLAND" through — verified live 2026-07-14). Do not remove it.
  let body: string;
  if (jlat != null && jlon != null && inUS(jlat, jlon)) {
    // ~25mi box: ~0.36° lat; lon scaled by cos(lat) so the box isn't skewed.
    const dLat = 0.36;
    const dLon = 0.36 / Math.max(0.2, Math.cos((jlat * Math.PI) / 180));
    const s = (jlat - dLat).toFixed(4), n = (jlat + dLat).toFixed(4);
    const w = (jlon - dLon).toFixed(4), e = (jlon + dLon).toFixed(4);
    body = `[out:json][timeout:60];\n(${selectors.map((sel) => `  nwr(${s},${w},${n},${e})[${sel}];`).join('\n')}\n);\nout center ${OSM_MAX_RESULTS};`;
  } else {
    const stateName = US_STATES[state.toUpperCase()];
    if (!stateName) return { saved: 0, found: 0, query }; // unknown state, no point → refuse to guess
    body = `[out:json][timeout:60];\narea["name"="${stateName}"]["admin_level"="4"]->.s;\narea(area.s)["name"="${city.replace(/"/g, '')}"]["boundary"="administrative"]->.a;\n(${selectors.map((sel) => `  nwr(area.a)[${sel}];`).join('\n')}\n);\nout center ${OSM_MAX_RESULTS};`;
  }

  // overpassFetch retries + falls back to the mirror + backs off on 429/504, and
  // THROWS OverpassBlockedError if every endpoint fails. That error is caught by
  // the job loop → the job is re-queued (transient) and the run is logged 'error'
  // with the reason in agent_runs.meta.osm_blocked — NEVER a masked delivered-0.
  const { json: j, endpoint } = await overpassFetch(body);
  const els: any[] = (j.elements || []).filter((el: any) => el?.tags?.name);

  let saved = 0;
  const seen = new Set<string>();      // in-job dedupe: osm_id AND normalized name+city
  for (const el of els) {
    if (saved >= want) break;
    const t = el.tags || {};
    const name = cleanText(t.name);
    if (!name) continue;

    // BLOCKED category never surfaces: drop a row whose name or OSM tag lands in a
    // blocked vertical (e.g. an ad/adjacent "massage"/"tattoo" node).
    const tagText = `${t.shop || ''} ${t.craft || ''} ${t.office || ''} ${t.amenity || ''} ${t.leisure || ''}`;
    if (osmIsBlocked(`${name} ${tagText}`)) continue;
    // name↔service_type plausibility: reject an off-topic node (reuses the shared
    // keyword profiles; types with no profile can't be disproved → accepted).
    if (!ypPlausible(rawType, name, tagText)) continue;

    const osmId = `${el.type}/${el.id}`;
    const nameKey = `${name.toLowerCase()}|${(t['addr:city'] || city).toLowerCase()}`;
    if (seen.has(osmId) || seen.has(nameKey)) continue;
    seen.add(osmId); seen.add(nameKey);

    const phone   = normPhone(t.phone || t['contact:phone'] || '');
    const website = pickWebsite(t.website || t['contact:website'] || null);
    const ig      = t['contact:instagram'] || t['instagram'] || null;
    const lat     = el.lat ?? el.center?.lat ?? null;
    const lon     = el.lon ?? el.center?.lon ?? null;
    // A row with no lat/lon is invisible to services_near — don't write it
    // (historic failure #9). And a row outside the US is a geo-ambiguity bug, not
    // a lead — drop it rather than poison the sendable pool.
    if (lat == null || lon == null || !inUS(Number(lat), Number(lon))) continue;

    const email = website ? await scrapeEmail(website) : null;
    const addr  = [t['addr:housenumber'], t['addr:street'], t['addr:city'] || city, t['addr:state'] || state]
      .filter(Boolean).join(' ').trim() || null;

    const row = {
      id: `osm:${osmId}`,        // primary key / dedupe (upsert onConflict id)
      osm_id: osmId,             // write-contract column (auditable OSM provenance)
      name,
      service_type: job.service_type || null,
      phone, phone_origin: phone ? 'osm' : null,
      website_url: website,
      owner_email: email,
      instagram: ig,
      has_instagram: !!ig,
      address: addr,
      city: t['addr:city'] || city || null,
      state: state || (t['addr:state'] || null),
      lat, lon,
      data_source: 'osm',
      fetched_at: new Date().toISOString(),
      outreach_status: 'new', // raw/ungraded — the gate promotes mobile→'queued'
      outreach_notes: `auto-sourced via OpenStreetMap (${city || 'geo'}) ${new Date().toISOString().slice(0, 10)}`,
    };
    await bufUpsert(db, row); const upErr = null;
    if (!upErr) saved++;
  }
  return { saved, found: els.length, query, endpoint: hostOf(endpoint) };
}

class YpBlockedError extends Error {
  constructor(public reason: string) { super(`yp-blocked: ${reason}`); this.name = 'YpBlockedError'; }
}

async function fulfillYellowPages(db: any, job: any): Promise<{ saved: number; found: number; query: string }> {
  const type = String(job.service_type || 'local service');
  const city = String(job.city || '');
  const state = String(job.state || '');
  const want = Number(Deno.env.get('LSA_MAX') || '1000');   // MAX: take every local_ad SerpAPI returns
  const query = `${type} in ${[city, state].filter(Boolean).join(', ') || 'United States'} (YellowPages)`;

  const pages = Math.max(1, Math.ceil(want / YP_RESULTS_PER_PAGE));
  const seenIds = new Set<string>();
  let saved = 0, found = 0;

  for (let page = 1; page <= pages; page++) {
    const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(type)}&geo_location_terms=${encodeURIComponent(`${city}, ${state}`)}${page > 1 ? `&page=${page}` : ''}`;
    // Polite jitter between fetches to avoid IP bans.
    if (page > 1) await sleep(YP_FETCH_JITTER_MS + Math.floor(Math.random() * YP_FETCH_JITTER_MS));

    let html = '';
    let httpStatus = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': YP_UA, 'Accept': 'text/html' } });
      clearTimeout(t);
      httpStatus = res.status;
      // BOUND the page against a pathological/unbounded response (OOM → HTTP 546),
      // but the cap MUST clear a full real YP results page. A live plumber/Miami
      // page is ~1.5–2.5 MB and the schema.org JSON-LD listing block is emitted
      // LATE in the document — a tight 600 KB cap sliced that block (and the tail
      // result cards) clean off, so parse yielded 0 listings and every job stamped
      // delivered-with-0 (raw_found 0 / rows_written 0). 4 MB holds a full page
      // with headroom while still bounding memory in the Deno isolate.
      // NOTE: read the body even on !res.ok so block detection can inspect it.
      html = (await res.text()).slice(0, YP_MAX_PAGE_BYTES);
    } catch {
      // A network error / abort on page 1 is indistinguishable from a block at the
      // egress → surface it, don't mask. On a later page it just ends pagination.
      if (page === 1) throw new YpBlockedError('fetch-error');
      break;
    }

    // BLOCK DETECTION (page 1 only — if the first page is a block page the whole
    // job is blocked; a later blocked/empty page just ends pagination for a job
    // that already produced rows). On block: surface, never mask as delivered-0.
    if (page === 1 && ypLooksBlocked(httpStatus, html)) {
      throw new YpBlockedError(`http=${httpStatus} bytes=${(html || '').length}`);
    }
    if (!(httpStatus >= 200 && httpStatus < 300)) break; // non-2xx on a later page → stop

    // PER-PAGE PARSE GUARD: a single malformed page (bad JSON-LD, pathological
    // markup, regex edge case) must never crash the whole run. Isolate the parse
    // + processing of THIS page; on any error, skip to the next page.
    let listings: YpListing[] = [];
    try {
      listings = parseYellowPages(html);
    } catch (_e) {
      continue; // bad page → try the next page rather than 546 the function
    }
    if (listings.length === 0) break; // no more results / structure changed
    found += listings.length;

    for (const b of listings) {
      if (saved >= want) break;
      if (!b.name) continue;

      // Safety net 2: never ingest a blocked category.
      if (YP_BLOCKED.test(`${type} ${b.name} ${b.category || ''}`)) continue;
      // Plausibility: reject name↔service_type mismatches (restaurant-as-plumber).
      if (!ypPlausible(type, b.name, b.category || '')) continue;

      // Stable dedupe id (YP has no place_id): normalized name+city+state+type.
      const id = `yp:${slug(`${b.name}|${city}|${state}|${type}`)}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      let email: string | null = null;
      if (b.website) { try { email = await scrapeEmail(b.website); } catch { /* best-effort */ } }

      const row = {
        id,
        name: b.name,
        service_type: type,
        phone: b.phone,
        phone_origin: b.phone ? 'yellowpages' : null,
        website_url: b.website,
        owner_email: email,
        address: b.address,
        city: city || null,
        state: state || 'FL',
        lat: null,
        lon: null,
        data_source: 'yellowpages',
        fetched_at: new Date().toISOString(),
        outreach_status: 'new', // raw/ungraded — the gate promotes mobile→'queued'; never auto-sent
        outreach_notes: `auto-sourced via YellowPages (${city || '?'}) ${new Date().toISOString().slice(0, 10)}`,
      };
      await bufUpsert(db, row); const upErr = null;
      if (!upErr) saved++;
    }
    if (saved >= want) break;
  }

  return { saved, found, query };
}

type YpListing = { name: string | null; phone: string | null; address: string | null; website: string | null; category: string | null };

// Parse a YellowPages search-results HTML page. Two strategies, both regex-based
// (Deno edge has no DOM): (1) JSON-LD blocks YP embeds per listing (most robust —
// survives class renames); (2) HTML class fallback for the classic markup. We
// merge/dedupe by name so a listing found by either path counts once.
function parseYellowPages(html: string): YpListing[] {
  try {
    return parseYellowPagesInner(html);
  } catch (_e) {
    // Final safety net: any unexpected parse error yields "no listings" for this
    // page instead of throwing up the stack (which was crashing the isolate → 546).
    return [];
  }
}

function parseYellowPagesInner(html: string): YpListing[] {
  const out: YpListing[] = [];
  const byName = new Map<string, YpListing>();

  const add = (l: YpListing) => {
    if (!l.name) return;
    const key = l.name.trim().toLowerCase();
    const prev = byName.get(key);
    if (!prev) { byName.set(key, l); out.push(l); return; }
    // Merge missing fields from the second sighting.
    prev.phone   = prev.phone   || l.phone;
    prev.address = prev.address || l.address;
    prev.website = prev.website || l.website;
    prev.category = prev.category || l.category;
  };

  // ── Strategy 1: JSON-LD (LocalBusiness / Organization) ─────────────────────
  const ldMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldMatches) {
    const jsonText = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch { continue; }
    // GUARD: a ld+json block can legally be a primitive/null/array. Accessing
    // parsed['@graph'] on null/undefined throws → previously this uncaught
    // TypeError crashed the whole run (HTTP 546). Only object graphs have @graph.
    if (parsed === null || typeof parsed !== 'object') continue;
    const nodes: any[] = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const t = n['@type'];
      const types = Array.isArray(t) ? t : [t];
      const isBiz = types.some((x) => typeof x === 'string' && /(LocalBusiness|Organization|Store|ProfessionalService|HomeAndConstructionBusiness)/i.test(x));
      if (!isBiz || !n.name) continue;
      const addr = n.address && typeof n.address === 'object'
        ? [n.address.streetAddress, n.address.addressLocality, n.address.addressRegion, n.address.postalCode].filter(Boolean).join(', ')
        : (typeof n.address === 'string' ? n.address : null);
      add({
        name: cleanText(String(n.name)),
        phone: n.telephone ? normPhone(String(n.telephone)) : null,
        address: addr ? cleanText(addr) : null,
        website: pickWebsite(n.url),
        category: null,
      });
    }
  }

  // ── Strategy 2: classic HTML result cards ──────────────────────────────────
  // Split the page into result blocks, then pull each field with tolerant regex.
  const cards = html.split(/<div\s+class=["']result[\s"']/i).slice(1);
  for (const raw of cards) {
    const card = raw.slice(0, 6000); // bound the block
    const name = firstMatch(card, [
      /class=["']business-name["'][^>]*>(?:\s*<span[^>]*>)?\s*([^<]{2,120})/i,
      /<a[^>]*class=["'][^"']*business-name[^"']*["'][^>]*>\s*(?:<[^>]+>)?\s*([^<]{2,120})/i,
    ]);
    if (!name) continue;
    const phone = firstMatch(card, [
      /class=["']phones?[^"']*["'][^>]*>\s*([0-9()+\-.\s]{7,20})/i,
      /class=["'][^"']*phone[^"']*["'][^>]*>\s*([0-9()+\-.\s]{7,20})/i,
    ]);
    const street = firstMatch(card, [
      /class=["']street-address["'][^>]*>\s*([^<]{3,120})/i,
    ]);
    const locality = firstMatch(card, [
      /class=["']locality["'][^>]*>\s*([^<]{2,80})/i,
    ]);
    const website = firstMatch(card, [
      /class=["'][^"']*track-visit-website[^"']*["'][^>]*href=["']([^"']+)["']/i,
      /href=["']([^"']+)["'][^>]*class=["'][^"']*track-visit-website/i,
    ]);
    const category = firstMatch(card, [
      /class=["']categories["'][^>]*>([\s\S]{0,200}?)<\/div>/i,
    ]);
    add({
      name: cleanText(name),
      phone: phone ? normPhone(phone) : null,
      address: cleanText([street, locality].filter(Boolean).join(', ')) || null,
      website: pickWebsite(website),
      category: category ? cleanText(category.replace(/<[^>]+>/g, ' ')) : null,
    });
  }

  return out;
}

function firstMatch(s: string, patterns: RegExp[]): string | null {
  for (const p of patterns) { const m = s.match(p); if (m && m[1]) return m[1]; }
  return null;
}
function cleanText(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}
function normPhone(s: string): string | null {
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 10) return null;
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(0, 10);
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
function pickWebsite(url: unknown): string | null {
  if (!url) return null;
  const u = Array.isArray(url) ? String(url[0] || '') : String(url);
  // Skip YP-internal links; only keep the business's own site.
  if (!/^https?:\/\//i.test(u)) return null;
  if (/yellowpages\.com|yextcdn|mip\/|\/listings\//i.test(u)) return null;
  return u;
}
function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9|]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// ── ENTITY CLASSIFIER (SPEC-88b): company vs individual, so we target each
// differently. Individual = the core mobile-provider target; company = Phase-2.
// Heuristic on the name — conservative, never fabricates, defaults to 'company'
// only on clear company signals; otherwise 'individual'.
function classifyEntity(name: string): 'company' | 'individual' {
  const n = (name || '').toLowerCase().trim();
  if (!n) return 'company';
  const companyRe = /\b(llc|l\.l\.c|inc|corp|co\b|company|group|solutions?|services?|systems?|associates|partners|enterprises?|contractors?|construction|plumbing|electric(al)?|hvac|roofing|landscaping|cleaners?|cleaning|movers?|moving|salon|studio|spa|clinic|academy|agency|pros?|experts?|masters?|brothers|bros|sons|&)\b/i;
  if (companyRe.test(n)) return 'company';
  if (/[0-9]/.test(n)) return 'company';           // "5 Star ..." etc.
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length <= 3 && words.every((w) => /^[a-z'.-]+$/i.test(w))) return 'individual';
  return 'company';
}

// ── Yelp Fusion search → leads_services. Reuses inUS/normPhone/cleanText.
async function fulfillYelp(db: any, job: any): Promise<{ saved: number; found: number; query: string; note?: string }> {
  const KEY = Deno.env.get('YELP_API_KEY');
  _lastYelpError = null;
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const query = `${rawType || 'service'} in ${[city, state].filter(Boolean).join(', ')} [yelp]`;
  if (!KEY) { _lastYelpError = 'pending YELP_API_KEY (secret not set on the product project)'; return { saved: 0, found: 0, query, note: _lastYelpError }; }
  if (!city) return { saved: 0, found: 0, query };
  if (osmIsBlocked(rawType)) return { saved: 0, found: 0, query };

  const want = 240;   // MAX: Yelp Fusion caps offset at 240 — this IS the API ceiling
  // SPEC-180: SPEC-170 metro normalisation reached craigslist/YP/LSA but never yelp.
  const loc = [metroOf(city), METRO_STATE[metroOf(city)] || state].filter(Boolean).join(', ');
  let saved = 0, found = 0;
  const seen = new Set<string>();
  for (let offset = 0; offset < want && offset < 240; offset += 50) {   // yelp API caps offset at 240
    const url = `https://api.yelp.com/v3/businesses/search?location=${encodeURIComponent(loc)}`
      + `&term=${encodeURIComponent(rawType)}&limit=${Math.min(50, 240 - offset)}&offset=${offset}&sort_by=best_match`;
    let j: any;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
      // SPEC-180: Yelp caps this endpoint at 240, so offset=200&limit=50 asked for 250,
      // returned HTTP 400, and that error OVERWROTE the note of a run that had already
      // saved 200 rows. A last-page error must not erase a partial success.
      if (!res.ok) { _lastYelpError = `yelp http ${res.status} at offset=${offset}`;
                     return { saved, found, query, note: saved > 0 ? undefined : _lastYelpError }; }
      j = await res.json();
    } catch (e) { return { saved, found, query, note: `yelp fetch ${String(e).slice(0,60)}` }; }
    const list: any[] = j?.businesses || [];
    found += list.length;
    if (!list.length) break;
    for (const b of list) {
      if (saved >= want) break;
      if (b?.is_closed) continue;
      const name = cleanText(b?.name);
      if (!name) continue;
      const cats = (b?.categories || []).map((c: any) => c?.title).filter(Boolean).join(', ');
      if (osmIsBlocked(`${name} ${cats}`)) continue;
      const lat = b?.coordinates?.latitude ?? null;
      const lon = b?.coordinates?.longitude ?? null;
      if (lat == null || lon == null || !inUS(Number(lat), Number(lon))) continue; // geo guard
      const yid = String(b?.id || '');
      const nameKey = `${name.toLowerCase()}|${(b?.location?.city || city).toLowerCase()}`;
      if (!yid || seen.has(yid) || seen.has(nameKey)) continue;
      seen.add(yid); seen.add(nameKey);
      const phone = normPhone(b?.phone || b?.display_phone || '');
      const addr = (b?.location?.display_address || []).join(', ') || null;
      const entity = classifyEntity(name);
      const row = {
        id: `yelp:${yid}`,
        name,
        service_type: job.service_type || null,
        phone, phone_origin: phone ? 'yelp' : null,
        website_url: null,           // not in search endpoint; enrich later
        owner_email: null,           // Yelp API exposes no email — never fabricate
        yelp_url: b?.url || null,
        instagram: null, has_instagram: false,
        address: addr,
        city: b?.location?.city || city || null,
        state: b?.location?.state || state || null,
        zip: b?.location?.zip_code || null,
        lat, lon,
        data_source: 'yelp',
        fetched_at: new Date().toISOString(),
        outreach_status: 'new',
        outreach_notes: `yelp | ${entity} | ${cats}`.slice(0, 240),
      };
      await bufUpsert(db, row); const upErr = null;
      if (!upErr) saved++;
    }
    if (list.length < 50) break;
  }
  return { saved, found, query };
}

// ── Google Sponsored + local pack via SerpAPI. Reuses inUS/normPhone/cleanText/
// classifyEntity/scrapeEmail/scrapePhone. Free-tier friendly: ONE search per job.
async function fulfillGoogleSponsored(db: any, job: any): Promise<{ saved: number; found: number; query: string; note?: string }> {
  const KEY = Deno.env.get('SERPAPI_KEY');
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const query = `${rawType || 'service'} in ${[city, state].filter(Boolean).join(', ')} [google_sponsored]`;
  if (!KEY) return { saved: 0, found: 0, query, note: 'pending SERPAPI_KEY' };
  if (!city) return { saved: 0, found: 0, query };
  if (osmIsBlocked(rawType)) return { saved: 0, found: 0, query };

  const stateName = US_STATES[state.toUpperCase()] || state;
  const location = [city, stateName, 'United States'].filter(Boolean).join(', ');
  const url = `https://serpapi.com/search.json?engine=google`
    + `&q=${encodeURIComponent(rawType + ' ' + city)}`
    + `&location=${encodeURIComponent(location)}&google_domain=google.com&gl=us&hl=en&num=20`
    + `&api_key=${KEY}`;
  let j: any;
  try {
    const res = await fetch(url);
    if (!res.ok) return { saved: 0, found: 0, query, note: `serpapi http ${res.status}` };
    j = await res.json();
  } catch (e) { return { saved: 0, found: 0, query, note: `serpapi fetch ${String(e).slice(0,60)}` }; }
  if (j?.error) return { saved: 0, found: 0, query, note: `serpapi ${String(j.error).slice(0,80)}` };

  let saved = 0, found = 0, fetches = 0;
  const seen = new Set<string>();
  const persist = async (row: Record<string, unknown>) => {
    await bufUpsert(db, row); const error = null;
    if (!error) saved++;
  };

  // A) Sponsored ADS — advertisers. Phone from the ad's OWN landing page (bounded).
  for (const ad of (j.ads || [])) {
    found++;
    const name = cleanText(ad?.title);
    if (!name) continue;
    if (osmIsBlocked(name)) continue;
    const site = ad?.link || ad?.displayed_link || null;
    const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
    if (seen.has(key)) continue; seen.add(key);
    let phone = null, email = null;
    if (site && fetches < 12) { fetches++; phone = await scrapePhone(site); email = await scrapeEmail(site); }
    await persist({
      id: `gsp:${city}:${(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,60)}`,
      name, service_type: job.service_type || null,
      phone, phone_origin: phone ? 'google_sponsored_site' : null,
      website_url: site, owner_email: email,
      instagram: null, has_instagram: false,
      address: null, city, state: state || null, zip: null,
      lat: null, lon: null,                       // ads carry no coords — outreach lead, not a map pin
      data_source: 'google_sponsored', fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `google_sponsored | ${classifyEntity(name)} | ${(ad?.displayed_link||'')}`.slice(0,240),
    });
  }

  // B) LOCAL PACK — map results with a real phone + coords. Tagged google_local.
  const places = j?.local_results?.places || j?.local_results || [];
  for (const pl of (Array.isArray(places) ? places : [])) {
    found++;
    const name = cleanText(pl?.title);
    if (!name) continue;
    if (osmIsBlocked(`${name} ${pl?.type||''}`)) continue;
    const lat = pl?.gps_coordinates?.latitude ?? null;
    const lon = pl?.gps_coordinates?.longitude ?? null;
    if (lat != null && lon != null && !inUS(Number(lat), Number(lon))) continue; // geo guard when coords exist
    const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
    if (seen.has(key)) continue; seen.add(key);
    await persist({
      id: `glo:${pl?.place_id || (name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,60)}`,
      name, service_type: job.service_type || null,
      phone: normPhone(pl?.phone || ''), phone_origin: pl?.phone ? 'google_local' : null,
      website_url: pl?.links?.website || null, owner_email: null,
      instagram: null, has_instagram: false,
      address: pl?.address || null, city, state: state || null, zip: null,
      lat, lon, data_source: 'google_local', fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `google_local | ${classifyEntity(name)} | ${(pl?.type||'')}`.slice(0,240),
    });
  }
  return { saved, found, query };
}

// City -> Google CID (data_cid) for the Local Services engine. NYC from SerpAPI
// docs; others resolved at runtime via google_maps and cached in-process.
const CITY_CID: Record<string, string> = { 'new york': '14414772292044717666' };

// SPEC-170 — google_lsa/google_sponsored produced ZERO rows for a whole day, and
// the only thing they ever said was "no data_cid for city". Two causes, both here:
//
//  1. WE SEED BOROUGHS AND NEIGHBOURHOODS, NOT METROS. The queue is Manhattan,
//     Brooklyn, Queens, Bronx, Staten Island, Brickell, Wynwood, Doral, Coral
//     Gables, Miami Beach. Google Local Services Ads are sold at METRO level, so
//     asking for a CID for "Wynwood FL" legitimately returns nothing — the ads
//     exist, we were asking with the wrong key. Every seeded location now maps to
//     its metro before the lookup, which is also correct behaviour: an LSA pro in
//     Wynwood IS a Miami LSA pro.
//  2. THE RESOLVER SWALLOWED ITS OWN ERRORS (`catch { /* ignore */ }`), so a bad
//     key, a quota block or an HTTP 5xx was indistinguishable from "this city has
//     no ads". That is what made it look like an empty market for a full day.
const METRO_OF: Record<string, string> = {
  'manhattan': 'New York', 'brooklyn': 'New York', 'queens': 'New York',
  'bronx': 'New York', 'staten island': 'New York', 'new york': 'New York',
  'miami beach': 'Miami', 'brickell': 'Miami', 'wynwood': 'Miami',
  'coral gables': 'Miami', 'doral': 'Miami', 'miami': 'Miami',
};
const METRO_STATE: Record<string, string> = { 'New York': 'NY', 'Miami': 'FL' };

// SPEC-170b — THE UNIFYING ROOT CAUSE of six silent sources. We seed at
// NEIGHBOURHOOD level (Manhattan, Brooklyn, Queens, Bronx, Staten Island,
// Brickell, Wynwood, Coral Gables, Doral, Miami Beach) because that is how the
// product thinks about coverage. But every non-OSM source is METRO level:
// craigslist has newyork./miami. subdomains and no borough subdomains at all,
// Google Local Services Ads are sold per metro, YellowPages indexes by metro.
// OSM was the only source that worked BECAUSE Overpass geocodes any place name.
// So 10 of our 12 cities could never match, and the failure was silent — e.g.
// craigslist returned 'no craigslist subdomain' before making a single request.
// Normalising to the metro is not a widening of scope: a plumber in Wynwood IS a
// Miami plumber, and Craigslist/LSA/YP have always filed them that way.
function metroOf(city: string): string {
  return METRO_OF[(city || '').toLowerCase().trim()] || city;
}

async function resolveCid(KEY: string, city: string, state: string): Promise<string | null> {
  const metro = METRO_OF[city.toLowerCase().trim()] || city;
  const k = metro.toLowerCase();
  if (CITY_CID[k]) return CITY_CID[k];
  const st = METRO_STATE[metro] || state;
  try {
    const u = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(metro + ' ' + st)}&type=search&api_key=${KEY}`;
    const res = await fetch(u);
    if (!res.ok) {
      _lastSerpError = `SerpAPI CID lookup HTTP ${res.status} for ${metro}, ${st} — key/quota problem, NOT an empty market`;
      return null;
    }
    const j = await res.json();
    if (j?.error) { _lastSerpError = `SerpAPI: ${String(j.error).slice(0, 160)}`; return null; }
    const cid = (j?.local_results || []).map((r: any) => r?.data_cid).find((x: any) => x);
    if (cid) { CITY_CID[k] = String(cid); return String(cid); }
    _lastSerpError = `SerpAPI returned no data_cid for metro ${metro}, ${st} (local_results=${(j?.local_results || []).length})`;
  } catch (e) {
    _lastSerpError = `SerpAPI CID lookup threw for ${metro}: ${(e as Error)?.message || String(e)}`;
  }
  return null;
}
// Google Local Services Ads — the sponsored service pros (phone + badge).
// `provenance` lets the google_sponsored source reuse this PROVEN fetcher while
// keeping its own data_source tag (SPEC-105) — the founder's "Sponsored" spec IS
// Local Services Ads. Defaults to 'google_lsa' so existing callers are unchanged.
async function fulfillGoogleLSA(db: any, job: any, provenance = 'google_lsa'): Promise<{ saved: number; found: number; query: string; note?: string }> {
  const KEY = Deno.env.get('SERPAPI_KEY');
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const query = `${rawType} [${provenance} ${city}]`;
  if (!KEY) return { saved: 0, found: 0, query, note: 'pending SERPAPI_KEY' };
  if (!city || osmIsBlocked(rawType)) return { saved: 0, found: 0, query };
  const data_cid = await resolveCid(KEY, city, state);
  if (!data_cid) {
    // SPEC-168: this is the ONLY thing google_lsa/google_sponsored ever reported,
    // and it is a CONFIG gap, not "no ads exist": resolveCid could not map this
    // city to a Google CID. Say which city, so it is fixable instead of mysterious.
    _lastSerpError = `no data_cid resolved for ${city}, ${state} — SerpAPI CID lookup returned nothing (config gap, not an empty market)`;
    return { saved: 0, found: 0, query, note: _lastSerpError };
  }

  const url = `https://serpapi.com/search.json?engine=google_local_services`
    + `&q=${encodeURIComponent(rawType)}&data_cid=${data_cid}&hl=en&api_key=${KEY}`;
  let j: any;
  try {
    const res = await fetch(url);
    if (!res.ok) return { saved: 0, found: 0, query, note: `serpapi http ${res.status}` };
    j = await res.json();
  } catch (e) { return { saved: 0, found: 0, query, note: `serpapi fetch ${String(e).slice(0,60)}` }; }
  if (j?.error) return { saved: 0, found: 0, query, note: `serpapi ${String(j.error).slice(0,80)}` };

  const ads = j?.local_ads || [];
  let saved = 0, found = ads.length;
  const seen = new Set<string>();
  for (const a of ads) {
    const name = cleanText(a?.title);
    if (!name) continue;
    if (osmIsBlocked(`${name} ${a?.type||''}`)) continue;
    const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
    if (seen.has(key)) continue; seen.add(key);
    const phone = normPhone(a?.phone || '');
    const rev = a?.reviews != null ? `${a.rating||''}(${a.reviews}rev)` : '';
    const yrs = a?.years_in_business != null ? `${a.years_in_business}yr` : '';
    const row = {
      id: `glsa:${a?.cid || (name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,60)}:${city.toLowerCase().replace(/[^a-z]/g,'')}`,
      name, service_type: job.service_type || null,
      phone, phone_origin: phone ? provenance : null,
      website_url: a?.link || null, owner_email: null,
      instagram: null, has_instagram: false,
      address: a?.service_area || null, city, state: state || null, zip: null,
      lat: null, lon: null,
      data_source: provenance, fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `${provenance} | ${classifyEntity(name)} | ${a?.badge||''} | ${rev} ${yrs} | ${a?.type||''}`.slice(0,240),
    };
    await bufUpsert(db, row); const error = null;
    if (!error) saved++;
  }
  return { saved, found, query };
}

// Craigslist city -> subdomain
const CL_SUBDOMAIN: Record<string, string> = { 'new york': 'newyork', 'miami': 'miami' };
// Pull a likely first name from a Craigslist title/body ("Handyman - Jose", "Jessica\'s cleaning").
const NOT_A_NAME = /^(New|The|Best|Call|Text|Free|Now|Nyc|Miami|Cheap|Fast|Pro|Professional|Licensed|Insured|Affordable|Reliable|Quality|Expert|Experienced|Premium|Local|Certified|Trusted|Available|Special|Standard|Deep|Move|Apartment|Home|House|Housekeeping|Cleaning|Cleaner|Tutor|Tutoring|Math|Maths|Algebra|Geometry|Calculus|Statistics|Stats|Physics|Chemistry|Biology|Science|English|Spanish|French|Reading|Writing|Harvard|Yale|Princeton|Columbia|Ivy|Grad|Undergrad|Mba|Phd|Psat|Sat|Act|Gmat|Gre|Dog|Cat|Pet|Walking|Boarding|Sitting|Plumber|Plumbing|Electrician|Handyman|Barber|Photographer|Mover|Moving|Service|Services|Repair|Install|Emergency|Same|Day|Hour|Year|Years|Nyc|Manhattan|Brooklyn|Queens|Bronx|West|East|North|South|Upper|Lower)$/i;
function parseFirstName(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  let m = t.match(/(?:^|[-–,:|]|\bby\b|\bwith\b|\bcall\b|\bask for\b)\s*([A-Z][a-z]{2,15})(?:\b)/);
  if (m && !NOT_A_NAME.test(m[1])) return m[1];
  m = t.match(/\b([A-Z][a-z]{2,15})['\u2019]s\b/); // "Jessica\'s"
  if (m) return m[1];
  return null;
}
// Apify actor run (sync) with a hard maxItems cap so cost is bounded.
// SPEC-117. This used to return [] on EVERY failure — `if (!res.ok) return []`
// and `catch { return [] }` — so gmaps_apify burned 420 jobs producing 0 rows with
// no recorded reason and was auto-disabled as a "dead source". It was never dead:
// run-sync on compass~crawler-google-places takes minutes, and the abort timer
// below was 110s, so it was aborted every single time. Craigslist survives only
// because it is fast. Failures are now REPORTED, and the timeout is honest.
// SPEC-172: a HARD per-run deadline. The SPEC-169 pool awaits in-flight tasks, so
// one slow call (apify run-sync is allowed 140s, Overpass 90s) started near the
// budget edge would outlive the 150s platform limit — the run gets killed and the
// buffered rows are lost, which is exactly the SPEC-166 failure returning by a
// different door. Every outbound fetch now clamps its own timeout to the time
// ACTUALLY left, so no single call can push the run past the wall.
let _runDeadline = 0;
function msLeft(cap: number): number {
  const left = _runDeadline - Date.now();
  return Math.max(1000, Math.min(cap, left > 0 ? left : 1000));
}

let _lastFlushError: string | null = null;
let _lastCreatorError: string | null = null;   // SPEC-202
let _lastApifyError: string | null = null;
// SPEC-185: the ACTUAL dollars the last apify run cost, read back from Apify.
// Estimates are not good enough when the rule is "never spend $1 without output".
let _lastApifyCostUsd = 0;
let _lastNonApifyCostUsd = 0;   // SPEC-190: estimated cost for vendors with no usage API
// SPEC-168: apify already recorded WHY it returned nothing, but the caller threw it
// away and wrote a generic "no X results" — so seven sources reported 0 rows for
// eight hours with no recoverable reason, and I wrongly concluded they were dead
// and parked them. SerpAPI and Yelp had no error carrier at all. A source is not
// dead until its own error says so.
let _lastSerpError: string | null = null;
let _lastYelpError: string | null = null;
// SPEC-185 — PROVE OUTPUT BEFORE SPENDING THE NEXT DOLLAR.
// Apify cost $108.17 and delivered ZERO leads. The rule from here: a paid source
// gets a $1 tranche; it may not spend the next dollar until that dollar has
// produced leads. Allowance steps up only on PROVEN yield, so volume rises
// gradually and only where output is real.
// SPEC-190 — WHICH VENDOR BILLS FOR WHICH SOURCE. Founder caught this: the ledger
// metered ONLY Apify, so yelp and the two SerpAPI sources printed "$0 · FREE" in the
// spend report. They are not free — Yelp Fusion is a paid tier and SerpAPI bills per
// search. Worse than a wrong label: spendBlockedReason returned null for any source
// outside the Apify map ("free/non-apify source"), so yelp produced 7,803 leads with NO
// tranche gate at all. Only `osm` (Overpass) is genuinely free.
// SPEC-193 — ALL PAID CRAWLING GOES THROUGH APIFY (founder decision, restated
// 2026-08-01: "we decided to switch out serpapi with apify... all paid should be apify
// as it's most economical and/or best crawler"). I had left SerpAPI running and then
// reported it as free, which is how it survived. SerpAPI-backed sources are retired to
// the Apify Google-Maps extractor, which already proves the best cost per lead on the
// board (\$0.0018) and returns a phone for nearly every place — the thing SPEC-192
// requires. Yelp Fusion stays only while its key is present; it is not re-enabled.
const VENDOR_OF_SOURCE: Record<string, 'apify' | 'yelp' | 'free'> = {
  craigslist: 'apify', yellowpages_apify: 'apify', gmaps_apify: 'apify', ig_services: 'apify',
  google_lsa: 'apify', google_sponsored: 'apify',   // SPEC-193: retired off SerpAPI
  yelp: 'yelp',
  osm: 'free',
};
// SPEC-193: the two ex-SerpAPI sources now run the same Apify extractor as gmaps.
const RETIRED_TO_APIFY = new Set(['google_lsa', 'google_sponsored']);
// Published per-search list prices, used to ESTIMATE cost where the vendor exposes no
// usage API we can read from an edge function. An estimate that is visible beats a zero
// that is wrong — a source with no meter is a source with no brake.
const EST_COST_PER_CALL_USD: Record<string, number> = { serpapi: 0.005, yelp: 0.008 };

const APIFY_ACTOR_OF_SOURCE: Record<string, string> = {
  craigslist:        'memo23~craigslist-scraper',
  google_lsa:        'compass~google-maps-extractor',   // SPEC-193
  google_sponsored:  'compass~google-maps-extractor',   // SPEC-193
  yellowpages_apify: 'trudax~yellow-pages-us-scraper',
  gmaps_apify:       'compass~google-maps-extractor',
  ig_services:       'apify~instagram-scraper',
};
// Tranches in dollars. A source starts at $1 and only advances a step once the
// spend so far has produced leads at or under the cost-per-lead ceiling.
const SPEND_TRANCHES = [1, 2, 5, 10, 25, 50];
const MAX_COST_PER_LEAD = 0.05;   // $0.05/lead ceiling — osm is free, this must earn its place

async function apifyLastRunCostUsd(actor: string, token: string): Promise<number> {
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${token}&limit=1&desc=true`,
      { signal: AbortSignal.timeout(Math.min(8000, msLeft(8000))) });
    if (!r.ok) return 0;
    const j = await r.json();
    const run = j?.data?.items?.[0];
    return Number(run?.usageTotalUsd ?? 0) || 0;
  } catch { return 0; }
}

/** Hard stop: may `source` spend another dollar? Returns null if allowed, else the reason. */
// SPEC-189: our per-job cost capture is STRUCTURALLY incomplete. Measured 2026-08-01:
// Apify billed \$23.59 while our ledger recorded \$5.11 — 78% invisible. Three causes:
// an aborted run still bills but we return before recording; six pool workers share one
// "last run" lookup so a cost lands on the wrong job; and cost was written only on
// 'delivered', never on failed or parked. A gate that sees a fifth of the spend cannot
// guarantee anything, which is exactly what Tarik pays for.
//
// So the gate no longer trusts our own arithmetic. It asks APIFY what the account has
// actually spent this period and uses the LARGER of (our ledger, the vendor's truth).
// Under-counting is the only failure mode that costs money.
let _vendorSpendCache: { at: number; usd: number } | null = null;
async function apifyAccountSpendUsd(): Promise<number> {
  const TOKEN = Deno.env.get('APIFY_TOKEN');
  if (!TOKEN) return 0;
  if (_vendorSpendCache && Date.now() - _vendorSpendCache.at < 60_000) return _vendorSpendCache.usd;
  try {
    const r = await fetch(`https://api.apify.com/v2/users/me/usage/monthly?token=${TOKEN}`,
      { signal: AbortSignal.timeout(Math.min(8000, msLeft(8000))) });
    if (!r.ok) return _vendorSpendCache?.usd ?? 0;
    const j = await r.json();
    const usd = Number(j?.data?.totalUsageCreditsUsdAfterVolumeDiscount ?? j?.data?.totalUsageCreditsUsd ?? 0) || 0;
    _vendorSpendCache = { at: Date.now(), usd };
    return usd;
  } catch { return _vendorSpendCache?.usd ?? 0; }
}

async function spendBlockedReason(source: string): Promise<string | null> {
  const vendor = VENDOR_OF_SOURCE[source] || 'free';
  if (vendor === 'free') return null;                        // osm only — genuinely free
  const [spendRes, leadsRes] = await Promise.all([
    growthClient().from('crawl_requests').select('cost_usd').eq('source', source).not('cost_usd', 'is', null),
    growthClient().from('leads_services').select('id', { count: 'exact', head: true }).eq('data_source', source),
  ]);
  const ledgerSpent = (spendRes.data || []).reduce((a: number, r: any) => a + (Number(r.cost_usd) || 0), 0);
  // SPEC-189: reconcile with the vendor. Our ledger under-reported by 78% once; if the
  // account total exceeds what all apify sources have recorded between them, attribute
  // the shortfall proportionally rather than pretending it does not exist.
  const vendorTotal = await apifyAccountSpendUsd();
  const allApify = await growthClient().from('crawl_requests').select('cost_usd')
    .in('source', Object.keys(APIFY_ACTOR_OF_SOURCE)).not('cost_usd', 'is', null);
  const ledgerAll = (allApify.data || []).reduce((a: number, r: any) => a + (Number(r.cost_usd) || 0), 0);
  const shortfall = Math.max(0, vendorTotal - ledgerAll);
  const share = ledgerAll > 0 ? ledgerSpent / ledgerAll : 1 / Object.keys(APIFY_ACTOR_OF_SOURCE).length;
  const spent = ledgerSpent + shortfall * share;
  const leads = leadsRes.count ?? 0;
  // Allowance = the first tranche the proven yield justifies.
  let allowance = SPEND_TRANCHES[0];
  if (leads > 0) {
    const costPerLead = spent / leads;
    if (costPerLead <= MAX_COST_PER_LEAD) {
      for (const t of SPEND_TRANCHES) { if (spent >= t * 0.9) allowance = t; }
      const next = SPEND_TRANCHES.find((t) => t > allowance);
      if (next) allowance = next;                            // earned the next step
    }
  }
  if (spent < allowance) return null;                        // inside budget
  return leads === 0
    ? `SPEND GATE: ${source} has spent $${spent.toFixed(2)} for 0 leads. Blocked at the $${allowance} tranche until it produces output.`
    : `SPEND GATE: ${source} spent $${spent.toFixed(2)} for ${leads} leads ($${(spent / leads).toFixed(4)}/lead) — above the $${MAX_COST_PER_LEAD}/lead ceiling. Blocked at $${allowance}.`;
}

async function apifyRun(actor: string, input: unknown, maxItems: number): Promise<any[]> {
  _lastApifyError = null;
  const TOKEN = Deno.env.get('APIFY_TOKEN');
  if (!TOKEN) { _lastApifyError = 'pending APIFY_TOKEN'; return []; }
  // SPEC-183 — THE MONEY LEAK. ctrl.abort() aborts OUR HTTP REQUEST. It does NOT
  // cancel the Apify run: the actor keeps executing on Apify's side, keeps scraping,
  // and keeps BILLING — while we discard the result and record a timeout. Every slow
  // actor therefore charged for a full run and delivered nothing to us. That is how
  // ~$70 was spent for zero rows.
  //
  // `timeout` makes APIFY kill the run server-side at the same moment we stop
  // waiting, so an abandoned run cannot keep spending. It is the one parameter that
  // makes our client-side deadline financially real.
  const budgetMs = msLeft(140000);
  const actorTimeoutSecs = Math.max(20, Math.floor(budgetMs / 1000));
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`
    + `?token=${TOKEN}&maxItems=${maxItems}&timeout=${actorTimeoutSecs}&memory=1024`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), budgetMs);  // SPEC-172
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      _lastApifyError = `apify ${actor} HTTP ${res.status}: ${body.slice(0, 160)}`;
      return [];
    }
    const j = await res.json();
    const items = Array.isArray(j) ? j : [];
    if (items.length === 0) _lastApifyError = `apify ${actor} returned 0 items (check actor input)`;
    // Read back what that run actually COST. One cheap call, and it is the only way
    // to enforce a real dollar budget rather than a guess.
    _lastApifyCostUsd = await apifyLastRunCostUsd(actor, TOKEN);
    return items;
  } catch (e) {
    _lastApifyError = (e as Error)?.name === 'AbortError'
      ? `apify ${actor} TIMED OUT after ${actorTimeoutSecs}s — Apify was told to kill the run at the same moment, so it is not still billing (SPEC-183). Actor too slow for run-sync at maxItems=${maxItems}.`
      : `apify ${actor} threw: ${String(e).slice(0, 160)}`;
    return [];
  } finally { clearTimeout(to); }
}
async function fulfillCraigslist(db: any, job: any): Promise<{ saved: number; found: number; query: string; note?: string }> {
  if (!Deno.env.get('APIFY_TOKEN')) return { saved: 0, found: 0, query: 'craigslist', note: 'pending APIFY_TOKEN' };
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const sub = CL_SUBDOMAIN[metroOf(city).toLowerCase()];  // SPEC-170b: boroughs have no CL subdomain
  const query = `${rawType} [craigslist ${city}]`;
  if (!sub || osmIsBlocked(rawType)) return { saved: 0, found: 0, query, note: sub ? 'blocked' : 'no craigslist subdomain' };
  // Map the service to the RIGHT Craigslist services subcategory (bbb was a
  // for-sale/spam-polluted catch-all). sss=for-sale is NEVER used.
  const CL_SUBCAT: Record<string, string> = {
    'handyman':'sks','plumber':'sks','electrician':'sks','contractor':'sks','hvac':'sks','painter':'sks','roofing':'sks',
    'house cleaning':'hss','housekeeper':'hss','home organizer':'hss','home decorator':'hss',
    'dog walker':'pas','pet sitter':'pas','cat sitter':'pas','dog trainer':'pas','pet sitting':'pas',
    'tutor':'lss','gmat tutor':'lss','personal trainer':'lss','nutritionist':'lss','life coach':'lss',
    'babysitter':'kid','barber':'bts','personal shopper':'bts','photographer':'crs','mover':'lbs',
    'driver':'lbs','personal assistant':'lbs',
  };
  const subcat = CL_SUBCAT[rawType] || 'bbb';
  // (the single-URL clUrl was dead since the SUBCATS sweep landed — removed, SPEC-178)
  // VOLUME (SPEC-101): 40 -> 250 per job, and sweep EVERY relevant services
  // subcategory in one run instead of a single URL. Craigslist has ~8 service
  // subcats; one URL was leaving ~90% of the inventory on the table.
  const MAXITEMS = Number(Deno.env.get('CL_MAX_ITEMS') || '1000');   // MAX: Apify sets no per-run ceiling; 1000 = a full CL subcat page-set
  const SUBCATS = Array.from(new Set([subcat, 'sks', 'hss', 'lbs', 'crs', 'lss', 'pas', 'cps']));
  // SPEC-178: Craigslist matches ?query= as an EXACT PHRASE. "gmat tutor" matches
  // zero posts in every services subcat; "tutor" matches hundreds. Query the head
  // noun and let our own keyword + blocked-category gates do the narrowing.
  const clQuery = rawType.split(' ').filter(Boolean).pop() || rawType;
  const startUrls = SUBCATS.map((sc) => `https://${sub}.craigslist.org/search/${sc}?query=${encodeURIComponent(clQuery)}`);
  // maxItems is PER START URL in this actor (default 1000) — 8 urls x 1000 would
  // abort run-sync and cost a fortune. `includeEmails` is not an input field at all.
  const items = await apifyRun('memo23~craigslist-scraper',
    { startUrls, maxItems: Math.max(20, Math.floor(MAXITEMS / SUBCATS.length)) }, MAXITEMS);
  let found = items.length, saved = 0;
  const seen = new Set<string>();
  // Reject FOR-SALE items (cars/products) + spammy ALL-CAPS/price posts.
  // SPEC-187: measured against 49 real craigslist service titles, the old regex threw
  // away 6 GENUINE posts — a bare year ("Licensed Plumber serving NYC since 2005"),
  // "miles" ("travel up to 15 miles"), "pickup" ("free pickup and delivery"), and
  // substring hits where audi/ram/tesla sit inside Audio, RAM upgrades and Tesla Charger
  // Installation. Every vehicle signal is preserved (5/5 car listings still rejected);
  // only the false positives are removed.
  const CAR_MAKE = 'mercedes|toyota|honda|ford|nissan|bmw|chevy|chevrolet|jeep|hyundai|kia|audi|lexus|acura|dodge|gmc|subaru|volkswagen|vw|cadillac|mazda|infiniti';
  const FORSALE = new RegExp(
    `\\b(?:${CAR_MAKE})\\b|\\b(?:for sale|mileage|sedan|suv|coupe|vin|obo)\\b`
    + `|\\b\\d{2,3}[,.]?\\d{3}\\s*miles\\b|\\b\\d{2,3}k\\s*miles\\b|\\bpick-?up truck\\b`, 'i');
  const kw = rawType.split(' ').filter(Boolean).pop() || rawType;  // SPEC-178: head noun, not the modifier // core service keyword must appear
  let placeholders = 0;
  for (const it of items) {
    // SPEC-178: an EMPTY craigslist search does not return an empty dataset — this
    // actor pushes 10 rows labelled NO_RESULTS per URL. 8 URLs = 80 items, so
    // apifyRun saw a non-empty array and recorded NO error, our filters dropped
    // every placeholder, and the job reported "no Craigslist results" forever.
    if (it?.label === 'NO_RESULTS' || it?.causes) { placeholders++; continue; }
    const name = cleanText(it?.title || it?.name);
    if (!name) continue;
    // SPEC-178: this actor emits the body as `post`. It emits no description/body, so
    // desc was ALWAYS '' — the on-topic gate degraded to title-only and the body-phone
    // fallback below was unreachable code.
    const desc = (it?.post || it?.description || it?.body || '').toString();
    const hay = `${name} ${desc}`;
    if (osmIsBlocked(hay)) continue;
    if (FORSALE.test(name)) continue;
    // SPEC-187: a BUYER, not a provider. Matched 1 real post ("IT Specialist Needed")
    // and 0 of the other 48. "looking for"/"seeking" deliberately excluded — real
    // providers write "Developer Seeking Projects".
    if (/\b(needed|wanted)\b/i.test(name)) continue;                                   // drop cars/products
    if (name.startsWith('$') || /\$\d+[^a-z]{0,3}(visit|off|special|install|repair|drain)/i.test(name)) continue; // price-spam
    const letters = name.replace(/[^A-Za-z]/g,''); const caps = name.replace(/[^A-Z]/g,'');
    if (letters.length > 8 && caps.length / letters.length > 0.7) continue; // ALL-CAPS spam
    if (kw && !new RegExp(kw.replace(/[^a-z]/gi,''),'i').test(hay)) continue; // must be on-topic
    // robust phone: explicit fields first, then a phone in the body.
    let phone = normPhone((Array.isArray(it?.phoneNumbers) ? it.phoneNumbers[0] : (it?.phone || it?.phoneNumber || it?.contactPhone || '')) || '');
    if (!phone) { const m = `${name} ${it?.location || ''} ${desc}`.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/); if (m) phone = normPhone(m[0]); }
    const emailsArr = Array.isArray(it?.emails) ? it.emails : (it?.email ? [it.email] : []);
    const email = (emailsArr.map((e: any) => String(e || '').toLowerCase())
      .find((e: string) => e.includes('@') && !/craigslist\.org|reply\./i.test(e))) || null; // DIRECT email only
    // SPEC-187: most craigslist service posters use the anonymised reply button and
    // paste neither phone nor email, so this discarded the majority of REAL posts. The
    // post URL is itself a working contact path. Never invent a contact — keep them null.
    const postUrl = String(it?.url || it?.postUrl || it?.link || '');
    // SPEC-192: reverted. I had allowed a contactless post through on its URL alone;
    // the founder's spec is explicit that a lead without phone or email is useless.
    if (!phone && !email) continue;                                     // uncontactable
    const dkey = phone ? `p:${phone}` : (email ? `e:${email}` : `u:${postUrl}`);
    if (seen.has(dkey)) continue; seen.add(dkey);                        // dedup reposts within run
    const lat = it?.mapCoordinates?.latitude ?? it?.latitude ?? it?.lat ?? null;
    const lon = it?.mapCoordinates?.longitude ?? it?.longitude ?? it?.lon ?? null;
    if (lat != null && lon != null && !inUS(Number(lat), Number(lon))) continue;
    const first = parseFirstName(`${name} ${desc}`);
    const clPostId = postUrl
      ? (postUrl.match(/([A-Za-z0-9]{8,})(?:\.html)?\/?$/)?.[1] || postUrl.replace(/[^A-Za-z0-9]/g, '').slice(-40))
      : '';
    const idbase = (phone ? phone.replace(/\D/g, '') : (email || clPostId)).slice(0, 60);
    if (!idbase) continue;   // never upsert a colliding `cl:<city>` id
    const row = {
      id: `cl:${idbase}:${city.toLowerCase().replace(/[^a-z]/g, '')}`,
      name, service_type: job.service_type || null,
      phone, phone_origin: phone ? 'craigslist' : null,
      website_url: it?.url || null,
      cl_post_url: postUrl || null, owner_email: email,
      instagram: null, has_instagram: false,
      address: it?.location || null, city, state: state || null, zip: null,
      lat, lon, data_source: 'craigslist', fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `craigslist | ${classifyEntity(name)} | ${first ? 'name:' + first + ' | ' : ''}${desc.slice(0, 70)}`.slice(0, 240),
    };
    await bufUpsert(db, row); const error = null;
    if (!error) saved++;
  }
  found -= placeholders;   // placeholders are diagnostics, not listings
  return { saved, found, query, note: (saved === 0 && placeholders > 0)
    ? `craigslist: 0 real listings — ${placeholders} NO_RESULTS placeholders for "${clQuery}" (search too narrow or wrong subcat)` : undefined };
}

async function fulfillYellowPagesApify(db: any, job: any): Promise<{ saved: number; found: number; query: string; note?: string }> {
  if (!Deno.env.get('APIFY_TOKEN')) return { saved: 0, found: 0, query: 'yellowpages', note: 'pending APIFY_TOKEN' };
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const query = `${rawType} [yellowpages ${city}]`;
  if (!city || osmIsBlocked(rawType)) return { saved: 0, found: 0, query };
  // SPEC-179: cryptosignals~yellow-pages-us-scraper is DEPRECATED on Apify
  // (isDeprecated:true since 2026-07-29) and FAILED 169 of its last 299 public runs.
  // trudax is the maintained equivalent and its input key is `search`, NOT `keyword` —
  // a wrong key returns an empty dataset that reads as an empty market. 1000 results
  // also cannot finish inside run-sync: the SPEC-117 mistake, never applied here.
  const YP_MAX_ITEMS = Math.min(Number(Deno.env.get('YP_MAX_ITEMS') || '60'), 100);
  const items = await apifyRun('trudax~yellow-pages-us-scraper',
    // SPEC-170b: YellowPages indexes by METRO — "Wynwood, FL" matches nothing.
    { search: rawType, location: `${metroOf(city)}, ${METRO_STATE[metroOf(city)] || state}`, maxItems: YP_MAX_ITEMS }, YP_MAX_ITEMS);
  // Capture NOW: _lastApifyError is module-level and 6 pool workers share it.
  const ypApifyErr = _lastApifyError;
  let found = items.length, saved = 0, ypFetches = 0;
  const seen = new Set<string>();
  for (const it of items) {
    const name = cleanText(it?.businessName || it?.name || it?.title);
    if (!name) continue;
    if (osmIsBlocked(`${name} ${(it?.categories||it?.category||'')}`)) continue;
    const phone = normPhone((Array.isArray(it?.phoneNumbers) ? it.phoneNumbers[0] : (it?.phone || it?.phoneNumber || '')) || '');
    let email = ((it?.email || (Array.isArray(it?.emails) ? it.emails[0] : '')) || '').toLowerCase() || null;
    const site = it?.website || it?.url || null;
    if (!email && site && ypFetches < 15) { ypFetches++; email = await scrapeEmail(site); } // direct email from the biz's own site
    if (!phone && !email) continue;
    const dkey = phone ? `p:${phone}` : `e:${email}`;
    if (seen.has(dkey)) continue; seen.add(dkey);
    const addr = it?.address || [it?.street, it?.city, it?.state, it?.zip].filter(Boolean).join(', ') || null;
    const cats = Array.isArray(it?.categories) ? it.categories.join(', ') : (it?.category || it?.categories || '');
    const first = parseFirstName(name);
    const idbase = phone ? phone.replace(/\D/g, '') : (email || name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,50);
    const row = {
      id: `yp:${idbase}:${city.toLowerCase().replace(/[^a-z]/g, '')}`,
      name, service_type: job.service_type || null,
      phone, phone_origin: phone ? 'yellowpages' : null,
      website_url: it?.website || it?.url || null, owner_email: email,
      instagram: null, has_instagram: false,
      address: addr, city, state: state || null, zip: it?.zip || null,
      lat: it?.latitude ?? null, lon: it?.longitude ?? null,
      data_source: 'yellowpages', fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `yellowpages | ${classifyEntity(name)} | ${first ? 'name:' + first + ' | ' : ''}${String(cats).slice(0, 70)}`.slice(0, 240),
    };
    await bufUpsert(db, row); const error = null;
    if (!error) saved++;
  }
  return { saved, found, query, note: saved === 0
    ? (_lastFlushError || ypApifyErr || `no YellowPages results (raw items returned: ${found})`) : undefined };
}

// ── IG-FOR-SERVICES: apify~instagram-scraper user search. Writes BOTH a service row
// (with the IG handle attached) AND a creator row (dual class), never fabricating.
async function fulfillIgServices(db: any, job: any): Promise<{ saved: number; found: number; query: string; note?: string }> {
  if (!Deno.env.get('APIFY_TOKEN')) return { saved: 0, found: 0, query: 'ig_services', note: 'pending APIFY_TOKEN' };
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const query = `${rawType} ${city} [ig_services]`;
  if (!city || osmIsBlocked(rawType)) return { saved: 0, found: 0, query };
  const want = Number(Deno.env.get('IG_MAX') || '200');   // MAX: apify instagram-scraper user search
  const items = await apifyRun('apify~instagram-scraper',
    { search: `${rawType} ${city}`, searchType: 'user', searchLimit: want, resultsType: 'details', resultsLimit: want }, want);
  let found = items.length, saved = 0;
  const seen = new Set<string>();
  for (const it of items) {
    const handle = String(it?.username || '').toLowerCase().trim();
    if (!handle || seen.has(handle)) continue; seen.add(handle);
    const name = cleanText(it?.fullName || it?.username);
    if (!name) continue;
    const bio = String(it?.biography || '');
    if (osmIsBlocked(`${name} ${bio} ${it?.businessCategoryName || ''}`)) continue;
    // geo: the city must appear in the creator's own text (no fabrication)
    if (!cityVerifiedSvc(city, `${bio} ${name} ${handle} ${it?.businessCategoryName || ''}`)) continue;
    const followers = typeof it?.followersCount === 'number' ? it.followersCount : null;
    const ext = it?.externalUrl || null;
    let email: string | null = null;
    const em = bio.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (em) email = em[0].toLowerCase();
    // SERVICE row — the provider, with the IG handle attached (dual)
    const svc = {
      id: `igs:${handle}:${city.toLowerCase().replace(/[^a-z]/g, '')}`,
      name, service_type: job.service_type || null,
      phone: null, phone_origin: null,
      website_url: ext, owner_email: email,
      instagram: handle, has_instagram: true,
      address: null, city, state: state || null, zip: null,
      lat: null, lon: null,
      data_source: 'ig_services', fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `ig_services | ${classifyEntity(name)} | @${handle}${followers != null ? ` | ${followers} followers` : ''} | ${(it?.businessCategoryName || '')}`.slice(0, 240),
    };
    await bufUpsert(db, svc); const e1 = null;
    if (!e1) saved++;
    // CREATOR row — same person as a creator (dual class), fill-only
    try {
      // SPEC-188: this is a MODULE-LEVEL function; `gdb` is created INSIDE serve(), so it
      // was never in scope here. Identical to the SPEC-166 failure that silently discarded
      // every crawled row. growthClient() resolves at module scope.
      await growthClient().from('leads_influencers').upsert({
        id: `igs:${handle}`, ig_handle: handle, display_name: name,
        category: job.service_type || null, followers, email,
        city, state: state || null, is_business: !!it?.isBusinessAccount,
        external_url: ext, discovered_via: 'ig-scraper-user-search',
        outreach_status: 'pending_review',
      }, { onConflict: 'id' });
    } catch (e) {
      // SPEC-202: this used to swallow the error entirely. It hid a 42703 on a column
      // that did not exist, so 262 ig_services rows produced ZERO creators and nothing
      // anywhere said why. A best-effort write that never reports is not best-effort,
      // it is invisible. Record it once — the job note then carries the real reason.
      if (!_lastCreatorError) _lastCreatorError = `creator row rejected: ${serr(e)}`;
    }
  }
  return { saved, found, query };
}
// city must appear in the account's own text — reuses the CITY alias idea locally
function cityVerifiedSvc(city: string, text: string): boolean {
  const t = (text || '').toLowerCase();
  const c = city.toLowerCase();
  const NY = ['new york', 'nyc', 'brooklyn', 'manhattan', 'queens', 'bronx'];
  const MIA = ['miami', 'miami beach', 'brickell', 'wynwood', 'south florida', '305'];
  if (NY.includes(c) || ['manhattan','brooklyn','queens','bronx','staten island'].includes(c)) return NY.some((a) => t.includes(a));
  if (MIA.includes(c) || ['miami beach','brickell','wynwood','coral gables','doral'].includes(c)) return MIA.some((a) => t.includes(a));
  return t.includes(c);
}

// ── GOOGLE MAPS via Apify `compass/crawler-google-places` (SPEC-103).
// The APIFY-FIRST backbone: no quota cap, pay-per-result, includes email+phone.
async function fulfillGmapsApify(db: any, job: any): Promise<{ saved: number; found: number; query: string; note?: string }> {
  if (!Deno.env.get('APIFY_TOKEN')) return { saved: 0, found: 0, query: 'gmaps_apify', note: 'pending APIFY_TOKEN' };
  const rawType = (job.service_type || '').toLowerCase().trim();
  const city = (job.city || '').trim();
  const state = (job.state || '').trim();
  const query = `${rawType} in ${city}, ${state} [gmaps_apify]`;
  if (!city || osmIsBlocked(rawType)) return { saved: 0, found: 0, query };
  // SPEC-182: compass~crawler-google-places routinely takes 8-9 MINUTES, and worse
  // with scrapeContacts (which opens every business website and costs extra). Our
  // run-sync wall is ~138s, so this actor could never finish — every run aborted,
  // was stamped delivered-0, and the job was consumed. That is SPEC-117 repeating
  // with a bigger timer.
  //
  // compass~google-maps-extractor is the same publisher's FAST variant, built for
  // "hundreds of places" per run, and it fits inside run-sync at a modest cap.
  // scrapeContacts is OFF: Google Maps already gives phone for nearly every place,
  // and the website-crawl add-on is what pushes the run past the wall (and bills
  // extra). We take phone-first leads now rather than nothing forever.
  const want = Math.min(Number(job.target_count || 0) || Number(Deno.env.get('GMAPS_MAX') || '60'), 120);
  const items = await apifyRun('compass~google-maps-extractor', {
    // Docs: "Adding a location directly to the search can limit you to 120 results
    // per search term" — so the city goes in locationQuery, never in the term.
    searchStringsArray: [rawType],
    // Docs: "simpler formats work best; use City + Country rather than City + Country + State".
    locationQuery: `${metroOf(city)}, United States`,
    maxCrawledPlacesPerSearch: want,
    language: 'en',
    skipClosedPlaces: true,
  }, want);
  const gmApifyErr = _lastApifyError;   // capture NOW: 6 pool workers share this global
  let found = items.length, saved = 0;
  const seen = new Set<string>();
  for (const it of items) {
    const name = cleanText(it?.title || it?.name);
    if (!name) continue;
    const cat = String(it?.categoryName || it?.category || '');
    if (osmIsBlocked(`${name} ${cat}`)) continue;
    if (!ypPlausible(rawType, name, cat)) continue;
    const lat = it?.location?.lat ?? it?.latitude ?? null;
    const lon = it?.location?.lng ?? it?.longitude ?? null;
    if (lat != null && lon != null && !inUS(Number(lat), Number(lon))) continue;
    const phone = normPhone(it?.phone || it?.phoneUnformatted || '');
    const emails = Array.isArray(it?.emails) ? it.emails : (it?.email ? [it.email] : []);
    const email = (emails.map((e: any) => String(e || '').toLowerCase()).find((e: string) => e.includes('@'))) || null;
    const igs = Array.isArray(it?.instagrams) ? it.instagrams : [];
    const igHandle = igs.length ? String(igs[0]).replace(/^.*instagram\.com\//, '').replace(/\/$/, '') : null;
    const pid = String(it?.placeId || it?.place_id || '');
    const key = pid || `${name.toLowerCase()}|${city.toLowerCase()}`;
    if (seen.has(key)) continue; seen.add(key);
    if (!phone && !email) continue;   // uncontactable -> don't pay to store
    const row = {
      id: `gmap:${pid || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      name, service_type: job.service_type || null,
      phone, phone_origin: phone ? 'gmaps_apify' : null,
      website_url: it?.website || null, owner_email: email,
      instagram: igHandle, has_instagram: !!igHandle,
      address: it?.address || null,
      city: it?.city || city, state: it?.state || state || null, zip: it?.postalCode || null,
      lat, lon, data_source: 'gmaps_apify', fetched_at: new Date().toISOString(),
      outreach_status: 'new',
      outreach_notes: `gmaps_apify | ${classifyEntity(name)} | ${cat}`.slice(0, 240),
    };
    await bufUpsert(db, row); const error = null;
    if (!error) saved++;
  }
  return { saved, found, query, note: saved === 0
    ? (_lastFlushError || gmApifyErr || `no Google Maps results (raw items returned: ${found})`) : undefined };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
