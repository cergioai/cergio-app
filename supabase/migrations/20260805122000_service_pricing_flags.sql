-- 2026-08-05 — SPEC: service-level free-for-Local-Creators + discount.
--
-- WHY (founder decisions, 2026-08-05, verbatim):
--   "discount applies accross the service"
--   "Free for Local Creators is gated on the viewer being one — i.e. a
--    non-creator sees the price instead (but they're able to submit a request
--    for a free service, and the service will accept or decline based on their
--    profile)"
--
-- The existing flag lives on requests (requests.is_free_for_rainmaker), which is
-- too late: the PDP renders the "Free for Local Creators" headline and the
-- struck-through prices BEFORE any request exists. Both live on the SERVICE.
--
-- discount_pct is on services, not offerings, precisely because the discount is
-- service-wide — every offering shows the same reduction, so there is one number
-- to change and no way for two offerings to disagree.
--
-- Idempotent: safe to re-run.

begin;

alter table public.services
  add column if not exists free_for_connectors boolean not null default false,
  add column if not exists discount_pct        integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'services_discount_pct_range'
       and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_discount_pct_range
        check (discount_pct is null or (discount_pct > 0 and discount_pct <= 100));
  end if;
end$$;

-- The PDP and search both filter on "is this free for creators right now".
create index if not exists services_free_for_connectors_idx
  on public.services (free_for_connectors) where free_for_connectors;

comment on column public.services.free_for_connectors is
  'Service is free to viewers with profiles.cc_verified_at. Non-creators see the price and may still submit a free request for the provider to accept or decline.';
comment on column public.services.discount_pct is
  'Whole-percent discount applied across EVERY offering of this service. Never per-offering.';

select 'services free/discount' as t,
       count(*) filter (where free_for_connectors) as free,
       count(*) filter (where discount_pct is not null) as discounted
  from public.services;

commit;
