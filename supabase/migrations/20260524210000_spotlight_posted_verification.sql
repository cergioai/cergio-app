-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio v14 — Spotlight Posted verification + funds release.
-- After payment lands (v11), the Connector posts the spotlight on IG/TT
-- and marks it done with the post URL. Provider gets a "confirm post"
-- email and reviews. If they confirm (or don't dispute within X days),
-- funds release. Adds:
--   posted_at      — Connector tapped "Mark as posted"
--   posted_url     — URL of the IG/TT post
--   confirmed_at   — Provider tapped "Confirm post" OR auto-confirmed at
--                    timeout (handled by a future scheduled function)
--   released_at    — when funds were treated as released (today this just
--                    equals confirmed_at since Stripe Connect already
--                    transferred on payment_intent.succeeded; later when
--                    we move to manual transfers / escrow, this drives
--                    the actual stripe.transfers.create call)
-- Idempotent: safe to run more than once.
-- Run after v1..v13 in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.spotlight_requests
  add column if not exists posted_at     timestamptz,
  add column if not exists posted_url    text,
  add column if not exists confirmed_at  timestamptz,
  add column if not exists released_at   timestamptz;

create index if not exists spotlight_requests_posted_idx
  on public.spotlight_requests (posted_at desc)
  where posted_at is not null;

create index if not exists spotlight_requests_released_idx
  on public.spotlight_requests (released_at desc)
  where released_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of v14.
-- ─────────────────────────────────────────────────────────────────────────────
