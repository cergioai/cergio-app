-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — Cross-post / free-profile distribution.
--
-- Lets a service push its profile + offers to external channels (Google
-- Business Profile, Instagram, TikTok) with one click, and generates a
-- ready-to-paste Craigslist post (CL has no API). This is the onboarding
-- carrot: "list on Cergio, we keep you live everywhere your customers search."
--
-- Two tables:
--   service_channel_connections — one row per (service, channel): is it
--       connected, the public external account/handle, and a status. We do
--       NOT store OAuth secrets here (frontend can read this table); real
--       tokens live server-side in the edge-function secret store / a
--       server-only table added when each integration goes live.
--   crosspost_jobs — an append-only log of every push attempt + its result.
--
-- Idempotent: CREATE ... IF NOT EXISTS. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── connections ─────────────────────────────────────────────────────────────
create table if not exists public.service_channel_connections (
    id              uuid primary key default gen_random_uuid(),
    service_id      uuid not null references public.services(id) on delete cascade,
    channel         text not null
                    check (channel in ('google','instagram','tiktok','craigslist')),
    -- 'disconnected' = never set up · 'connected' = OAuth/verify done, can post ·
    -- 'pending_review' = integration code exists but app/listing not yet approved ·
    -- 'manual' = channel has no API (Craigslist), owner posts by hand.
    status          text not null default 'disconnected'
                    check (status in ('disconnected','connected','pending_review','manual','error')),
    external_handle text,                     -- public @handle / listing name (safe to expose)
    external_id     text,                     -- channel-side account/location id
    connected_at    timestamptz,
    last_error      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (service_id, channel)
);

create index if not exists scc_service_idx on public.service_channel_connections (service_id);

-- ─── job log ─────────────────────────────────────────────────────────────────
create table if not exists public.crosspost_jobs (
    id               uuid primary key default gen_random_uuid(),
    service_id       uuid not null references public.services(id) on delete cascade,
    channel          text not null
                     check (channel in ('google','instagram','tiktok','craigslist')),
    asset_kind       text not null default 'profile'
                     check (asset_kind in ('profile','offer','spotlight')),
    payload          jsonb,                   -- caption/description/offer/image_url/link sent
    status           text not null default 'queued'
                     check (status in ('queued','posted','manual','needs_connection','error')),
    external_post_id text,
    error            text,
    created_at       timestamptz not null default now(),
    posted_at        timestamptz
);

create index if not exists crosspost_jobs_service_idx on public.crosspost_jobs (service_id, created_at desc);

-- ─── updated_at trigger (reuse public.tg_set_updated_at if present) ──────────
do $$
begin
  if exists (select 1 from pg_proc where proname = 'tg_set_updated_at') then
    drop trigger if exists trg_scc_updated_at on public.service_channel_connections;
    create trigger trg_scc_updated_at
      before update on public.service_channel_connections
      for each row execute function public.tg_set_updated_at();
  end if;
end$$;

-- ─── RLS — a service owner manages only their own service's rows ──────────────
alter table public.service_channel_connections enable row level security;
alter table public.crosspost_jobs              enable row level security;

drop policy if exists scc_owner_all on public.service_channel_connections;
create policy scc_owner_all on public.service_channel_connections
  for all
  using      (exists (select 1 from public.services s where s.id = service_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from public.services s where s.id = service_id and s.owner_id = auth.uid()));

drop policy if exists crosspost_owner_read on public.crosspost_jobs;
create policy crosspost_owner_read on public.crosspost_jobs
  for select
  using (exists (select 1 from public.services s where s.id = service_id and s.owner_id = auth.uid()));

-- Inserts into crosspost_jobs are done by the edge function (service_role,
-- bypasses RLS). No app-tier insert policy needed.

-- ─── End ─────────────────────────────────────────────────────────────────────
