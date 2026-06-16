-- Per-spotlight click-audit (Tarik 2026-06-15): when someone taps a Connector's
-- unique spotlight link (cergio.ai/i/{code}?s={bookingId}), we stamp that
-- booking's spotlight as "verified live" — proof the link is in the post and
-- working. The clicker is anonymous (not a party to the booking), so we expose
-- a SECURITY DEFINER RPC. Soft signal only (the provider still accepts the post).
alter table public.bookings
  add column if not exists spotlight_verified_at timestamptz;

create or replace function public.verify_spotlight(p_booking uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bookings
     set spotlight_verified_at = coalesce(spotlight_verified_at, now())
   where id = p_booking
     and is_free_for_rainmaker = true;
$$;

grant execute on function public.verify_spotlight(uuid) to anon, authenticated;
