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
  -- SPEC-163: the workers SELECT lat/lng/requested_by; omitting them made every
  -- claim fail 42703 while the queue looked perfectly healthy.
  lat double precision, lng double precision, requested_by uuid,
  -- SPEC-185: the REAL dollars this job cost, read back from the vendor. The $1
  -- tranche gate sums this per source; without it a budget rule is guesswork.
  cost_usd numeric default 0,
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
  -- SPEC-163: written by the OSM (primary) and Places paths.
  address text, osm_id text,
  -- SPEC-177: EVERY source except osm writes these. They were absent, so PostgREST
  -- rejected the whole chunk with 42703, flushBuf discarded the error, and each
  -- fulfiller had already done saved++ — so delivered_count reported rows that were
  -- never written. osm is the only source that omits zip and the only source that
  -- has ever produced a row. That is the entire "6 dead sources" mystery.
  zip text, yelp_url text, cl_post_url text, facebook text,
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
  -- Enrichment columns the enrich-influencers worker READS (SPEC-132 cutover
  -- omitted these, so every run threw 42703 and CREATORS_NOT_GROWING fired).
  bio text, external_url text, enrich_attempted_at timestamptz,
  fetched_at timestamptz default now()
);
-- Idempotent guards so an EXISTING (bio-less) growth table gets healed on apply.
alter table public.leads_influencers add column if not exists bio text;
alter table public.leads_influencers add column if not exists external_url text;
alter table public.leads_influencers add column if not exists enrich_attempted_at timestamptz;
create index if not exists leads_influencers_via_idx  on public.leads_influencers (discovered_via);
create index if not exists leads_influencers_city_idx on public.leads_influencers (city, state);

create table if not exists public.agent_runs (
  id bigserial primary key,
  agent text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text, raw_found int, rows_written int, error text, meta jsonb
);
create index if not exists agent_runs_agent_started_idx on public.agent_runs (agent, started_at desc);
