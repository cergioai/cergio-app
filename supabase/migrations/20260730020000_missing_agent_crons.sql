-- SPEC-106 (2026-07-29): schedule the agents that were NEVER scheduled.
--
-- Live evidence from /ops/status right after deploy run #60 (which deployed all 42
-- functions): creator-enrich = OFF/0 runs, ops-metrics = OFF/0 runs. Root cause is
-- NOT a failed deploy — no migration ever wrote a cron for either. They have been
-- dead since the day they were written.
--
-- crawl-health-check is different: cron 'cergio_crawl_health' DOES exist (from
-- 20260622180000) but the function was absent from the CI deploy array, so every
-- tick POSTed to a 404 and no agent_runs row was ever written. It should self-heal
-- now that the function is deployed; this migration re-asserts it anyway.
--
-- Fully idempotent: unschedule-if-exists then schedule. Safe to run repeatedly.

-- creator-enrich: fills followers/email/phone onto pending_review creators.
-- Hourly at :05 — data-slayer is pay-per-result, so hourly not every-10-min.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cergio_creator_enrich') then
    perform cron.unschedule('cergio_creator_enrich');
  end if;
end $$;
select cron.schedule('cergio_creator_enrich', '5 * * * *',
  $$ select public.cergio_call_edge('creator-enrich'); $$);

-- ops-metrics: publishes the metrics snapshot the ops surfaces read. Every 15 min.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cergio_ops_metrics') then
    perform cron.unschedule('cergio_ops_metrics');
  end if;
end $$;
select cron.schedule('cergio_ops_metrics', '*/15 * * * *',
  $$ select public.cergio_call_edge('ops-metrics'); $$);

-- re-assert crawl-health-check (its function was 404 until 2026-07-29 run #60)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cergio_crawl_health') then
    perform cron.unschedule('cergio_crawl_health');
  end if;
end $$;
select cron.schedule('cergio_crawl_health', '*/30 * * * *',
  $$ select public.cergio_call_edge('crawl-health-check'); $$);

-- creator-harvest: currently runs ONLY when coo-execute/coo-brain elect to
-- edge_call it (97 runs/24h today, but entirely at another agent's discretion —
-- agent_runs_backbone declares it "hourly-ish, tolerate 3h"). Give it a guaranteed
-- floor of its own so discovery never silently stops because the COO deprioritised
-- it. Opportunistic COO calls continue on top of this.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cergio_creator_harvest') then
    perform cron.unschedule('cergio_creator_harvest');
  end if;
end $$;
select cron.schedule('cergio_creator_harvest', '35 * * * *',
  $$ select public.cergio_call_edge('creator-harvest'); $$);
