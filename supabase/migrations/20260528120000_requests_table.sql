-- 2026-05-28 — extend the existing `requests` table for the consumer
-- search → provider notify chain.
--
-- The table already exists (db/schema-v1.sql) with:
--   id, requester_id, target_provider_id, service_type, description,
--   scheduled_at, location_text, status, is_free_for_rainmaker,
--   expires_at, booking_id, created_at
--
-- We don't replace it — we ADD the columns the money-flow plan needs:
--   query, provider_type, category, what, when_text, lat, lng, budget_cents
-- and trust the existing requester_id (NOT consumer_id) as the FK.
--
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE. Re-running
-- is a no-op. RLS policies use the canonical requester_id column.

begin;

alter table requests
  add column if not exists query         text,
  add column if not exists provider_type text,
  add column if not exists category      text,
  add column if not exists what          text,
  add column if not exists when_text     text,
  add column if not exists lat           double precision,
  add column if not exists lng           double precision,
  add column if not exists budget_cents  integer;

-- Soft check: budget_cents must be >= 0 when set. Best-effort — if the
-- constraint already exists from a prior run, skip silently.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'requests_budget_cents_nonneg'
       and conrelid = 'requests'::regclass
  ) then
    alter table requests
      add constraint requests_budget_cents_nonneg
        check (budget_cents is null or budget_cents >= 0);
  end if;
end$$;

create index if not exists requests_requester_created_idx
  on requests (requester_id, created_at desc);
create index if not exists requests_open_provider_type_idx
  on requests (provider_type, status) where status = 'pending';

-- Make sure RLS is on, then keep ONLY policies that reference real columns
-- (requester_id). Re-create idempotently.
alter table requests enable row level security;

drop policy if exists "self read"  on requests;
drop policy if exists "self write" on requests;
drop policy if exists "self upd"   on requests;
create policy "self read"  on requests for select using (auth.uid() = requester_id);
create policy "self write" on requests for insert with check (auth.uid() = requester_id);
create policy "self upd"   on requests for update using (auth.uid() = requester_id);

-- Sanity readback
select 'requests' as t, count(*) as c from requests;

commit;
