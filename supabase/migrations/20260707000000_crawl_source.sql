-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — crawl_requests.source: which directory should fulfill-crawl use to
-- source a given job.
--
-- Until now fulfill-crawl only sourced from Google Places. This adds a nullable
-- `source` column so a job can instead be fulfilled from YellowPages (the new
-- server-side, off-Mac YP crawl seeder — `crawl-seed-yellowpages`). NULL / absent
-- keeps the LEGACY behaviour (Google Places), so every existing row and every
-- app-enqueued on-demand crawl (`enqueueCityCrawl`) is untouched.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.crawl_requests
    add column if not exists source text;

-- Legacy rows predate the column → treat NULL as 'google_places' (the only source
-- that existed). Backfill so admin dashboards / analytics read cleanly; the code
-- path also treats NULL as google_places, so this is cosmetic + forward-safe.
update public.crawl_requests set source = 'google_places' where source is null;

-- Optional soft-validation: only the two sources fulfill-crawl knows how to drain.
-- (Left as a comment rather than a hard CHECK so a future source can be added
--  without a migration race; the code rejects unknown sources at fulfillment.)
--   check (source in ('google_places','yellowpages'))

create index if not exists crawl_requests_source_idx on public.crawl_requests (source);
