-- SPEC-264 — creator-harvest v2: the FREE spec-shaped creator web crawl.
--
-- FOUNDER (2026-08-06, verbatim, both orders): "I'm showing 0 progress on
-- creators.. . use same solution for IG services for IG creators (by running
-- seaches direct based on spec (top 25 micro and mid parenting, pets, etc
-- influncers in nyc miami etc..)... augment the IG services solution with more
-- emails and phones by carawling their websites (email is easily visible there in
-- most).. also crawl the # of followers so we rank..... use same stategy for
-- creators... run creators now .. it's a free staregy.. need to see initial 100
-- to tweak..." and "NO... for creators we're doing the same IG FREE web crawling
-- staretgy we're using for IG services... (it's working!)....correct and upgrade
-- with above and ship get 100 from each — not paid! IG .."
--
-- RE-ASSERT THE CRON, BELT AND BRACES. The measured defect that zeroed the
-- harvest is the worker's own self-stop (all-time prefix count >= 100 — fixed in
-- the function), but board snapshots also showed agent_runs: [] beside a
-- correct-LOOKING final schedule (20260803030000) — consistent with the job not
-- firing live. A dead schedule and a self-pausing worker look identical from the
-- outside, so this migration re-asserts the */15 fast lane through
-- public.cergio_call_edge (the ONLY transport whose secrets resolve on this
-- database — SPEC-242; app.settings GUC bodies parse, apply, and fail every run).
-- Unschedule-first exists-guard: re-applying can never double-schedule the job.
select cron.unschedule('cergio_creator_harvest')
where exists (select 1 from cron.job where jobname = 'cergio_creator_harvest');
select cron.schedule('cergio_creator_harvest', '*/15 * * * *',
  $$ select public.cergio_call_edge('creator-harvest'); $$);
