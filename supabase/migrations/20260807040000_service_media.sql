-- 2026-08-07 — FW-18: photos AND videos on a listed service.
--
-- WHY (founder 2026-08-06): a provider can only swap the single cover photo.
-- The founder wants to add/update photos and videos on a listed service. This
-- adds a `service_media` table (ordered gallery rows) and a public-read
-- `service-media` storage bucket that mirrors the `service-covers` ownership
-- rules exactly (path prefix must be the uploader's UUID).
--
-- Reads are public on purpose: services are the public browse surface, and
-- the PDP renders the gallery to signed-out viewers. Writes are owner-only,
-- enforced twice — the storage policy pins the uid folder prefix, and the
-- table policies join services.owner_id.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.service_media (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid not null references public.services(id) on delete cascade,
  uploader_id  uuid not null,
  storage_path text not null,
  kind         text not null check (kind in ('image', 'video')),
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists service_media_service_order_idx
  on public.service_media (service_id, sort_order, created_at);

alter table public.service_media enable row level security;

drop policy if exists "service media public read" on public.service_media;
create policy "service media public read"
  on public.service_media for select
  using (true);

drop policy if exists "service media owner insert" on public.service_media;
create policy "service media owner insert"
  on public.service_media for insert
  with check (
    auth.uid() = uploader_id
    and exists (
      select 1 from public.services s
      where s.id = service_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "service media owner delete" on public.service_media;
create policy "service media owner delete"
  on public.service_media for delete
  using (
    exists (
      select 1 from public.services s
      where s.id = service_id and s.owner_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('service-media', 'service-media', true)
on conflict (id) do update set public = true;

drop policy if exists "service media bucket public read" on storage.objects;
create policy "service media bucket public read"
  on storage.objects for select
  using (bucket_id = 'service-media');

drop policy if exists "service media bucket owner insert" on storage.objects;
create policy "service media bucket owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'service-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "service media bucket owner delete" on storage.objects;
create policy "service media bucket owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'service-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Sanity readback
select 'service_media rows' as t, count(*) as c from public.service_media;

commit;
