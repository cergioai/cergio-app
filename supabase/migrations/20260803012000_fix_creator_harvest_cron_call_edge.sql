-- SPEC-242 — creator-harvest cron: replace the GUC-built invoke with cergio_call_edge.
--
-- ROOT CAUSE (forensic audit run 156, 2026-08-03): 20260802170000_restore_creator_harvest.sql
-- built its cron body from current_setting('app.settings.supabase_url', true) and
-- current_setting('app.settings.service_role_key', true). Neither GUC is set on this
-- database, current_setting(..., true) returns NULL, the URL concatenates to NULL, and
-- net.http_post raises -- so pg_cron marked EVERY run 'failed' (...20:17Z, 22:17Z on 08-02,
-- 00:17Z on 08-03) and zero harvests happened while cron.job read as scheduled+active.
-- That is exactly why audit_flags shows CREATORS_NOT_GROWING with harvested_today 0.
--
-- Every other live cron invokes through public.cergio_call_edge (agent_runs backbone,
-- 20260708000000), which reads the edge bearer from Vault -- the resolvable path. The
-- SPEC-230 restore was right to restore the job and wrong about the transport. Cadence
-- kept at '17 */2 * * *' (the SPEC-230 decision); only the body changes.
--
-- Gate #242 (scripts/qa.mjs) pins this: the FINAL schedule of every cron job across
-- migrations may not reference app.settings GUCs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cergio_creator_harvest') then
    perform cron.unschedule('cergio_creator_harvest');
  end if;
end $$;

select cron.schedule('cergio_creator_harvest', '17 */2 * * *',
  $$ select public.cergio_call_edge('creator-harvest'); $$);
