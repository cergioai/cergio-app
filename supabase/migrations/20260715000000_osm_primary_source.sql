-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-15 — OpenStreetMap/Overpass is the FREE primary services source
-- (SPEC-72 · free-first). Companion to the edge-function changes of the same date.
--
-- Google Places is a PAID API and is now billing-blocked; YellowPages is
-- permanently 403-blocked from datacenter IPs. The constitution is free-first, so
-- the primary + default services source is now OpenStreetMap via the keyless
-- Overpass API. fulfill-crawl drains source='osm' jobs via Overpass into
-- leads_services (data_source='osm'); the new crawl-seed-osm seeds the DMA matrix;
-- on-demand crawls (enqueueCityCrawl) now enqueue source='osm'.
--
-- This migration is additive / reversible (no DROP, no DELETE, no data loss):
--   1. Register crawl-seed-osm in agent_registry (so the watchdog knows it).
--   2. Unschedule any Google-Places seed cron (it enqueues a paid, billing-blocked
--      path — stop refilling it). Defensive: matches on the command.
--   3. Open the crawl-osm-free requirement in the ledger (status 'built' — WRITTEN
--      + BUILT, NOT yet VERIFIED-LIVE; the live Overpass fetch is unproven until it
--      fires in prod — SPEC-72 firing-honesty).
--
-- Nothing here calls the paid Google API; the fulfill-crawl google_places branch
-- stays in the tree but is dormant behind GOOGLE_PLACES_ENABLED (default false).
--
-- ROLLBACK (all reversible):
--   update public.agent_registry set enabled=false where agent='crawl-seed-osm';
--   -- re-enable Google Places: set edge secret GOOGLE_PLACES_ENABLED=true and
--   --   (optionally) re-create a crawl-seed-google-places cron.
--   -- point on-demand back to Google: enqueueCityCrawl source default 'osm'→null.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. REGISTER THE FREE SEEDER ──────────────────────────────────────────────
-- enqueue-only matrix seeder — run on demand / daily; tolerate 24h before STALL.
insert into public.agent_registry (agent, max_gap_minutes, can_rerun, enabled, note) values
  ('crawl-seed-osm', 1440, true, true,
   'FREE OpenStreetMap/Overpass matrix seeder — enqueue-only; run on demand, tolerate 24h. Replaces the paid Google Places seeder as the primary source (SPEC-72 free-first).')
on conflict (agent) do update
  set max_gap_minutes = excluded.max_gap_minutes,
      can_rerun       = excluded.can_rerun,
      enabled         = true,
      note            = excluded.note;

-- ── 2. UNSCHEDULE ANY GOOGLE-PLACES SEED CRON ────────────────────────────────
-- The Places seeder enqueues a PAID, currently billing-blocked path. Stop any cron
-- that re-invokes it (the job may have been created from a launcher, so match on
-- the command, not a guessed jobname). fulfill-crawl still contains the dormant
-- google_places branch (behind GOOGLE_PLACES_ENABLED) for a last-resort re-enable.
do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in
      select jobname from cron.job
       where command ilike '%crawl-seed-google-places%'
          or jobname in ('cergio_crawl_seed_google_places', 'cergio_seed_google_places', 'cergio_crawl_seed_gp')
    loop
      perform cron.unschedule(j.jobname);
      raise notice 'unscheduled google-places seed cron: %', j.jobname;
    end loop;
  end if;
exception when others then
  raise notice 'google-places cron unschedule skipped: %', sqlerrm;
end $$;

-- ── 3. LEDGER: crawl-osm-free ────────────────────────────────────────────────
-- Status 'built' = deployed-but-not-yet-live-verified. The regression test
-- (scripts/qa.mjs id 'crawl-osm-free') locks the offline invariants; the LIVE
-- Overpass fetch + real throughput are proven only on first prod run (SPEC-72).
select public.cergio_open_requirement(
  'crawl-osm-free',
  'Services crawl sources from FREE OpenStreetMap/Overpass (keyless) for BOTH bulk (crawl-seed-osm → source=osm) and on-demand (enqueueCityCrawl source=osm) — Google Places is dormant behind GOOGLE_PLACES_ENABLED (default off). fulfill-crawl maps service_type→OSM tags, blocked categories never surface, a block/empty/rate-limited Overpass response is surfaced as error (job re-queued, agent_runs.meta.osm_blocked) and NEVER masked as delivered-0.',
  'SPEC-72 / #64 / SPEC-64',
  'crawl',
  'founder',
  'built'
);
