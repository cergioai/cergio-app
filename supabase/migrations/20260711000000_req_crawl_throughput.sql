-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — REQ-crawl-throughput ledger row (crack-crawl-throughput).
--
-- The crawl went RED again (2026-07-09): YellowPages serves an anti-bot / block /
-- empty page to Supabase's datacenter IPs, so fulfill-crawl's YP path parsed 0
-- listings and (pre-fix) stamped every job 'delivered' with count 0 — silently
-- draining the queue while services_new stayed frozen (12,087, nothing new >24h).
--
-- The fix (committed 2026-07-09):
--   (A) BLOCK DETECTION in fulfill-crawl — a block/empty fetch throws YpBlockedError,
--       is stamped 'failed' with a 'yp-blocked' note (NOT delivered-0), and is
--       counted in agent_runs.meta.blocked so the block can't hide.
--   (B) A WORKING SERVER-SIDE THROUGHPUT PATH — crawl-seed-google-places enqueues
--       the city×type matrix as source='google_places' (the PROVEN Places drain,
--       176+ delivered rows historically), so rows grow without depending on YP
--       being reachable.
--
-- Locked by scripts/qa.mjs test id 'crawl-throughput' (static + behavioural: it
-- executes fulfill-crawl's own ypLooksBlocked()/parse against a synthetic block
-- page and a synthetic normal page).
--
-- Idempotent: cergio_open_requirement upserts by id; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

select public.cergio_open_requirement(
  'crawl-throughput',
  'The crawl produces NEW services rows: a block/empty fetch is surfaced (failed + yp-blocked, counted in agent_runs.meta.blocked) — never masked as delivered-0 — a normal page still parses to listings, and a working server-side throughput path (crawl-seed-google-places → google_places drain, GOOGLE_PLACES_API_KEY) keeps rows growing when YellowPages is blocked.',
  'SPEC-64 / #64 / SPEC-72',
  'crawl',
  'founder',
  'built'
);
