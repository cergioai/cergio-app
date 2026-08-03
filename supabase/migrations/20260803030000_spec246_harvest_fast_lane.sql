-- SPEC-246 — TEMPORARY fast lane for creator discovery (founder, 2026-08-03, verbatim:
-- "override the 2 hours window of IG.. need data now... we'll reinstate schedule after
-- we verify data is solid").
--
-- creator-harvest ran at '17 */2 * * *' (every 2 hours — set by the 2026-08-03 cron-body
-- fix, SPEC-242/PR #258). The founder needs the fresh-100 NOW, so it runs every 15
-- minutes — the same cadence fulfill-crawl already runs at. This is an OVERRIDE, not the
-- new normal: once the founder verifies the data is solid, a follow-up migration
-- reinstates '17 */2 * * *' (that reinstatement is pre-authorised by the same order).
--
-- Safety unchanged: creator-harvest still reads CRAWLS_SUSPENDED/CRAWLS_ONLY, still
-- stops ITSELF at CREATOR_TARGET=100 by PREFIX count before any search fires, and is
-- free (keyless web search) — a faster clock cannot spend money and cannot overshoot.
-- Body goes through public.cergio_call_edge (Vault bearer) — the ONLY transport whose
-- secrets resolve on this database (gate #242 replays migration history to enforce it).
select cron.unschedule('cergio_creator_harvest')
where exists (select 1 from cron.job where jobname = 'cergio_creator_harvest');
select cron.schedule('cergio_creator_harvest', '*/15 * * * *',
  $$ select public.cergio_call_edge('creator-harvest'); $$);
