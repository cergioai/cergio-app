-- SPEC-263 — FREE website contact harvest for IG rows (site-enrich).
--
-- FOUNDER ORDER (2026-08-06, verbatim): "figure out a solution to capture more contact
-- details for IG... my search showed some had websites with emails and or phones.. it
-- may need a 3 step crawl or alternative straetgy.. worst case we scale the numbers to
-- 5000 to get 500 contactable ... per city .. but creators always ahve an email
-- somewhere as they want to attract partners and advertising..."
--
-- MEASURED (audit 2026-08-06T04:28Z): ig_services 276 rows, 218 with external_url,
-- only 29 emails, 0 phones — 10.5% contactable. The websites are already in the rows;
-- reading them is free. This schedules the site-enrich worker that walks them.
--
-- site_enriched_at is the ATTEMPT stamp: set on every crawl attempt, success or not,
-- so a site is tried exactly once and the candidate query (site_enriched_at is null)
-- drains forward instead of looping on dead pages. IF NOT EXISTS guards make this
-- idempotent — the live growth table already exists, so a bare CREATE/ALTER would
-- either no-op or fail (the SPEC-237 lesson: heal the TABLE, not just the reference).
alter table public.leads_influencers add column if not exists site_enriched_at timestamptz;
alter table public.leads_services    add column if not exists site_enriched_at timestamptz;

-- Cron: every 15 minutes, via public.cergio_call_edge — the ONLY transport whose
-- secrets (Vault edge bearer) resolve on this database; a GUC-built URL is the
-- schedule-that-can-never-run defect gate #242 replays history to forbid.
-- Name 'cergio_site_enrich' collides with NOTHING retired (20260802023933 retired
-- cergio_creator_enrich / cergio_enrich_influencers — different names, checked).
-- Unschedule-first + exists-guard, same shape as 20260803030000 (SPEC-246).
select cron.unschedule('cergio_site_enrich')
where exists (select 1 from cron.job where jobname = 'cergio_site_enrich');
select cron.schedule('cergio_site_enrich', '*/15 * * * *',
  $$ select public.cergio_call_edge('site-enrich'); $$);
