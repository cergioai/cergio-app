-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-17 — SCHEDULE the FREE OSM services seeder (SPEC-72 · free-first).
--
-- ROOT CAUSE (forensic run 35): 20260715000000_osm_primary_source.sql REGISTERED
-- crawl-seed-osm in agent_registry but NEVER created a cron to actually invoke it.
-- Consequence: the seeder has never fired → zero source='osm' crawl_requests are
-- enqueued → fulfill-crawl (every 15m) has no fresh OSM work to drain → services
-- intake has been flat (~32,531) for days while the dashboard reports the agent as
-- merely "registered". The watchdog knows the agent (max_gap 1440m) but nothing
-- was ever wired to CALL it. This migration closes that gap on the exact same
-- pg_cron + public.cergio_call_edge path every other periodic worker already uses
-- (fulfill-crawl, watchdog, coo-execute, release-funds, …).
--
-- SAFE · free-first · reversible:
--   * crawl-seed-osm is ENQUEUE-ONLY and idempotent — it pre-filters against OPEN
--     rows (crawl_requests_open_dedupe_idx on kind,city,service_type), so repeated
--     runs never duplicate jobs and cannot worsen the known de-dup backlog.
--   * It makes ZERO paid API calls: Overpass is keyless; Google Places stays
--     dormant behind GOOGLE_PLACES_ENABLED (default off).
--   * cergio_call_edge no-ops safely if the vault edge_fn_bearer secret is unset.
--   * The one-shot apply-time kick is wrapped so it can NEVER fail the migration.
--
-- ROLLBACK:  select cron.unschedule('cergio_crawl_seed_osm');
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. SCHEDULE THE SEEDER (idempotent) ──────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping crawl-seed-osm schedule';
    return;
  end if;

  -- Drop any prior job for this seeder (by jobname OR by command) so re-applying
  -- or re-registering is always clean and never double-schedules.
  perform cron.unschedule(jobname)
    from cron.job
   where jobname = 'cergio_crawl_seed_osm'
      or command ilike '%crawl-seed-osm%';

  -- Enqueue-only matrix seeder → every 6h. fulfill-crawl (every 15m) drains the
  -- source='osm' jobs it stages, via the keyless Overpass API.
  perform cron.schedule(
    'cergio_crawl_seed_osm',
    '0 */6 * * *',
    $cron$ select public.cergio_call_edge('crawl-seed-osm'); $cron$
  );
  raise notice 'scheduled cergio_crawl_seed_osm (0 */6 * * *)';
end $$;

-- ── 2. ONE-SHOT KICK so intake resumes NOW (not at the next 6h boundary) ──────
-- Guarded: a transient net/vault hiccup must never fail the deploy.
do $$
begin
  perform public.cergio_call_edge('crawl-seed-osm');
  raise notice 'kicked crawl-seed-osm once on apply';
exception when others then
  raise notice 'crawl-seed-osm one-shot kick skipped: %', sqlerrm;
end $$;
