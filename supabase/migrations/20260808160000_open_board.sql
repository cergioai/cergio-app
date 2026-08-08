-- SPEC-279 / FW-25 — THE OPEN BOARD (founder, 2026-08-08, verbatim):
-- "add option for creator and service who receive a msg to join the barter to
--  Optin and Post a request (eg: need a driver tuesday .. ) ... Publish OPEN
--  requests (both from users and from creators on the site.. for everyone to
--  browse)... add ability to filter by type data ... uses will see posts that
--  are around their location ..combine both feeds (optins from services and
--  creators .. and specific jobs open requests...services can accept specific
--  jobs .. by clicking accept.. (but the booking isn't confirmed until the user
--  actually books ...for optin acceptance requests without a specific request
--  posted, show 'flexible' click to suggest a service"
--
-- ONE FEED, ONE TABLE. The founder asked to COMBINE two feeds, so they are two
-- KINDS of the same row, not two tables:
--   kind='job'   — a specific open request ("need a driver Tuesday")
--   kind='optin' — someone opted into the barter with nothing specific yet;
--                  the board renders it as FLEXIBLE and the only action is
--                  "suggest a service".
-- Two tables would have meant two queries, two RLS surfaces, two response
-- models and a merge step that drifts — and the responses land in the SAME
-- request_responses inbox either way.
--
-- WHY NO new RLS: `requests` already carries "providers read open" (from
-- 20260613000000) — status='pending' and auth.uid() <> requester_id — so any
-- signed-in user can already read every open request. Publishing the board is
-- therefore a QUERY change, not a permission change. The board excludes rows
-- with target_provider_id set: a quote aimed at ONE provider is not a public
-- post, and it must not appear on a browse surface just because RLS is broad.
--
-- poster_role records which SIDE of the barter posted, so the feed can badge it
-- and filter on it. It is NOT derived at read time from profile shape: a
-- provider who also has an IG handle would flip sides on us, and the badge on a
-- post must mean what it meant when it was posted.

alter table public.requests
  add column if not exists kind        text not null default 'job',
  add column if not exists poster_role text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'requests_kind_chk') then
    alter table public.requests
      add constraint requests_kind_chk check (kind in ('job', 'optin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'requests_poster_role_chk') then
    alter table public.requests
      add constraint requests_poster_role_chk
      check (poster_role is null or poster_role in ('service', 'creator'));
  end if;
end $$;

-- The board query is (status, kind, created_at desc) with target_provider_id
-- null. Partial on 'pending' because a closed request is never browsed.
create index if not exists requests_open_board_idx
  on public.requests (kind, created_at desc)
  where status = 'pending' and target_provider_id is null;

comment on column public.requests.kind is
  'job = a specific open request; optin = "I am open to barter", rendered FLEXIBLE on the open board (SPEC-279).';
comment on column public.requests.poster_role is
  'service | creator — which side of the barter posted this. Recorded at post time, never re-derived from profile shape (SPEC-279).';
