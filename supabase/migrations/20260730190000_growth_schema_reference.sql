-- SPEC-120 — reference schema for the SEPARATE growth project (cergio-growth).
--
-- This file is NOT applied to the product database. It is applied ONCE to the
-- growth project so the crawl tables exist there. It is kept in this repo so the
-- growth schema is version-controlled alongside the code that writes it.
--
-- Apply with:  GROWTH=1 node scripts/apply-growth-schema.mjs
--
-- Deliberately NOT copied across: auth, profiles, services, requests, bookings.
-- Growth never holds user data.
create table if not exists public.crawl_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  city text, state text, service_type text, source text,
  status text not null default 'new',
  target_count int default 100,
  delivered_count int default 0,
  trigger_request_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crawl_requests_status_city_idx on public.crawl_requests (status, city);
create index if not exists crawl_requests_source_idx     on public.crawl_requests (source);

create table if not exists public.leads_services (
  id text primary key,
  name text, service_type text, phone text, phone_origin text,
  owner_email text, website_url text, instagram text, has_instagram boolean default false,
  city text, state text, lat double precision, lon double precision,
  data_source text, outreach_status text default 'new', outreach_notes text,
  fetched_at timestamptz default now()
);
create index if not exists leads_services_source_idx on public.leads_services (data_source);
create index if not exists leads_services_city_idx   on public.leads_services (city, state);
create index if not exists leads_services_status_idx on public.leads_services (outreach_status);

create table if not exists public.leads_influencers (
  id text primary key,
  ig_handle text, display_name text, category text, followers int,
  email text, phone text, city text, state text,
  discovered_via text, outreach_status text default 'pending_review',
  fetched_at timestamptz default now()
);
create index if not exists leads_influencers_via_idx  on public.leads_influencers (discovered_via);
create index if not exists leads_influencers_city_idx on public.leads_influencers (city, state);

create table if not exists public.agent_runs (
  id bigserial primary key,
  agent text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text, raw_found int, rows_written int, error text, meta jsonb
);
create index if not exists agent_runs_agent_started_idx on public.agent_runs (agent, started_at desc);
