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
const MAX_REQUESTS_PER_RUN = 40;
const YP_FETCH_JITTER_MS = 1200; // polite pacing between YP page fetches (+ random)

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
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
    const perRun = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : MAX_REQUESTS_PER_RUN, 1), 200);

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
      const { data: swept, error: sErr } = await db
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
    let jobQ = db
      .from('crawl_requests')
      .select('id, kind, city, state, lat, lng, service_type, target_count, requested_by, status, source, notes')
      .eq('kind', 'services')
      .eq('status', 'new');
    if (!YP_ENABLED) jobQ = jobQ.or('source.is.null,source.neq.yellowpages');
    const { data: jobs, error: jobsErr } = await jobQ
      .order('created_at', { ascending: true })
      .limit(perRun);
    if (jobsErr) throw jobsErr;

    // ── RECOVERY (2026-07-14 FORENSIC) ────────────────────────────────────────
    // Un-burn jobs that a previous run stamped 'failed' purely because the Google
    // account was denied (billing). Those jobs were never bad — they were victims
    // of an account state. Put them back in the queue; they now drain via OSM.
    await db.from('crawl_requests')
      .update({ status: 'new', updated_at: new Date().toISOString() })
      .eq('status', 'failed')
      .or('notes.ilike.%REQUEST_DENIED%,notes.ilike.%places-infra%,notes.ilike.%enable Billing%');

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
    for (const job of jobs ?? []) {
      // Mark crawling so concurrent runs don't double-process.
      await db.from('crawl_requests').update({ status: 'crawling', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'new');

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
          await db.from('crawl_requests').update({
            status: 'failed', notes: YP_DEAD_NOTE, updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          ypQuarantined++;
          continue;
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
          await db.from('crawl_requests').update({
            status: 'delivered', delivered_count: saved,
            notes: saved === 0 ? 'no YellowPages results for this city/type' : null,
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
          await db.from('crawl_requests').update({
            status: 'delivered', delivered_count: saved,
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
            const { error: upErr } = await db.from('leads_services').upsert(row, { onConflict: 'id' });
            if (!upErr) saved++;
          }

          await db.from('crawl_requests').update({
            status: 'delivered', delivered_count: saved,
            notes: saved === 0 ? 'no Google Places results for this city/type' : null,
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        }

        // ── Notify the searcher ───────────────────────────────────────────────
        await notifySearcher(db, job, saved);
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
          await db.from('crawl_requests').update({
            status: 'new',
            notes: `places-infra (re-queued, not burned): ${msg}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          out.push({ id: job.id, error: msg, infra: true });
          continue;
        }
        // ── Overpass rate-limit / block / timeout is TRANSIENT, not a bad job ────
        // SPEC-72: the block is SURFACED (this pushes an error → the run logs
        // 'error' and agent_runs.meta.osm_blocked carries the count + reason, so a
        // block flood can never hide behind a silent delivered-0). But the JOB is
        // RE-QUEUED to 'new' (not burned to 'failed'): Overpass has 2 slots + short
        // cooldowns, so a 429/504 clears on the next run. yp-blocked note appears in
        // the generic branch below (status: 'failed') for the dormant YP path.
        if (e instanceof OverpassBlockedError || /^osm-blocked/i.test(msg)) {
          await db.from('crawl_requests').update({
            status: 'new',
            notes: `osm-blocked (re-queued, transient): ${msg}`.slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          out.push({ id: job.id, error: msg, blocked: true, osm: true });
          continue;
        }
        const blocked = e instanceof YpBlockedError || /^yp-blocked/i.test(msg);
        // A block page is stamped 'failed' with a distinct 'yp-blocked' note — NOT
        // 'delivered' — so the queue is not silently drained to delivered-0 and the
        // health-check/watchdog can see the anti-bot block for what it is.
        await db.from('crawl_requests').update({
          status: 'failed',
          notes: (blocked ? `yp-blocked: ${msg}` : msg).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        out.push({ id: job.id, error: msg, blocked });
      }
    }

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
      processed: out.length, yp_quarantined: ypQuarantined, yp_enabled: YP_ENABLED, results: out,
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
      ? `Good news — we found ${saved} ${type} in ${place} and we're working to bring them onto Cergio. We'll notify you as they become available so you can book through your network.`
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
// community mirror. If the first rate-limits/times out we back off and try the
// next (Overpass etiquette: ≤2 concurrent slots, short cooldowns on 429/504).
const OSM_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// A descriptive User-Agent is REQUIRED etiquette on the public Overpass API (an
// anonymous UA gets throttled/blocked first). Identifies the app + a contact.
const OSM_UA = 'CergioServicesCrawl/1.0 (+https://cergio.ai; contact: t@cergio.ai)';
const OSM_MAX_RESULTS = 50;        // hard cap per job (Overpass etiquette + write budget)
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
        const t = setTimeout(() => ctrl.abort(), OSM_HTTP_TIMEOUT_MS);
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
  const want    = Math.min(Math.max(job.target_count || 10, 1), OSM_MAX_RESULTS);
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
    const { error: upErr } = await db.from('leads_services').upsert(row, { onConflict: 'id' });
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
  const want = Math.min(Math.max(job.target_count || 30, 1), 60);
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
      const { error: upErr } = await db.from('leads_services').upsert(row, { onConflict: 'id' });
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
