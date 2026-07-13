-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — Autonomous COO execution layer.
--
-- Makes on-spec + reversible proposals EXECUTE themselves; only off-spec / human-
-- only proposals reach the founder. Companion to edge fn `coo-execute`.
--
-- Everything here is idempotent and additive (nullable columns, IF NOT EXISTS,
-- CREATE OR REPLACE). No destructive change. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Classification + executable action columns on coo_proposals ---------------
--    (nullable, safe defaults → existing rows read as "human-only", never
--     accidentally auto-executed).
alter table public.coo_proposals add column if not exists on_spec           boolean default false;
alter table public.coo_proposals add column if not exists action_kind       text    default 'none';   -- 'sql' | 'edge_call' | 'none'
alter table public.coo_proposals add column if not exists action_payload    text    default '';
alter table public.coo_proposals add column if not exists requires_approval boolean default true;      -- default: founder must approve
alter table public.coo_proposals add column if not exists executed_at       timestamptz;
alter table public.coo_proposals add column if not exists result            text;

-- Backfill any pre-existing rows to the safe (human-only) posture.
update public.coo_proposals
   set requires_approval = true
 where requires_approval is null;

-- 2. Append-style execution log (per-action audit + impact) --------------------
--    Distinct from impact_ledger (which is a daily ROLLUP keyed by day). This
--    records EACH autonomous action with before/after or affected-row count so
--    the dashboard can show "what the COO did and the result".
create table if not exists public.coo_execution_log (
  id           bigserial primary key,
  created_at   timestamptz default now(),
  proposal_id  bigint,
  division     text,
  title        text,
  action_kind  text,
  action_payload text,
  status       text,            -- 'executed' | 'failed'
  affected     int,             -- affected-row count (sql) or null (edge_call)
  result       text,            -- human-readable outcome / error text
  before_json  jsonb,
  after_json   jsonb
);

-- 3. Locked-down SQL executor (defense-in-depth; the edge fn also allowlists) ---
--    SECURITY DEFINER so the edge fn can run a single reversible statement and
--    get the affected-row count back. This function itself HARD-REFUSES any
--    prohibited verb, so even a bug in the edge fn cannot run a destructive stmt.
create or replace function public.cergio_coo_exec_sql(stmt text)
returns integer language plpgsql security definer
set search_path = public as $fn$
declare
  n integer;
  s text := lower(coalesce(stmt, ''));
begin
  -- Must be exactly one statement (no stacking).
  if position(';' in rtrim(stmt, ' ' || chr(10) || chr(9) || ';')) > 0 then
    raise exception 'coo_exec_sql: multiple statements are not allowed';
  end if;
  -- Must be an UPDATE (the only reversible write shape we permit here).
  if s !~ '^\s*update\s' then
    raise exception 'coo_exec_sql: only single UPDATE statements are permitted';
  end if;
  -- Hard-deny irreversible / privileged / send / auth verbs anywhere in the text.
  if s ~ '(delete|drop|truncate|grant|revoke|alter\s+role|alter\s+table|create\s|insert\s|update\s+auth\.|auth\.|storage\.|vault\.|pg_catalog|information_schema|copy\s|call\s|do\s+\$|;\s*\S)' then
    raise exception 'coo_exec_sql: statement contains a prohibited verb/target';
  end if;
  -- Only these safe tables may be written.
  if s !~ '^\s*update\s+(public\.)?(leads_services|leads_influencers)\s' then
    raise exception 'coo_exec_sql: only leads_services / leads_influencers may be updated';
  end if;
  -- Must be scoped (a WHERE clause) so it can never rewrite an entire table.
  if s !~ '\swhere\s' then
    raise exception 'coo_exec_sql: UPDATE must have a WHERE clause';
  end if;

  execute stmt;
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.cergio_coo_exec_sql(text) from public, anon, authenticated;
grant execute on function public.cergio_coo_exec_sql(text) to service_role;

-- 4. Schedule coo-execute on pg_cron (every 10 min, offset from coo-brain). -----
--    Same cergio_call_edge / vault pattern as the periodic workers migration.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cergio_coo_execute') then
    perform cron.unschedule('cergio_coo_execute');
  end if;
end $$;

-- coo-brain typically runs on the hour; run the executor at :05,:15,... offset.
select cron.schedule('cergio_coo_execute', '5-59/10 * * * *', $$ select public.cergio_call_edge('coo-execute'); $$);

-- To stop: select cron.unschedule('cergio_coo_execute');
