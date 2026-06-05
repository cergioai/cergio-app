-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio v16 — free-swap spotlights must not auto-expire as "unpaid".
--
-- BUG: expire_unpaid_spotlight_requests() (v15) flips ANY accepted request
-- with paid_at IS NULL to 'expired' after 24h. Free swaps ($0 effective
-- price — service in exchange for the post) never get paid by design, so
-- every accepted free spotlight silently expired a day later, killing the
-- barter flow end-to-end.
--
-- FIX: only expire requests with a real price on the table.
-- Also: rescue any free-swap rows the old sweep already expired (accepted
-- semantics restored so the parties can finish the post/confirm steps).
-- Idempotent: safe to run more than once. Run after v15.
-- ─────────────────────────────────────────────────────────────────────────────

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
     and responded_at   < now() - interval '24 hours'
     -- free swap (effective price 0) never requires payment — exempt:
     and coalesce(offered_price_cents, official_price_cents, 0) > 0;
end;
$$;

-- Rescue: free-swap rows wrongly expired by the v15 sweep go back to
-- 'accepted' (only ones never posted/confirmed/cancelled — i.e. rows the
-- sweep itself flipped, not ones a human resolved).
update public.spotlight_requests
   set status = 'accepted'
 where status = 'expired'
   and paid_at is null
   and coalesce(offered_price_cents, official_price_cents, 0) = 0;
