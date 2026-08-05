-- 2026-08-05 — SPEC: photos and video on a request.
--
-- WHY: the booking flow replaced the bedrooms/toggles configure step with a
-- free-form request box plus "Add photos or video". The text lands in
-- requests.description (and the chat-parse structured fields), but the media
-- had nowhere to go.
--
-- One row per uploaded file, ordered for the gallery. Storage lives in a
-- `request-media` bucket that is NOT public — a request's photos are between
-- the requester and the providers who can see the request, so reads go through
-- signed URLs. Ownership on write is the same UUID-prefix rule the other
-- buckets use.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.request_attachments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,           -- '<uid>/<request_id>/<file>'
  kind        text not null default 'image',  -- 'image' | 'video'
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint request_attachments_kind_check check (kind in ('image', 'video'))
);

create index if not exists request_attachments_request_idx
  on public.request_attachments (request_id, sort_order);

alter table public.request_attachments enable row level security;

-- Read: the requester always; a provider who has responded to the request.
-- (Mirrors the visibility request_questions grants to a responding provider.)
drop policy if exists "ra read" on public.request_attachments;
create policy "ra read" on public.request_attachments for select using (
  auth.uid() = (select requester_id from public.requests where id = request_id)
  or exists (
    select 1 from public.request_responses rr
     where rr.request_id = request_attachments.request_id
       and rr.responder_id = auth.uid()
  )
);

-- Write: only the request's owner, only as themselves.
drop policy if exists "ra insert" on public.request_attachments;
create policy "ra insert" on public.request_attachments for insert with check (
  uploader_id = auth.uid()
  and auth.uid() = (select requester_id from public.requests where id = request_id)
);

drop policy if exists "ra delete" on public.request_attachments;
create policy "ra delete" on public.request_attachments for delete using (
  uploader_id = auth.uid()
);

insert into storage.buckets (id, name, public)
values ('request-media', 'request-media', false)
on conflict (id) do nothing;

drop policy if exists "request-media owner insert" on storage.objects;
create policy "request-media owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'request-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "request-media owner read" on storage.objects;
create policy "request-media owner read"
  on storage.objects for select
  using (
    bucket_id = 'request-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "request-media owner delete" on storage.objects;
create policy "request-media owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'request-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

select 'request_attachments' as t, count(*) as c from public.request_attachments;

commit;
