-- SPEC-88b: allow multiple SOURCES (osm, yelp, google_sponsored, craigslist, yellowpages)
-- to queue the same (city, service_type) in parallel. The old open-dedupe index keyed
-- only on (kind, city, service_type), so a second source collided with the first.
drop index if exists public.crawl_requests_open_dedupe_idx;
create unique index if not exists crawl_requests_open_dedupe_idx
  on public.crawl_requests (kind, lower(coalesce(city,'')), lower(coalesce(service_type,'')), coalesce(source,'osm'))
  where status in ('new','crawling');
