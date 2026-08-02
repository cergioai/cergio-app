-- SPEC-230 — put creator-harvest back on schedule.
--
-- SPEC-198 unscheduled it as a "green-but-false no-op" alongside the COO stack. That was
-- right about the COO agents and WRONG about this one: creator-harvest is one of only TWO
-- creator discovery paths we have, and the founder's audit target is 100 creators. With it
-- unscheduled and ig-creator-marketplace removed, exactly one path remained — and the
-- supply engine then auto-disabled that one too. Creators could not have reached 100 by
-- any route, which is why the count has sat at zero.
--
-- It stays free: keyless web search, no Mac, no paid API. Every row lands pending_review
-- and is non-sendable until it passes the gate, so restoring it cannot leak anything.
select cron.schedule(
  'cergio_creator_harvest',
  '17 */2 * * *',
  $$select net.http_post(
      url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/creator-harvest',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)),
      body    := '{}'::jsonb
  );$$
)
where not exists (select 1 from cron.job where jobname = 'cergio_creator_harvest');
