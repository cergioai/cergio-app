-- SPEC-198 — RETIRE THE OLD AUTONOMOUS OPS (founder, 2026-08-02)
--
-- "suspend the old system of coo forensic auditor etc.. they're wasteful and didn't
--  deliver anything... we're resetting the ops with sub agents.. one at a time one
--  feature at a time"
--
-- What these were: a self-directing COO (brain + executor), a watchdog, an orchestrator
-- and a supply engine, all firing on pg_cron, all able to act on the database without a
-- human in the loop. The record over the last weeks:
--   • coo-execute            0 rows executed, 13 items stuck awaiting approval
--   • the build agent        dark on an API billing error while every dashboard read green
--   • cergio-orchestrator    re-ran PAUSED agents because a paused agent reads as 'stall'
--   • cergio-watchdog        4 standing "STALE DEFECT" alerts, all FALSE-RED
--   • cergio-clean-services  an ORPHAN cron with no function and no migration, failing hourly
-- Cost was real; delivery was not. Worse, they act CONCURRENTLY with the isolated agents
-- we are moving to, which breaks the one property that matters now: that a change is
-- attributable to exactly one owner working inside one wall.
--
-- Unscheduled, NOT dropped. Every function stays in the tree; re-scheduling is one line.
-- Deliberately KEPT: the crawl workers (fulfill-crawl / crawl-seed-osm / release-funds)
-- and ops-metrics, because crawling is separately suspended by SPEC-197 and metrics are
-- read-only.
do $$
declare j text;
begin
  foreach j in array array[
    'cergio_coo_execute',      -- self-directing executor
    'cergio_orchestrator',     -- re-ran paused agents
    'cergio_watchdog',         -- standing false-reds
    'cergio_supply_engine',    -- dispatched crawl load
    'cergio_creator_harvest',  -- green-but-false no-op
    'cergio_creator_enrich',
    'cergio_enrich_influencers',
    'cergio_qa_live_verify',
    'cergio_qa_suite',
    'cergio-clean-services'    -- the orphan that fails hourly with no source
  ] loop
    begin
      perform cron.unschedule(j);
      raise notice 'unscheduled %', j;
    exception when others then
      raise notice 'skip % (%).', j, sqlerrm;
    end;
  end loop;
end $$;

select jobname, schedule, active from cron.job order by jobname;
