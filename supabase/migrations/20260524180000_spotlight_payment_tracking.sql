-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio v11 — Spotlight payment tracking.
-- When a spotlight_request hits status='accepted', the provider needs to
-- pay before the Connector posts. We track that here so the UI can show
-- "Pay to confirm" vs "Paid ✓" and the webhook can flip paid_at on a
-- payment_intent.succeeded carrying a `spotlight_request_id` in metadata.
-- Idempotent: safe to run more than once.
-- Run after v1..v10 in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.spotlight_requests
  add column if not exists paid_at           timestamptz,
  add column if not exists payment_intent_id text,
  -- Snapshot of the actual fee/seller split at payment time so reporting
  -- doesn't drift if PLATFORM_FEE_RATE ever changes.
  add column if not exists platform_fee_cents integer  check (platform_fee_cents is null or platform_fee_cents >= 0);

create index if not exists spotlight_requests_paid_idx
  on public.spotlight_requests (paid_at desc)
  where paid_at is not null;

-- Unique lookup for the webhook (payment_intent_id → spotlight_request).
create unique index if not exists spotlight_requests_pi_idx
  on public.spotlight_requests (payment_intent_id)
  where payment_intent_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of v11. After running:
--   1. Verify columns appear in Table Editor → spotlight_requests.
--   2. Provider sees "Pay $X to confirm" button on OutboundCard when
--      status='accepted' AND paid_at IS NULL.
--   3. stripe-webhook (extended in same PR) flips paid_at on
--      payment_intent.succeeded carrying metadata.spotlight_request_id.
-- ─────────────────────────────────────────────────────────────────────────────
