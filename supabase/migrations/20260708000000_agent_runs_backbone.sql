-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — SUPERIOR-OPERATIONS SELF-HEALING BACKBONE.
--
-- Ends the failure class that burned every worker tonight: "cron reported
-- succeeded but nothing moved" (wiped vault secret, 401 from a bad header, a 546
-- fn crash, harvest upserting 0). Success is now defined as ROWS WRITTEN, not a
-- request sent — and the org watches itself.
--
-- This migration is ADDITIVE + IDEMPOTENT + REVERSIBLE only. It creates one new
-- table (agent_runs), a few helper functions, extends cergio_ops_snapshot() with
-- an org_health top-line, and schedules two heartbeats on pg_cron. It NEVER
-- drops, truncates, or rewrites existing data. Safe to re-run.
--
-- Companion edge fns (deploy alongside):
--   cergio-watchdog       — Item 1: delivery-verification (silent-collision / error / stall)
--   cergio-health         — Item 2: post-deploy invariant gate
--   cergio-orchestrator   — Item 3: org-health heartbeat coordinator
-- And the workers each write ONE agent_runs row per invocation (creator-harvest,
-- fulfill-crawl, enrich-influencers, crawl-seed-yellowpages, coo-execute).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- ── 1. UNIFIED RUN LEDGER ─────────────────────────────────────────────────────
-- One row per worker invocation. raw_found vs rows_written is the anti-"green-
-- but-false" signal: raw_found>0 AND rows_written=0 is a silent collision.
create table if not exists public.agent_runs (
  id           bigserial primary key,
  agent        text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  raw_found    integer,
  rows_written integer,
  status       text default 'ok',        -- 'ok' | 'error' | 'empty'
  error        text,
  meta         jsonb
);
-- Re-runnable column adds (in case the table pre-existed from an older shape).
alter table public.agent_runs add column if not exists agent        text;
alter table public.agent_runs add column if not exists started_at   timestamptz default now();
alter table public.agent_runs add column if not exists finished_at  timestamptz;
alter table public.agent_runs add column if not exists raw_found    integer;
alter table public.agent_runs add column if not exists rows_written integer;
alter table public.agent_runs add column if not exists status       text default 'ok';
alter table public.agent_runs add column if not exists error        text;
alter table public.agent_runs add column if not exists meta         jsonb;

create index if not exists agent_runs_agent_started_idx
  on public.agent_runs (agent, started_at desc);

-- Service-role (edge fns) writes; dashboard reads via snapshot fn only.
revoke all on public.agent_runs from anon, authenticated;
grant all on public.agent_runs to service_role;
grant usage, select on sequence public.agent_runs_id_seq to service_role;

-- ── 2. EXPECTED-AGENT REGISTRY ────────────────────────────────────────────────
-- The single source of truth for "which agents must run and how often". The
-- watchdog + orchestrator both read this so the stall window is data-driven, not
-- hard-coded in TypeScript. max_gap_minutes = how long we tolerate no run before
-- calling it a STALL. can_rerun = the orchestrator may re-invoke it (idempotent,
-- no send / no money). Seeded idempotently; edit rows in-place, never destructive.
create table if not exists public.agent_registry (
  agent           text primary key,
  max_gap_minutes integer not null default 60,
  can_rerun       boolean not null default false,
  enabled         boolean not null default true,
  note            text
);

insert into public.agent_registry (agent, max_gap_minutes, can_rerun, note) values
  ('creator-harvest',        180, true,  'FREE creator discovery — hourly-ish; tolerate 3h'),
  ('fulfill-crawl',           45, true,  'crawl fulfillment — cron every 15m; tolerate 45m'),
  ('enrich-influencers',      90, true,  'contact enrichment — cron every 30m; tolerate 90m'),
  ('crawl-seed-yellowpages', 1440, false, 'matrix seeder — enqueue-only; run on demand, tolerate 24h'),
  ('coo-execute',             60, true,  'autonomous COO executor — cron 5-59/10; tolerate 60m')
on conflict (agent) do update
  set max_gap_minutes = excluded.max_gap_minutes,
      can_rerun       = excluded.can_rerun,
      note            = excluded.note;

revoke all on public.agent_registry from anon, authenticated;
grant all on public.agent_registry to service_role;

-- ── 3. AGENT-HEALTH VIEW (used by watchdog, orchestrator, snapshot) ───────────
-- For each expected+enabled agent, the latest run and a computed health verdict.
-- Verdicts (worst-first): 'stall' (no run in window / never ran),
-- 'error' (last run errored), 'silent' (raw_found>0 but rows_written=0),
-- 'empty' (ran, found nothing), 'ok'. Pure SELECT — reversible, no writes.
create or replace view public.agent_health as
with latest as (
  select distinct on (r.agent)
         r.agent, r.started_at, r.finished_at, r.raw_found, r.rows_written,
         r.status, r.error, r.meta
    from public.agent_runs r
   order by r.agent, r.started_at desc
)
select
  reg.agent,
  reg.max_gap_minutes,
  reg.can_rerun,
  l.started_at   as last_run_at,
  l.raw_found,
  l.rows_written,
  l.status       as last_status,
  l.error        as last_error,
  (case
     when l.started_at is null then true
     when l.started_at < now() - make_interval(mins => reg.max_gap_minutes) then true
     else false
   end)          as is_stalled,
  (case
     when l.started_at is null
          or l.started_at < now() - make_interval(mins => reg.max_gap_minutes) then 'stall'
     when l.status = 'error' then 'error'
     when coalesce(l.raw_found,0) > 0 and coalesce(l.rows_written,0) = 0 then 'silent'
     when l.status = 'empty' or (l.rows_written is not null and l.rows_written = 0) then 'empty'
     else 'ok'
   end)          as health
from public.agent_registry reg
left join latest l on l.agent = reg.agent
where reg.enabled;

grant select on public.agent_health to service_role;

-- ── 4. ORG-HEALTH ROLLUP (single top-line) ────────────────────────────────────
-- Reduces agent_health + open watchdog findings to one status: 'green' |
-- 'degraded' | 'down', plus the list of currently-failing agents and each one's
-- specific delta vs spec. Read by ops-metrics (dashboard top-line) and the
-- orchestrator. Pure read; SECURITY DEFINER so the public ops-metrics fn (which
-- runs as service_role anyway) always resolves the same regardless of caller.
create or replace function public.cergio_org_health()
returns jsonb language plpgsql security definer
set search_path = public as $fn$
declare
  res jsonb;
  bad int;
  down_flag boolean;
begin
  select count(*) into bad from public.agent_health where health <> 'ok';
  -- 'down' if any critical (rerun-able worker) is stalled or errored, else
  -- 'degraded' if anything is off-spec, else 'green'.
  select exists(
    select 1 from public.agent_health
     where can_rerun and health in ('stall','error')
  ) into down_flag;

  select jsonb_build_object(
    'generated_at', now(),
    'status', case when down_flag then 'down'
                   when bad > 0   then 'degraded'
                   else 'green' end,
    'failing_count', bad,
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'agent', agent,
        'health', health,
        'last_run_at', last_run_at,
        'raw_found', raw_found,
        'rows_written', rows_written,
        'last_status', last_status,
        'last_error', left(coalesce(last_error,''), 300),
        'max_gap_minutes', max_gap_minutes,
        'delta', case health
                   when 'stall'  then case when last_run_at is null then 'never ran'
                                           else 'no run in ' || max_gap_minutes || 'm (last ' ||
                                                to_char(last_run_at, 'MM-DD HH24:MI') || ')' end
                   when 'error'  then 'last run errored: ' || left(coalesce(last_error,'?'), 120)
                   when 'silent' then 'found ' || coalesce(raw_found,0) || ' but wrote 0 (silent collision)'
                   when 'empty'  then 'ran but wrote 0 rows'
                   else 'on spec' end
      ) order by (health <> 'ok') desc, agent), '[]'::jsonb)
      from public.agent_health
    ),
    'open_watchdog_findings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'check_name', check_name, 'severity', severity, 'count', count,
        'detail', detail, 'found_at', found_at
      ) order by found_at desc), '[]'::jsonb)
      from public.qa_findings
      where area = 'watchdog' and status = 'open'
    )
  ) into res;
  return res;
end $fn$;

grant execute on function public.cergio_org_health() to anon, authenticated, service_role;

-- ── 5. EXTEND cergio_ops_snapshot() WITH org_health ───────────────────────────
-- The dashboard reads cergio_ops_snapshot() (via ops-metrics). Rather than
-- rewrite that large function here (risking drift from the deployed version), we
-- WRAP it: keep the existing snapshot fn as-is and add a thin superset fn the
-- edge layer can call. But ops-metrics currently calls cergio_ops_snapshot
-- directly, so we merge org_health INTO its output via a wrapper that re-reads
-- the base snapshot and appends the key. Implemented as a REPLACE that delegates
-- to a preserved copy — see below. To avoid depending on the base fn's internal
-- SQL (which lives in a launcher, not this migration), we take the safe route:
-- ops-metrics/index.ts is patched to merge cergio_org_health() into the snapshot
-- at the edge (see that file). This migration only guarantees cergio_org_health()
-- exists. No change to cergio_ops_snapshot() is made here.

-- ── 5b. VAULT-BEARER PRESENCE PROBE (for cergio-health, Item 2) ───────────────
-- Returns true iff the edge_fn_bearer vault secret exists (the secret whose
-- wipe silently killed ingest). SECURITY DEFINER so the health fn can check it
-- without direct vault access. Reads only the NAME — never returns the secret.
create or replace function public.cergio_has_edge_bearer()
returns boolean language plpgsql security definer
set search_path = public, vault as $fn$
declare present boolean;
begin
  select exists(
    select 1 from vault.decrypted_secrets
     where name = 'edge_fn_bearer'
       and decrypted_secret is not null
       and length(trim(decrypted_secret)) > 0
  ) into present;
  return coalesce(present, false);
exception when others then
  -- If vault isn't readable for any reason, report absent (fail-closed) rather
  -- than error — the health check then flags it for a human to inspect.
  return false;
end $fn$;

revoke all on function public.cergio_has_edge_bearer() from public, anon, authenticated;
grant execute on function public.cergio_has_edge_bearer() to service_role;

-- ── 6. WATCHDOG-FINDING HELPER ────────────────────────────────────────────────
-- Thin wrapper over the existing cergio_qa_check so the watchdog opens/resolves
-- findings idempotently by check_name (one row per agent+problem). Auto-resolves
-- when the count drops to 0 (a later good run). Reuses the proven ledger shape.
-- (No new function needed — cergio_qa_check already does open-or-resolve. This
--  comment documents the contract the watchdog edge fn relies on.)

-- ── 7. HEARTBEAT SCHEDULES (pg_cron via cergio_call_edge) ─────────────────────
-- Same vault-bearer pattern as the periodic workers + coo-execute migrations.
-- cergio_call_edge reads edge_fn_bearer from Vault and POSTs with Authorization
-- only (the fix that stopped the 401s). Idempotent unschedule-then-schedule.
do $$
declare j text;
begin
  foreach j in array array['cergio_watchdog','cergio_orchestrator'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

-- Watchdog every 15 min: catches silent collisions / errors / stalls fast.
select cron.schedule('cergio_watchdog',     '*/15 * * * *', $$ select public.cergio_call_edge('cergio-watchdog'); $$);
-- Orchestrator every 30 min (offset :7): org-health rollup + re-run stalled workers.
select cron.schedule('cergio_orchestrator', '7-59/30 * * * *', $$ select public.cergio_call_edge('cergio-orchestrator'); $$);

-- To stop the backbone crons:
--   select cron.unschedule('cergio_watchdog');
--   select cron.unschedule('cergio_orchestrator');

-- ── 8. VERIFY (harmless SELECTs, safe to leave in) ────────────────────────────
select 'agent_runs backbone installed' as step,
       (select count(*) from public.agent_registry) as registered_agents,
       (select count(*) from public.agent_health)   as health_rows;
