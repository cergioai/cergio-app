-- Provider accepts a Connector's free-service request AND picks a time, in one
-- step → a CONFIRMED booking at that time (Tarik 2026-06-16). The provider is
-- creating a booking on the Connector's behalf, so it goes through a SECURITY
-- DEFINER RPC (verifies the caller owns the service). Either party can
-- reschedule afterwards. Returns the new booking id.
create or replace function public.accept_request_with_time(
  p_request_id uuid,
  p_service_id uuid,
  p_scheduled_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_owner     uuid;
  v_booking   uuid;
begin
  select requester_id into v_requester from public.requests where id = p_request_id;
  if v_requester is null then raise exception 'request not found'; end if;

  select owner_id into v_owner from public.services where id = p_service_id;
  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'not your service';
  end if;

  insert into public.bookings
    (consumer_id, provider_id, service_id, status, scheduled_at,
     schedule_confirmed_at, is_free_for_rainmaker)
  values
    (v_requester, auth.uid(), p_service_id, 'confirmed',
     coalesce(p_scheduled_at, now() + interval '1 day'), now(), true)
  returning id into v_booking;

  -- Mark the request handled so it leaves the provider's "new requests".
  insert into public.request_responses
    (request_id, responder_id, service_id, status, responded_at)
  values (p_request_id, auth.uid(), p_service_id, 'offered', now())
  on conflict (request_id, responder_id, service_id)
    do update set status = 'offered', responded_at = now();

  return v_booking;
end;
$$;

grant execute on function public.accept_request_with_time(uuid, uuid, timestamptz) to authenticated;
