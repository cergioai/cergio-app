-- SPEC-132: resume growth AFTER the cutover.
--
-- These were paused on 2026-07-30 because background crawling saturated the
-- PRODUCT database — /rest/v1/services returned 503 while /auth/v1/user returned
-- 200 and the founder could not sign in or list a service.
--
-- The workers now read and write crawl_requests / leads_services /
-- leads_influencers on the SEPARATE growth project (SPEC-120/132), so their load
-- lands on a different connection pool entirely. Growth can run flat out without
-- being able to touch the product. That is the whole point of the decoupling.
do $$
declare j text;
begin
  foreach j in array array['cergio_supply_engine','cergio_fulfill_crawl','cergio_crawl_seed_osm','cergio_creator_harvest','cergio_creator_enrich'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

select cron.schedule('cergio_fulfill_crawl',   '*/15 * * * *', $$ select public.cergio_call_edge('fulfill-crawl');   $$);
select cron.schedule('cergio_supply_engine',   '*/10 * * * *', $$ select public.cergio_call_edge('supply-engine');   $$);
select cron.schedule('cergio_crawl_seed_osm',  '7 * * * *',    $$ select public.cergio_call_edge('crawl-seed-osm');  $$);
select cron.schedule('cergio_creator_harvest', '35 * * * *',   $$ select public.cergio_call_edge('creator-harvest'); $$);
select cron.schedule('cergio_creator_enrich',  '5 * * * *',    $$ select public.cergio_call_edge('creator-enrich');  $$);
