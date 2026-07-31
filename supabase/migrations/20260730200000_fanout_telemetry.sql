-- SPEC-123: record what the fan-out actually did, from the server, every time.
--
-- Three real defects have been fixed in this chain today (the 503 notification
-- count, the dedupe guard swallowing repeats, geocode REQUEST_DENIED) and the
-- founder still receives nothing. The client-side console log that would say why
-- does not fire, so every diagnosis has been inference. This ends that.
--
-- SECURITY DEFINER so an ordinary signed-in user can write the finding, but it can
-- ONLY insert a fan-out diagnostic — nothing else. Called via supabase.rpc, which
-- is PostgREST: a failure here returns an error to the caller and can never tear
-- down the session (unlike functions.invoke, which signed the founder out earlier).
create or replace function public.cergio_log_fanout(
  p_request_id uuid,
  p_outcome    text,
  p_detail     text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.cergio_qa_check(
    'live',
    'fanout-outcome',
    case when p_outcome = 'notified' then 'high' else 'critical' end,
    case when p_outcome = 'notified' then 0 else 1 end,
    left(coalesce('request ' || p_request_id::text || ' -> ' || p_outcome ||
         coalesce(' | ' || p_detail, ''), 'fanout'), 400)
  );
exception when others then
  null;   -- telemetry must never break the user's request
end $$;

grant execute on function public.cergio_log_fanout(uuid, text, text) to authenticated;
