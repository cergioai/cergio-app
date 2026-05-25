-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio v15 — 24h timeout on unpaid accepted spotlight requests.
-- A Connector accepts → Provider has 24h to pay → if no payment, request
-- auto-expires so the Provider isn't blocked and the Connector isn't left
-- hanging. Uses pg_cron (Postgres scheduler that ships with Supabase).
-- Idempotent: safe to run more than once.
-- Run after v1..v14 in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- pg_cron must be enabled at the DB level. On Supabase it's pre-installed
-- but the extension itself needs explicit enable. Wrap in `create extension
-- if not exists` so re-runs are safe.
create extension if not exists pg_cron with schema extensions;

-- Hourly sweep: any accepted+unpaid spotlight request older than 24h flips
-- to 'expired'. We base the timeout on responded_at (when the Connector
-- accepted) — not created_at — so the clock starts when the Provider was
-- actually asked to pay.
--
-- We use security definer + service_role bypass so the cron job (which runs
-- as postgres superuser) can update rows under RLS.
create or replace function public.expire_unpaid_spotlight_requests()
returns void
language plpgsql
security definer
as $$
begin
  update public.spotlight_requests
     set status         = 'expired',
         responded_at   = now()
   where status         = 'accepted'
     and paid_at        is null
     and responded_at   is not null
     and responded_at   < now() - interval '24 hours';
end;
$$;

-- Schedule the sweep. Drop any prior schedule to keep this idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire_unpaid_spotlights') then
    perform cron.unschedule('expire_unpaid_spotlights');
  end if;
end $$;

select cron.schedule(
  'expire_unpaid_spotlights',
  '0 * * * *',          -- top of every hour
  $$ select public.expire_unpaid_spotlight_requests(); $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- End of v15. After running:
--   1. cron.job table should have a row named 'expire_unpaid_spotlights'.
--   2. The next top-of-the-hour will sweep any aged-out unpaid requests.
--   3. To test immediately: call public.expire_unpaid_spotlight_requests()
--      manually in the SQL editor after seeding an old row.
-- ─────────────────────────────────────────────────────────────────────────────
