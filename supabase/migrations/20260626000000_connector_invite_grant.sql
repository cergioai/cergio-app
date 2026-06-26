-- Connectors invite Connectors (Tarik 2026-06-26).
-- A VERIFIED Connector shares a `?c=1` invite link; on signup the new user is
-- auto-granted Connector status. GUARDED + SECURITY DEFINER so a forged ?c=1
-- from a non-Connector cannot self-promote: the grant only happens when the
-- INVITER is actually a verified Connector, and only upgrades a caller who is
-- not already one.

create or replace function public.grant_connector_from_invite(p_inviter uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_inviter_ok boolean;
begin
  if v_caller is null or p_inviter is null or p_inviter = v_caller then
    return false;
  end if;

  -- The inviter must be a verified Connector for the grant to apply.
  select (cc_verified_at is not null) into v_inviter_ok
  from public.profiles where id = p_inviter;
  if not coalesce(v_inviter_ok, false) then
    return false;
  end if;

  -- Upgrade the caller only if they aren't already a Connector.
  update public.profiles
     set cc_verified_at = coalesce(cc_verified_at, now()),
         role           = coalesce(nullif(role, ''), 'connector')
   where id = v_caller
     and cc_verified_at is null;

  return found;
end;
$$;

revoke all on function public.grant_connector_from_invite(uuid) from public;
grant execute on function public.grant_connector_from_invite(uuid) to authenticated;
