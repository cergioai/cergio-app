-- SPEC-265 — second cron lane for each FREE crawl worker (parallel multiplier).
--
-- FOUNDER ORDER (2026-08-07): 100X SPEED via parallel crawlers — FREE only. The
-- function halves of SPEC-265 fan the work INSIDE a run (worker pools, ~120s
-- budget); this migration multiplies the TICKS: a second lane per free worker at
-- minutes 7,22,37,52 interleaves the existing */15 lane (0,15,30,45), so each
-- worker fires ~every 7.5 minutes. Both lanes call the SAME function through
-- public.cergio_call_edge — the ONLY transport whose secrets (Vault edge bearer)
-- resolve on this database (SPEC-242; a GUC-built URL is the schedule-that-can-
-- never-run defect gate #242 replays history to forbid).
--
-- CLAIM SEMANTICS, VERIFIED BEFORE SHIPPING (the handoff's demand): a run selects
-- its candidates at start and stamps/dedupes as it goes. The lanes are staggered
-- 7-8 minutes apart while a run's wall clock is capped at ~120s, so two lanes are
-- NEVER live at once and never pick the same batch. Even a freak overlap is
-- harmless-not-corrupt: site-enrich write-backs re-check null (fill-only) and
-- stamp site_enriched_at per attempt, creator-harvest upserts on id and dedupes
-- handles case-insensitively, and every self-stop/cap COUNTS rows fresh each run
-- (CREATOR_TARGET, CREATOR_CAT_CAP, SOURCE_AUDIT_CAP) — parallel lanes cannot
-- overshoot a count-based cap by more than one in-flight batch, and they spend $0.
-- PAID sources get NO extra lane from this migration — the money gates
-- (#253-#256) are untouched and parallelism is a free-lane-only privilege.
--
-- Names 'cergio_creator_harvest_b' / 'cergio_site_enrich_b' collide with NOTHING
-- live or retired (checked: 20260802023933 retired cergio_creator_enrich /
-- cergio_enrich_influencers; no _b suffix has ever been scheduled).
-- Unschedule-first + exists-guard, same shape as 20260806050000 (SPEC-263): a
-- re-apply can never double-schedule a lane.
select cron.unschedule('cergio_creator_harvest_b')
where exists (select 1 from cron.job where jobname = 'cergio_creator_harvest_b');
select cron.schedule('cergio_creator_harvest_b', '7-59/15 * * * *',
  $$ select public.cergio_call_edge('creator-harvest'); $$);

select cron.unschedule('cergio_site_enrich_b')
where exists (select 1 from cron.job where jobname = 'cergio_site_enrich_b');
select cron.schedule('cergio_site_enrich_b', '7-59/15 * * * *',
  $$ select public.cergio_call_edge('site-enrich'); $$);
