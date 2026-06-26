-- Referral settlement — the canonical, server-authoritative credit path
-- (Tarik 2026-06-26: "the heart of the growth engine — a disaster if users
-- can't get paid / tracked"). Replaces the best-effort client-side math.
--
-- Economics (Tarik-confirmed 2026-06-26):
--   • 1st tier (direct): 7% of EACH paid booking by your invitee, ACCUMULATING,
--     capped $250 per friend (per invitee).
--   • 2nd tier (fof/chain): 0.5% of each paid booking by your friend-of-friend,
--     ACCUMULATING, capped $12.50 per friend-of-friend (= 5% of the $250 tier).
--   • Depth 2 only (the great-grandparent never earns).
--
-- Properties:
--   • Idempotent — at most one row per (earner, booking, tier); safe to call
--     from the Stripe webhook AND the client without double-crediting.
--   • Guarded — only credits when the booking is actually PAID (paid_at) and
--     total > 0; safe to call for any booking id.
--   • status='cleared' — referral credit is platform credit we already owe once
--     the booking is paid, so it counts as EARNED immediately (not perpetually
--     'pending'). Cash-out for Connectors stays the existing payout request.

create or replace function public.credit_referral_for_booking(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consumer uuid;
  v_total    bigint;
  v_paid     timestamptz;
  v_inviter  uuid; v_invite uuid;
  v_gp       uuid; v_gp_invite uuid;
  v_prior    bigint; v_gross bigint; v_credit bigint;
  v_friend   text;
  c_cap_direct constant bigint := 25000;  -- $250.00
  c_cap_fof    constant bigint := 1250;   -- $12.50
  c_pct_direct constant numeric := 0.07;  -- 7%
  c_pct_fof    constant numeric := 0.005; -- 0.5%
begin
  select consumer_id, coalesce(total_cents,0), paid_at
    into v_consumer, v_total, v_paid
  from public.bookings where id = p_booking;

  -- Only paid, non-zero bookings earn referral credit.
  if v_consumer is null or v_paid is null or v_total <= 0 then return; end if;

  -- Direct inviter of the consumer.
  select id, inviter_id into v_invite, v_inviter
  from public.invites where invitee_id = v_consumer order by joined_at nulls last limit 1;

  if v_inviter is not null and v_inviter <> v_consumer then
    -- 1st tier — 7%/booking, cap $250 per friend (accumulating), idempotent per booking.
    if not exists (
      select 1 from public.earnings
      where profile_id = v_inviter and kind='invite'
        and meta->>'booking_id' = p_booking::text and meta->>'tier' = 'direct'
    ) then
      select coalesce(sum(amount_cents),0) into v_prior from public.earnings
        where profile_id = v_inviter and kind='invite'
          and meta->>'tier'='direct' and meta->>'invitee_id' = v_consumer::text;
      v_gross  := floor(v_total * c_pct_direct);
      v_credit := least(v_gross, greatest(0, c_cap_direct - v_prior));
      if v_credit > 0 then
        select display_name into v_friend from public.profiles where id = v_consumer;
        insert into public.earnings(profile_id, kind, source_id, amount_cents, status, meta)
        values (v_inviter, 'invite', v_invite, v_credit, 'cleared',
          jsonb_build_object('booking_id', p_booking::text, 'booking_total_cents', v_total,
                             'invitee_id', v_consumer::text, 'tier', 'direct', 'friend', v_friend));
      end if;
    end if;

    -- 2nd tier — grandparent (the inviter's inviter). 0.5%/booking, cap $12.50
    -- per friend-of-friend (accumulating), idempotent per booking. Depth 2 only.
    select id, inviter_id into v_gp_invite, v_gp
    from public.invites where invitee_id = v_inviter order by joined_at nulls last limit 1;

    if v_gp is not null and v_gp <> v_inviter and v_gp <> v_consumer then
      if not exists (
        select 1 from public.earnings
        where profile_id = v_gp and kind='invite'
          and meta->>'booking_id' = p_booking::text and meta->>'tier' = 'fof'
      ) then
        select coalesce(sum(amount_cents),0) into v_prior from public.earnings
          where profile_id = v_gp and kind='invite'
            and meta->>'tier'='fof' and meta->>'invitee_id' = v_consumer::text;
        v_gross  := floor(v_total * c_pct_fof);
        v_credit := least(v_gross, greatest(0, c_cap_fof - v_prior));
        if v_credit > 0 then
          insert into public.earnings(profile_id, kind, source_id, amount_cents, status, meta)
          values (v_gp, 'invite', v_gp_invite, v_credit, 'cleared',
            jsonb_build_object('booking_id', p_booking::text, 'booking_total_cents', v_total,
                               'invitee_id', v_consumer::text, 'via_inviter_id', v_inviter::text, 'tier', 'fof'));
        end if;
      end if;
    end if;
  end if;

  -- Analytics: stamp first_booking_at (no longer a credit gate).
  update public.invites set first_booking_at = coalesce(first_booking_at, now())
   where invitee_id = v_consumer and first_booking_at is null;
end;
$$;

revoke all on function public.credit_referral_for_booking(uuid) from public;
grant execute on function public.credit_referral_for_booking(uuid) to authenticated, service_role;
