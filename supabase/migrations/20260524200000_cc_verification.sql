-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio v13 — Stripe Customer + CC identity verification on profiles.
-- Used to gate "photo upload on chat submit" behind a no-charge SetupIntent
-- (anti-abuse). Also reusable for future paid features that want the user's
-- card on file (saved bookings, instant cash-out fee, etc.).
--   stripe_customer_id → from stripe.customers.create()
--   cc_verified_at     → stamped when a SetupIntent.succeeded webhook lands
--                         (or by the frontend on optimistic success — webhook
--                         is the source of truth)
-- Idempotent: safe to run more than once.
-- Run after v1..v12 in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists cc_verified_at     timestamptz;

create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists profiles_cc_verified_idx
  on public.profiles (cc_verified_at desc)
  where cc_verified_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of v13.
-- ─────────────────────────────────────────────────────────────────────────────
