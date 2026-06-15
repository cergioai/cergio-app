-- Provider "mark job complete" (Tarik 2026-06-15). A distinct timestamp from
-- post_confirmed_at: completed_at = the service was delivered (provider marks
-- it, even before/at the start), which nudges the Connector to post the IG
-- spotlight and starts the paid auto-release window. The barter still only
-- closes when post_confirmed_at is set.
alter table public.bookings
  add column if not exists completed_at timestamptz;
