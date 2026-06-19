-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — crawl_requests: on-demand city-expansion queue.
--
-- When a user/connector submits a request in a city where we have NO matching
-- data, the app ENQUEUES a crawl request here (it never crawls itself — per
-- CRAWLER_BRIEF.md the app consumes directories; the separate crawler service
-- fulfills). The crawler polls status='new', sources the leads (10 best services
-- nearest, or 5 best adjacent influencers 10k–200k), ingests into leads_services
-- / leads_influencers, fires outreach, and stamps status='delivered'.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crawl_requests (
    id                  uuid primary key default gen_random_uuid(),
    kind                text not null check (kind in ('services','influencers')),
    -- Where to crawl.
    city                text,
    state               text,
    lat                 numeric(9,6),
    lng                 numeric(9,6),
    radius_miles        numeric default 25,
    -- What to crawl: the provider/service type so the crawler can target the
    -- right vertical (services) or the relevant-adjacent influencer niche.
    service_type        text,
    target_count        int not null default 10,
    -- Provenance.
    trigger_request_id  uuid,                              -- requests.id / spotlight_requests.id that triggered it (loose ref)
    requested_by        uuid references public.profiles(id) on delete set null,
    -- Fulfillment state, updated by the crawler service.
    status              text not null default 'new'
                        check (status in ('new','crawling','delivered','failed')),
    delivered_count     int not null default 0,
    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists crawl_requests_status_idx on public.crawl_requests (status);
create index if not exists crawl_requests_city_idx   on public.crawl_requests (lower(city));
create index if not exists crawl_requests_kind_idx   on public.crawl_requests (kind);

-- Dedupe OPEN requests: at most one new/crawling row per (kind, city, service_type)
-- so a busy no-data city doesn't enqueue dozens of duplicate crawls.
create unique index if not exists crawl_requests_open_dedupe_idx
    on public.crawl_requests (kind, lower(coalesce(city,'')), lower(coalesce(service_type,'')))
    where status in ('new','crawling');

-- RLS: signed-in users may enqueue (requested_by = themselves) and read their own
-- rows. The crawler service uses the service-role key (bypasses RLS) to poll +
-- fulfill.
alter table public.crawl_requests enable row level security;

drop policy if exists crawl_requests_insert_self on public.crawl_requests;
create policy crawl_requests_insert_self on public.crawl_requests
    for insert to authenticated
    with check (requested_by = auth.uid());

drop policy if exists crawl_requests_select_self on public.crawl_requests;
create policy crawl_requests_select_self on public.crawl_requests
    for select to authenticated
    using (requested_by = auth.uid());
