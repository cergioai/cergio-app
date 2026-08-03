-- SPEC-247 (2026-08-02, founder approved: "ok" on the booking-loop CI subagent's
-- run-1 finding): harden accept_request_with_time SERVER-SIDE.
--
-- THE FINDING (night-fleet, booking-loop agent, 2026-08-02 23:47Z): the RPC
-- verified only "caller owns the service" — nothing about the caller's
-- relationship to THIS request. Any authenticated service owner could accept
-- ANY request id and mint a confirmed booking + notification for that consumer.
-- The agent's proposed CLIENT guard (requester_id === uid) was aimed at the
-- wrong side — the accepter is the PROVIDER, never the requester, so that exact
-- guard would have bricked the whole accept flow. The correct wall is HERE, in
-- the SECURITY DEFINER function, where a direct API caller cannot skip it.
--
-- Three additions, everything else byte-equivalent to 20260616020000:
--   1. SELF-ACCEPT BLOCK — the requester cannot accept their own request
--      through a service they own (self-booking mints garbage rows + notifies
--      themselves).
--   2. SERVER-SIDE IDEMPOTENCY (SPEC-128 finally enforced where it belongs) —
--      the duplicate-booking guard lived ONLY in the app; anyone calling the
--      RPC directly (or a UI race that slipped the client map) still created
--      duplicates. If this provider already accepted this request with this
--      service and an active booking exists, RETURN that booking, don't mint
--      another. Detection uses request_responses (request_id, responder_id,
--      service_id) — written by every prior accept — because bookings carries
--      no request_id column in any committed migration, and referencing a
--      column this schema may not have would fail the whole migration run.
--   3. No behavioural change for the legitimate first accept: same insert,
--      same response upsert, same return.
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

  -- SPEC-247 #1: a requester accepting their own request is never legitimate.
  if v_requester = auth.uid() then
    raise exception 'cannot accept your own request';
  end if;

  -- SPEC-247 #2: repeat accept by the same provider+service returns the
  -- existing active booking instead of minting a duplicate (server-side
  -- SPEC-128; the client map cannot protect a direct API caller).
  if exists (
    select 1 from public.request_responses
    where request_id = p_request_id
      and responder_id = auth.uid()
      and service_id = p_service_id
  ) then
    select id into v_booking from public.bookings
    where provider_id = auth.uid()
      and consumer_id = v_requester
      and service_id = p_service_id
      and status not in ('cancelled', 'declined', 'expired')
    order by created_at desc
    limit 1;
    if v_booking is not null then
      return v_booking;
    end if;
  end if;

  insert into public.bookings
    (consumer_id, provider_id, service_id, status, scheduled_at,
     schedule_confirmed_at, is_free_for_rainmaker, total_cents)
  values
    (v_requester, auth.uid(), p_service_id, 'confirmed',
     coalesce(p_scheduled_at, now() + interval '1 day'), now(), true, 0)
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
