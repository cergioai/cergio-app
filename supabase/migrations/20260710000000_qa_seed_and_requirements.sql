-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — CONTINUOUS QA: seed-world tagging + requirements ledger + QA summary.
--
-- Increment 1 of the Continuous Testing System (CONTINUOUS TESTING PLAN.md).
-- This migration is the DATA SPINE the live QA suites + seed world run against.
-- It is ADDITIVE · IDEMPOTENT · REVERSIBLE only — it NEVER drops, truncates, or
-- rewrites a real user row. Safe to re-run.
--
-- What it installs:
--   1. A `seed` boolean tag on every table the seed world writes to, so
--      production metrics / headlines can EXCLUDE seeded rows (seed=true).
--      Nullable, default false → every existing real row reads seed=false.
--   2. `public.requirements` — the anti-"falls-through-the-cracks" ledger: one
--      row per founder instruction / test requirement, with a captured→built→
--      verified lifecycle + evidence. Seeded with this build's P1/P2 requirements
--      and the top-level "continuous QA + UX testing against spec" instruction.
--   3. `public.qa_suite_runs` — per-suite pass/fail history the dashboard reads.
--   4. `public.cergio_qa_summary()` — the read fn ops-metrics merges into the
--      dashboard snapshot (suite pass/fail + open findings + open requirements).
--   5. `public.cergio_open_requirement()` / `cergio_verify_requirement()` — the
--      idempotent open/verify helpers the QA runner calls (mirrors the proven
--      cergio_qa_check open/resolve contract).
--
-- Companion (deploy alongside): scripts/seed-test-world.mjs (seed/teardown),
-- scripts/qa-live.mjs (live P1/P2 runner), supabase/functions/qa-suite (cron/
-- dashboard-callable runner).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. SEED TAGGING (isolation invariant) ─────────────────────────────────────
-- Every table the seed world touches gets a nullable `seed` boolean. Default
-- false so ALL existing rows are non-seed; only the seed runner sets it true.
-- Teardown deletes strictly `where seed = true` — real rows can never be caught.
do $$
declare
  t text;
  seed_tables text[] := array[
    'profiles', 'services', 'offerings', 'network',
    'requests', 'request_responses', 'bookings',
    'recommendations', 'notifications', 'leads_services', 'leads_influencers'
  ];
begin
  foreach t in array seed_tables loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I add column if not exists seed boolean default false', t);
      -- Index the tag so seed-exclusion filters + teardown are cheap.
      execute format(
        'create index if not exists %I on public.%I (seed) where seed = true',
        t || '_seed_idx', t
      );
    end if;
  end loop;
end $$;

-- ── 2. REQUIREMENTS LEDGER ────────────────────────────────────────────────────
-- One row per instruction / test requirement. Status lifecycle:
--   captured  — recorded from the founder / build spec, not yet built
--   built     — the code / test exists
--   verified  — a live QA signal proves it works (evidence stamped)
-- A requirement stays visibly OPEN (captured|built) on the dashboard until
-- verified, so no instruction silently falls through the cracks.
create table if not exists public.requirements (
  id           text primary key,                 -- stable slug, e.g. 'p1-search-geocode-holds'
  source       text not null default 'founder',  -- 'founder' | 'build' | 'spec'
  instruction  text not null,                    -- the human requirement text
  spec_ref     text,                             -- e.g. 'SPEC-14', 'plan §2.1'
  suite        text,                             -- QA suite that proves it (search / responses / …)
  status       text not null default 'captured', -- captured | built | verified
  evidence     text,                             -- how it was verified (last signal)
  opened_at    timestamptz not null default now(),
  verified_at  timestamptz,
  updated_at   timestamptz not null default now()
);
-- Re-runnable column adds (in case an older shape pre-existed).
alter table public.requirements add column if not exists source      text default 'founder';
alter table public.requirements add column if not exists spec_ref    text;
alter table public.requirements add column if not exists suite       text;
alter table public.requirements add column if not exists evidence    text;
alter table public.requirements add column if not exists verified_at timestamptz;
alter table public.requirements add column if not exists updated_at  timestamptz default now();

create index if not exists requirements_status_idx on public.requirements (status);

revoke all on public.requirements from anon, authenticated;
grant all on public.requirements to service_role;

-- Idempotent open/upsert of a requirement (captured or built). NEVER downgrades
-- a verified requirement back to captured — verification is sticky until a live
-- check proves it regressed (cergio_open_requirement with status='built' on a
-- currently-failing check re-opens it, but keeps the evidence trail).
create or replace function public.cergio_open_requirement(
  p_id text, p_instruction text, p_spec_ref text, p_suite text,
  p_source text default 'founder', p_status text default 'captured'
) returns void language plpgsql security definer
set search_path = public as $fn$
begin
  insert into public.requirements (id, source, instruction, spec_ref, suite, status, opened_at, updated_at)
  values (p_id, coalesce(p_source,'founder'), p_instruction, p_spec_ref, p_suite,
          coalesce(p_status,'captured'), now(), now())
  on conflict (id) do update set
    instruction = excluded.instruction,
    spec_ref    = coalesce(excluded.spec_ref, public.requirements.spec_ref),
    suite       = coalesce(excluded.suite, public.requirements.suite),
    source      = coalesce(excluded.source, public.requirements.source),
    -- keep 'verified' unless the caller explicitly re-opens with a lower status
    status      = case
                    when public.requirements.status = 'verified' and excluded.status = 'verified' then 'verified'
                    when excluded.status in ('captured','built') then excluded.status
                    else public.requirements.status
                  end,
    updated_at  = now();
end $fn$;

-- Mark a requirement verified with evidence (idempotent — re-verify refreshes
-- the evidence + timestamp). Called by the QA runner when a suite passes.
create or replace function public.cergio_verify_requirement(
  p_id text, p_evidence text
) returns void language plpgsql security definer
set search_path = public as $fn$
begin
  update public.requirements
     set status = 'verified',
         evidence = p_evidence,
         verified_at = coalesce(verified_at, now()),
         updated_at = now()
   where id = p_id;
  -- If the id doesn't exist yet (runner ran before seeding), no-op is fine.
end $fn$;

-- Re-open a requirement when its proving suite FAILS (verification regressed).
create or replace function public.cergio_reopen_requirement(
  p_id text, p_reason text
) returns void language plpgsql security definer
set search_path = public as $fn$
begin
  update public.requirements
     set status = 'built',           -- code exists but no longer verified
         evidence = 'REGRESSED: ' || coalesce(p_reason,'suite failing') || ' @ ' || to_char(now(),'YYYY-MM-DD HH24:MI'),
         verified_at = null,
         updated_at = now()
   where id = p_id and status = 'verified';
end $fn$;

revoke all on function public.cergio_open_requirement(text,text,text,text,text,text)   from public, anon, authenticated;
revoke all on function public.cergio_verify_requirement(text,text)                       from public, anon, authenticated;
revoke all on function public.cergio_reopen_requirement(text,text)                       from public, anon, authenticated;
grant execute on function public.cergio_open_requirement(text,text,text,text,text,text) to service_role;
grant execute on function public.cergio_verify_requirement(text,text)                    to service_role;
grant execute on function public.cergio_reopen_requirement(text,text)                    to service_role;

-- ── 2b. SEED THE LEDGER with this build's instructions ────────────────────────
-- The top-level founder instruction + every P1/P2 test requirement. All start
-- 'captured' (built code exists but not yet live-verified); the QA runner flips
-- them to 'verified' the first time each suite passes.
select public.cergio_open_requirement(
  'top-continuous-qa-ux', 'Continuous QA + UX testing against the frozen spec — user journeys must actually work, findings→fixes→regression accrue automatically.',
  'CONTINUOUS TESTING PLAN', null, 'founder', 'captured');

-- P1 SEARCH
select public.cergio_open_requirement('p1-search-query-relevant', 'A search query returns spec-relevant results (right provider_type, no wrong-type spillover).', 'SPEC-13 / #13', 'search', 'founder', 'built');
select public.cergio_open_requirement('p1-search-geocode-holds', 'Geocode holds: a seeded service with non-null lat/lng appears in services_near results.', 'SPEC / #14', 'search', 'founder', 'built');
select public.cergio_open_requirement('p1-search-miami-live', 'Miami live matches: a Miami query returns at least one live Miami seeded service.', '#6 / #14', 'search', 'founder', 'built');
select public.cergio_open_requirement('p1-search-outofmiami-live', 'Out-of-Miami live matches: a query in a non-Miami seeded city returns that city''s live match (multi-city crawl proof).', 'plan §1', 'search', 'founder', 'built');
select public.cergio_open_requirement('p1-search-address-persists', 'A typed/verified address persists (services keep lat/lng) and does not revert to a default.', 'SPEC-2 / SPEC-19', 'search', 'founder', 'built');
select public.cergio_open_requirement('p1-search-no-false-paid', 'No false "showing paid options": paid-fallback banner only when the free search truly returned zero.', 'SPEC-15', 'search', 'founder', 'built');
select public.cergio_open_requirement('p1-search-blocked-never-surface', 'Blocked categories (massage/tattoo/makeup/chef+SHAFT) never resolve to a provider_type nor surface as sendable services.', 'blocked-cats', 'search', 'founder', 'built');

-- P10 CRAWL PIPELINE
select public.cergio_open_requirement('p10-crawl-yp-drain', 'fulfill-crawl drains queued YellowPages jobs (source=yellowpages/status=new) into leads_services rows — the fetched-page byte cap must clear a full ~1.5-2.5MB YP page (late JSON-LD listings), not slice them off to raw_found 0.', 'SPEC-64 / #64', 'crawl', 'founder', 'built');

-- P2 RESPONSES & NOTIFICATIONS
select public.cergio_open_requirement('p2-paths-distinct', 'Connector-request path (requests + request_responses, /inbound/:reqId) stays distinct from direct bookings (bookings, /request/:id).', 'SPEC-48 / SPEC-48b', 'responses', 'founder', 'built');
select public.cergio_open_requirement('p2-requester-confirm-provider-accept', 'Requester-confirm + provider-accept transitions land a confirmed booking (accept_request_with_time / respondToRequest).', 'SPEC-47h / SPEC-56', 'responses', 'founder', 'built');
select public.cergio_open_requirement('p2-instant-vs-scheduled', 'Instant (immediate/15-min) vs scheduled (future/24h) bookings branch correctly on scheduled_at.', 'SPEC-47', 'responses', 'founder', 'built');
select public.cergio_open_requirement('p2-notify-actually-sends', 'Every notify actually SENDS: a notifications row is created (not merely "queued") for each key event.', 'SPEC-55 / SPEC-56', 'responses', 'founder', 'built');

-- ── 3. QA SUITE RUN HISTORY (dashboard trend) ─────────────────────────────────
-- One row per suite per QA run. The dashboard shows latest pass/fail per suite +
-- a trend. Service-role writes; dashboard reads via cergio_qa_summary().
create table if not exists public.qa_suite_runs (
  id           bigserial primary key,
  suite        text not null,           -- 'search' | 'responses' | ...
  ran_at       timestamptz not null default now(),
  passed       int not null default 0,
  failed       int not null default 0,
  total        int not null default 0,
  ok           boolean generated always as (failed = 0 and total > 0) stored,
  duration_ms  int,
  detail       jsonb                    -- per-assertion results
);
create index if not exists qa_suite_runs_suite_ran_idx on public.qa_suite_runs (suite, ran_at desc);

revoke all on public.qa_suite_runs from anon, authenticated;
grant all on public.qa_suite_runs to service_role;
grant usage, select on sequence public.qa_suite_runs_id_seq to service_role;

-- Idempotent recorder the QA runner calls once per suite per run.
create or replace function public.cergio_record_qa_run(
  p_suite text, p_passed int, p_failed int, p_total int, p_ms int, p_detail jsonb
) returns void language plpgsql security definer
set search_path = public as $fn$
begin
  insert into public.qa_suite_runs (suite, passed, failed, total, duration_ms, detail)
  values (p_suite, coalesce(p_passed,0), coalesce(p_failed,0), coalesce(p_total,0), p_ms, p_detail);
end $fn$;
revoke all on function public.cergio_record_qa_run(text,int,int,int,int,jsonb) from public, anon, authenticated;
grant execute on function public.cergio_record_qa_run(text,int,int,int,int,jsonb) to service_role;

-- ── 4. QA SUMMARY (read fn ops-metrics merges into the dashboard) ─────────────
-- Latest run per suite + open QA findings (area='qa') + requirement rollup.
-- Pure SELECT; SECURITY DEFINER so the public ops-metrics fn resolves it
-- identically regardless of caller (it runs as service_role anyway).
create or replace function public.cergio_qa_summary()
returns jsonb language plpgsql security definer
set search_path = public as $fn$
declare res jsonb;
begin
  select jsonb_build_object(
    'generated_at', now(),
    -- Latest run per QA suite (pass/fail + when).
    'suites', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'suite', suite, 'ok', ok, 'passed', passed, 'failed', failed,
        'total', total, 'ran_at', ran_at, 'duration_ms', duration_ms
      ) order by suite), '[]'::jsonb)
      from (
        select distinct on (suite) suite, ok, passed, failed, total, ran_at, duration_ms
          from public.qa_suite_runs
         order by suite, ran_at desc
      ) latest
    ),
    -- Open live-QA findings (the failure ledger the dashboard shows red).
    'open_findings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'check_name', check_name, 'severity', severity, 'count', count,
        'detail', detail, 'found_at', found_at
      ) order by found_at desc), '[]'::jsonb)
      from public.qa_findings
      where area = 'qa' and status = 'open'
    ),
    -- Requirement rollup — unfulfilled instructions stay OPEN until verified.
    'requirements', jsonb_build_object(
      'total',    (select count(*) from public.requirements),
      'verified', (select count(*) from public.requirements where status = 'verified'),
      'open',     (select count(*) from public.requirements where status <> 'verified'),
      'open_list', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'instruction', instruction, 'spec_ref', spec_ref,
          'suite', suite, 'status', status, 'source', source
        ) order by opened_at), '[]'::jsonb)
        from public.requirements where status <> 'verified'
      ),
      'verified_list', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'instruction', instruction, 'evidence', evidence, 'verified_at', verified_at
        ) order by verified_at desc), '[]'::jsonb)
        from public.requirements where status = 'verified'
      )
    ),
    -- Seed-world census — proves isolation (how many seed=true rows exist).
    'seed_world', jsonb_build_object(
      'profiles', (select count(*) from public.profiles where seed is true),
      'services', (select count(*) from public.services where seed is true),
      'bookings', (select count(*) from public.bookings where seed is true),
      'requests', (select count(*) from public.requests where seed is true)
    )
  ) into res;
  return res;
end $fn$;

grant execute on function public.cergio_qa_summary() to anon, authenticated, service_role;

-- ── 4b. REGISTER qa-suite IN THE AGENT REGISTRY (watchdog + dashboard) ────────
-- So the delivery-verification backbone (agent_health / cergio_org_health) knows
-- qa-suite is an expected agent and can flag it if the cron stalls. can_rerun so
-- the orchestrator may re-invoke it (idempotent, no send / no money). Guarded so
-- this migration is safe even if the backbone table doesn't exist yet.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='agent_registry') then
    insert into public.agent_registry (agent, max_gap_minutes, can_rerun, note)
    values ('qa-suite', 720, true, 'continuous QA — P1 search + P2 responses against the seed world; tolerate 12h')
    on conflict (agent) do update
      set max_gap_minutes = excluded.max_gap_minutes,
          can_rerun = excluded.can_rerun,
          note = excluded.note;
  end if;
end $$;

-- ── 5. VERIFY (harmless SELECTs, safe to leave in) ────────────────────────────
select 'qa seed + requirements installed' as step,
       (select count(*) from public.requirements) as requirements_seeded,
       (select count(*) from public.qa_suite_runs) as qa_runs;
