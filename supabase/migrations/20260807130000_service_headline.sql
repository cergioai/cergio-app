-- 2026-08-07 — FW-23: Airbnb-style service headline.
--
-- WHY (founder 2026-08-07): "Need to Add a Service Headline (like airbnb)..
-- one line that is displayed instead of the default 'babysitter in new york
-- etc'... and keep babysitter in nyc (service in location) as a formatted
-- service badge.. add by [name of service provider]".
--
-- The provider writes one line ("Gentle evening sitter your kids will ask
-- for again"); the auto-generated service-in-location title stays on the row
-- and renders as a badge. NULLABLE on purpose — services without a headline
-- keep rendering exactly as before.
--
-- Idempotent: safe to re-run.

begin;

alter table public.services
  add column if not exists headline text;

-- Sanity readback
select 'services with headline' as t, count(*) as c
  from public.services where headline is not null;

commit;
