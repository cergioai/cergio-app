# SPEC-265 — FREE crawl parallel multiplier (founder order: "100X SPEED via parallel crawlers", FREE only)

Date: 2026-08-07. Target: 10–30X free IG throughput. Money gates UNTOUCHED (both lanes are
plain-fetch, $0; the caps are count-based and re-read every run, so parallelism cannot bypass them).

## MEASURED baseline (from the shipped code, not guessed)
- site-enrich: BATCH=12, RUN_BUDGET_MS=45000, strictly sequential. 4 ticks/hr → ≤48 sites/hr.
- creator-harvest: 48 queries built, DEADLINE_MS=50000, strictly sequential ddgSearch (8s cap)
  + inline site fetches (5s cap) → a run completes only ~6–10 of its 48 queries. 4 ticks/hr.

## Change 1 — in-run fan-out (Promise worker-pool, shared synchronous cursor)
- site-enrich: BATCH 12→60, RUN_BUDGET_MS 45000→120000, NEW POOL_SIZE=6 concurrent
  crawlSite workers. Per-request timeout STAYS 5000 — parallelism must never be bought by
  letting one socket hang longer. Fill-only writes, junk filter, stamp-on-every-attempt all
  byte-identical. Budget check moves into the pool's pick loop (same `> RUN_BUDGET_MS` guard).
- creator-harvest: DEADLINE_MS 50000→120000, NEW HARVEST_POOL=4 concurrent query processors
  (deliberately modest — DDG bot-walls are the known risk; 2 endpoints remain the fallback),
  MAX_SITEFETCH 60→120. The per-query body becomes an inner async fn INSIDE the handler
  (SPEC-166 class: it uses handler-scoped db/gdb — must not be module-level). All check-then-act
  on shared state (`seen`, siteFetches cap) stays in synchronous blocks → race-free under JS
  single-thread. spin bucket 1200000→420000 so every tick (incl. the new lane) rotates a
  DIFFERENT query slice instead of re-searching the last tick's.

## Change 2 — second cron lane per free worker (migration)
- 20260807090000_spec265_free_parallel_lanes.sql: cergio_creator_harvest_b + cergio_site_enrich_b
  at '7-59/15 * * * *' (minutes 7,22,37,52) via public.cergio_call_edge (the only transport that
  resolves — SPEC-242), unschedule-first exists-guards. Effective cadence ~7.5 min per worker.
- CLAIM SEMANTICS (verified, as the handoff demanded): runs select candidates at start and stamp
  as they go. Lanes are staggered ≥7 min apart and a run's wall clock is ≤120s + writes, so two
  lanes NEVER run concurrently — no duplicated batch. Even a freak overlap is harmless-not-corrupt:
  fill-only null re-checks + the ON CONFLICT id upsert + fresh-count caps make duplicate work a
  no-op, never bad data. This is why the cheap lane design is safe WITHOUT new claim columns.

## Multiplier math (report to founder with live numbers, never this estimate alone)
- site-enrich: 12/tick × 4/hr = 48/hr → up to 60/tick × 8/hr = 480/hr ≈ 10X.
- creator-harvest: ~8 queries executed/tick × 4/hr ≈ 32/hr → 48/tick × 8/hr = 384/hr ≈ 12X,
  and the 7-min spin bucket makes each tick a fresh slice (less known_handle waste).
- Combined free-lane throughput: ~10–30X depending on site latency. "100X" is the direction;
  the audit CSVs are the proof.

## NOT in this PR (WIP limit 1)
- Craigslist 43s sync timeout bump — separate micro-PR after SPEC-265 merges.
- More lanes (_c/_d): only after live evidence the 2-lane cadence holds without DDG bot-walls.

## Gates
- #263b amended IN PLACE: pinned RUN_BUDGET_MS 45000→120000 (same assert strength, new value),
  prose "~45s" → "~120s".
- NEW #265b: pins BATCH>=60 + POOL_SIZE + budget 120000 (site-enrich); DEADLINE_MS 120000 +
  HARVEST_POOL + 420000 spin bucket (creator-harvest); per-request timeouts STILL 5000/8000;
  the two _b lanes in the migration via cergio_call_edge with exists-guards; and NO paid-vendor
  reference (apify) in either free worker — the multiplier must stay free. Mutation-tested.
