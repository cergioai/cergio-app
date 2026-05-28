-- 2026-05-28 — requests table for the consumer search → provider notify chain
--
-- Closes the loop the 2026-05-28 audit (TEST_PLAN_MONEY_FLOWS.md) opened:
--   • F2 verified that a `notifications` row with deep_link lands when we
--     INSERT one. But nothing actually INSERTS one at search time.
--   • The notifications row references data->>'request_id' so the SRP
--     activity hook (useRequestActivity) knows what to poll. That id
--     has nowhere to live yet — this migration gives it a home.
--
-- A `requests` row is the durable representation of a consumer's open
-- search: who, what (provider_type + query), where (lat/lng + text),
-- when (text from the chat), budget (cents). It is the anchor every
-- notification + bid + first-booking-credit hangs off.
--
-- Idempotent: re-running is a no-op.

begin;

create table if not exists requests (
  id              uuid primary key default gen_random_uuid(),
  consumer_id     uuid not null references auth.users(id) on delete cascade,
  query           text not null,            -- the user's raw words ("unclog my toilet")
  provider_type   text,                     -- resolved canonical type ("Plumber")
  category        text,
  what            text,                     -- parser's normalized 'what'
  when_text       text,                     -- parser's normalized 'when'
  where_text      text,                     -- parser's normalized 'where' / address
  lat             double precision,
  lng             double precision,
  budget_cents    integer check (budget_cents is null or budget_cents >= 0),
  status          text not null default 'open'
                  check (status in ('open','expired','cancelled','fulfilled')),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create index if not exists requests_consumer_created_idx
  on requests (consumer_id, created_at desc);
create index if not exists requests_open_provider_type_idx
  on requests (provider_type, status) where status = 'open';

alter table requests enable row level security;

drop policy if exists "self read"  on requests;
drop policy if exists "self write" on requests;
drop policy if exists "self upd"   on requests;
create policy "self read"  on requests for select using (auth.uid() = consumer_id);
create policy "self write" on requests for insert with check (auth.uid() = consumer_id);
create policy "self upd"   on requests for update using (auth.uid() = consumer_id);

-- Sanity readback
select 'requests' as t, count(*) as c from requests;

commit;
