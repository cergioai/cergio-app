-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — SPEC-47g: held funds + 3-hour auto-release for PAID bookings.
--
-- Today (instant): paid bookings use a Stripe DESTINATION charge, so the
-- provider is paid the moment the customer pays. SPEC-47g changes this to an
-- ESCROW model — funds are charged to the PLATFORM and held, then released to
-- the provider 3 hours after the provider marks the job complete. GUARD: if the
-- provider marks complete BEFORE the scheduled start time, we do NOT auto-
-- release; the consumer must confirm the job actually happened first.
--
-- ROLLOUT IS STAGED + SAFE: this migration only ADDS columns (no behavior
-- change). The held-vs-instant choice is gated by the edge-function env var
-- HOLD_RELEASE_ENABLED. Until that is 'true', payments stay instant and these
-- columns sit unused. The release worker only ever touches rows that were
-- charged in held mode (transfer_group IS NOT NULL), so instant-mode bookings
-- can never be double-paid.
--
-- Idempotent: safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.bookings
  add column if not exists released_at             timestamptz,           -- when funds were transferred to the provider
  add column if not exists release_due_at          timestamptz,           -- when the 3h window elapses (eligible to release)
  add column if not exists release_requires_confirm boolean default false,-- provider completed before start → consumer must confirm
  add column if not exists consumer_confirmed_at   timestamptz,           -- consumer confirmed the job was done
  add column if not exists transfer_group          text,                  -- Stripe transfer_group (set only in held mode)
  add column if not exists stripe_charge_id        text,                  -- the charge to transfer FROM (source_transaction)
  add column if not exists stripe_transfer_id      text,                  -- the Transfer created at release (idempotency guard)
  add column if not exists release_error           text;                  -- last release error, if any (for ops visibility)

-- Fast lookup for the release worker: rows that are held, paid, due, unreleased.
create index if not exists bookings_release_due_idx
  on public.bookings (release_due_at)
  where transfer_group is not null
    and stripe_transfer_id is null
    and released_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL — automatic schedule (enable when you flip HOLD_RELEASE_ENABLED on).
-- The release work calls Stripe, so it lives in the `release-funds` edge
-- function; pg_cron invokes it via pg_net. This needs the service-role key
-- available to the cron call. To avoid committing secrets, store it once in
-- Vault, then UNCOMMENT and run this block:
--
--   -- one time: insert into vault.secrets (name, secret)
--   --   values ('release_funds_bearer', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>');
--
--   create extension if not exists pg_cron with schema extensions;
--   create extension if not exists pg_net  with schema extensions;
--   do $$ begin
--     if exists (select 1 from cron.job where jobname = 'release_due_booking_funds') then
--       perform cron.unschedule('release_due_booking_funds');
--     end if;
--   end $$;
--   select cron.schedule(
--     'release_due_booking_funds',
--     '*/15 * * * *',                          -- every 15 minutes
--     $cron$
--       select net.http_post(
--         url     := 'https://vjmwnbftfquyquwaklue.functions.supabase.co/release-funds',
--         headers := jsonb_build_object(
--           'Content-Type','application/json',
--           'Authorization', (select decrypted_secret from vault.decrypted_secrets where name = 'release_funds_bearer')
--         ),
--         body := '{}'::jsonb
--       );
--     $cron$
--   );
--
-- Until then, run the funds release on demand with the
-- "Release Due Funds.command" launcher.
-- ─────────────────────────────────────────────────────────────────────────────
