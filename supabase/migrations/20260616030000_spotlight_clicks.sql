-- IG post performance (Tarik 2026-06-16): count clicks on a Connector's unique
-- spotlight link (cergio.ai/i/{code}?s={bookingId}) so BOTH the Connector and
-- the service/provider can see how the post performed. One counter on the
-- booking serves both parties (the booking ties the Connector ↔ the service).
-- Supersedes verify_spotlight: record_spotlight_click both increments the count
-- AND stamps verified-live. Anonymous clicker → SECURITY DEFINER RPC.
alter table public.bookings
  add column if not exists spotlight_clicks integer not null default 0;

create or replace function public.record_spotlight_click(p_booking uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bookings
     set spotlight_clicks       = coalesce(spotlight_clicks, 0) + 1,
         spotlight_verified_at  = coalesce(spotlight_verified_at, now())
   where id = p_booking
     and is_free_for_rainmaker = true;
$$;

grant execute on function public.record_spotlight_click(uuid) to anon, authenticated;
