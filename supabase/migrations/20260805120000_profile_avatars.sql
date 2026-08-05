-- 2026-08-05 — SPEC: profile avatars.
--
-- WHY: the redesigned profile, PDP and booking screens are built for real
-- photos, but `profiles` has no avatar column. Today the app is inconsistent
-- about it: src/screens/ActivityScreen.jsx:593 SELECTs avatar_url, while
-- src/screens/PublicProfileScreen.jsx:364 carries a comment saying avatar_url
-- was rejected by the select. One of those two is wrong on every page load.
--
-- This adds the column and a public-read `avatars` storage bucket that mirrors
-- the `service-covers` bucket's ownership rules exactly (path prefix must be
-- the user's UUID). avatar_url is NULLABLE on purpose — the initials-on-gradient
-- fallback stays for every profile that hasn't uploaded one.
--
-- Idempotent: safe to re-run.

begin;

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Sanity readback
select 'profiles with avatar' as t, count(*) as c
  from public.profiles where avatar_url is not null;

commit;
