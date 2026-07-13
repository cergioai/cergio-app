-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-13 — RESTORE VISIBILITY + STOP THE DEAD LOOPS
--
-- Companion migration to the edge-function fixes of the same date. Four things,
-- all additive / reversible (no DROP, no DELETE, no data loss):
--
--   1. leads_influencers.enrich_attempted_at   — the CURSOR that ends the
--      enrich-influencers livelock (it re-mined the same head-of-table 40 rows
--      every 30 min and wrote 0, forever → the "SILENT COLLISION" finding).
--   2. qa_findings.escalated_at                — lets cergio-watchdog escalate a
--      finding that has sat unfixed for > N hours EXACTLY ONCE (no loop), and
--      re-arm it when the finding is genuinely fixed and later re-opens.
--   3. YellowPages shutdown                    — YP answers datacenter IPs with
--      HTTP 403, permanently. Stop the seeder cron, disable the agent, and
--      quarantine the dead queue ONCE so fulfill-crawl stops erroring every run.
--   4. Retire the now-impossible YP-drain requirement so the ledger tells the
--      truth instead of carrying an unachievable open item.
--
-- ROLLBACK (all reversible):
--   alter table public.leads_influencers drop column enrich_attempted_at;
--   alter table public.qa_findings       drop column escalated_at;
--   update public.crawl_requests set status='new', notes=null
--     where source='yellowpages' and notes like 'yp-blocked-permanent%';
--   update public.agent_registry set enabled = true where agent='crawl-seed-yellowpages';
--   -- and re-create the YP seeder cron if a residential egress ever exists.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ENRICH CURSOR ─────────────────────────────────────────────────────────
-- Stamped by enrich-influencers on EVERY candidate it looks at (hit OR miss), so
-- the worker walks the whole table least-recently-attempted first instead of
-- head-banging the same 40 rows. NULL = never attempted (goes first).
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'leads_influencers') then
    alter table public.leads_influencers add column if not exists enrich_attempted_at timestamptz;
    create index if not exists leads_influencers_enrich_cursor_idx
      on public.leads_influencers (enrich_attempted_at nulls first)
      where email is null;
  end if;
end $$;

-- ── 2. STALENESS ESCALATION ──────────────────────────────────────────────────
alter table public.qa_findings add column if not exists escalated_at timestamptz;
create index if not exists qa_findings_stale_idx
  on public.qa_findings (status, found_at)
  where status = 'open';

-- cergio_qa_check keeps its exact open/resolve contract (count>0 opens, count=0
-- resolves) and gains ONE behaviour: the escalation state is tied to the CURRENT
-- open episode.
--   • fixed              → escalated_at cleared (re-armed for a future occurrence)
--   • re-opened from fixed → found_at reset to now() (staleness measures THIS
--     episode, not a months-old first sighting) and escalated_at cleared
--   • still open          → found_at + escalated_at untouched (so the watchdog
--     escalates a persistent defect exactly once, never in a loop)
create or replace function public.cergio_qa_check(
  p_area text, p_check text, p_sev text, p_count int, p_detail text
) returns void language plpgsql as $fn$
begin
  if p_count > 0 then
    insert into public.qa_findings (area, check_name, severity, count, status, detail, found_at, updated_at)
    values (p_area, p_check, p_sev, p_count, 'open', p_detail, now(), now())
    on conflict (check_name) do update set
      count    = excluded.count,
      status   = 'open',
      detail   = excluded.detail,
      -- Never DOWNGRADE a severity the watchdog escalated to 'critical'.
      severity = case when qa_findings.status = 'open'
                       and qa_findings.severity = 'critical'
                      then 'critical' else excluded.severity end,
      found_at = case when qa_findings.status = 'fixed'
                      then now() else qa_findings.found_at end,
      escalated_at = case when qa_findings.status = 'fixed'
                          then null else qa_findings.escalated_at end,
      fixed_at   = null,
      updated_at = now();
  else
    update public.qa_findings
       set status = 'fixed', count = 0,
           fixed_at = coalesce(fixed_at, now()),
           escalated_at = null,          -- re-arm: a future re-open can escalate again
           updated_at = now()
     where check_name = p_check and status = 'open';
  end if;
end; $fn$;

grant execute on function public.cergio_qa_check(text, text, text, int, text) to service_role;

-- ── 3. YELLOWPAGES SHUTDOWN ──────────────────────────────────────────────────
-- 3a. Unschedule ANY cron that re-invokes the YP seeder (the job was created from
--     a launcher, so match on the command, not on one guessed jobname).
do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in
      select jobname from cron.job
       where command ilike '%crawl-seed-yellowpages%'
          or jobname in ('cergio_crawl_seed_yp', 'cergio_seed_yp', 'cergio_crawl_seed_yellowpages')
    loop
      perform cron.unschedule(j.jobname);
      raise notice 'unscheduled dead YP cron: %', j.jobname;
    end loop;
  end if;
exception when others then
  raise notice 'YP cron unschedule skipped: %', sqlerrm;
end $$;

-- 3b. Stop expecting the seeder to run (otherwise the watchdog reports a STALL on
--     an agent we deliberately switched off). Reversible: set enabled=true.
update public.agent_registry
   set enabled = false,
       note = 'DISABLED 2026-07-13 — YellowPages returns HTTP 403 to datacenter IPs (permanent). Google Places is the live services path.'
 where agent = 'crawl-seed-yellowpages';

-- 3c. Quarantine the dead queue ONCE. These jobs can never be fulfilled from edge;
--     leaving them 'new' made fulfill-crawl error on every 15-minute run.
update public.crawl_requests
   set status = 'failed',
       notes = 'yp-blocked-permanent: YellowPages returns HTTP 403 to datacenter IPs. Not retried. Google Places is the live services path.',
       updated_at = now()
 where kind = 'services'
   and source = 'yellowpages'
   and status in ('new', 'crawling');

-- ── 4. RETIRE THE UNACHIEVABLE REQUIREMENT ───────────────────────────────────
-- p10-crawl-yp-drain ("fulfill-crawl drains queued YellowPages jobs") cannot be
-- satisfied from edge and must not sit open forever pretending it can be.
update public.requirements
   set status = 'retired',
       evidence = 'RETIRED 2026-07-13: YellowPages is permanently 403-blocked from datacenter IPs. ' ||
                  'Superseded by the google_places throughput path (services growing). ' ||
                  'Re-open only if crawling from a residential/proxy egress (fulfill-crawl YP_ENABLED=true).',
       updated_at = now()
 where id = 'p10-crawl-yp-drain';
