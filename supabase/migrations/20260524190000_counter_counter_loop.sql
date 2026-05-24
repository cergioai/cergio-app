-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio v12 — Counter-counter loop on spotlight requests.
-- Tracks which party made the most recent offer so the UI can show the
-- "Counter back" button to whoever's turn it is.
--   last_counter_by = 'connector' → Provider's turn (they can Accept/Counter/Decline)
--   last_counter_by = 'provider'  → Connector's turn (they can Accept/Counter/Decline)
--   NULL → no counter yet (Connector still considering the initial Provider request)
-- Idempotent: safe to run more than once.
-- Run after v1..v11 in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.spotlight_requests
  add column if not exists last_counter_by text
    check (last_counter_by is null or last_counter_by in ('provider','connector'));

create index if not exists spotlight_requests_last_counter_idx
  on public.spotlight_requests (last_counter_by)
  where last_counter_by is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- End of v12. After running:
--   1. Existing 'countered' rows backfill with 'connector' since that was
--      the only party who could counter before v12.
-- ─────────────────────────────────────────────────────────────────────────────

update public.spotlight_requests
   set last_counter_by = 'connector'
 where status = 'countered'
   and last_counter_by is null;
