-- SPEC-118 EMERGENCY: pause background growth crons.
--
-- The founder cannot sign in or submit a request. Measured earlier today:
-- /rest/v1/services returned HTTP 503 while /auth/v1/user returned 200 — the DB
-- layer was saturated by background acquisition, not an auth defect.
--
-- The product outranks growth, unconditionally. These are PAUSED (not deleted) and
-- are re-enabled one at a time, each only after live evidence that REST stays 2xx.
do $$
declare j text;
begin
  foreach j in array array['cergio_supply_engine','cergio_fulfill_crawl','cergio_crawl_seed_osm','cergio_creator_harvest','cergio_creator_enrich'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
      raise notice 'paused %', j;
    end if;
  end loop;
end $$;

-- Product-critical crons are deliberately LEFT RUNNING:
--   cergio_qa_live_verify, cergio_qa_suite, cergio_watchdog, cergio_orchestrator,
--   cergio_release_funds, cergio_ops_metrics, cergio_crawl_health
