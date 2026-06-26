-- Claim-profile flow (Tarik 2026-06-26): when a recommended provider signs up,
-- attach the pending recommendations that were made to their phone number to
-- their new account. Recos written via the invite/reco-by-phone flow carry
-- `recipient_phone` with a NULL `recipient_id`; this claims them by matching the
-- caller's signup phone (last 10 digits, format-insensitive). SECURITY DEFINER
-- so it can read auth.users.phone + update rows the caller doesn't yet own;
-- scoped strictly to the caller's own phone match.

create or replace function public.claim_recommendations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text;
  v_d10   text;
  v_n     integer := 0;
begin
  if v_uid is null then return 0; end if;

  select regexp_replace(coalesce(phone, ''), '\D', '', 'g') into v_phone
  from auth.users where id = v_uid;
  if v_phone is null or length(v_phone) < 7 then return 0; end if;
  v_d10 := right(v_phone, 10);

  update public.recommendations r
     set recipient_id = v_uid
   where r.recipient_id is null
     and r.recipient_phone is not null
     and right(regexp_replace(r.recipient_phone, '\D', '', 'g'), 10) = v_d10;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.claim_recommendations() from public;
grant execute on function public.claim_recommendations() to authenticated;
