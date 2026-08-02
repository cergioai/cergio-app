# SPEC-240 — PHASE1_CITY_QUOTA is the founder's per-DMA formula

Founder, 2026-08-02, verbatim: "50k services for nyc (with 5% of that as creators)..
adjusting each city based on relative size of dma (eg: if miami is 10% of new it
should be 5k services and 250 creators.." · 9th metro = Boston.

## Encoded

- `growth-controls.json` PHASE1_CITY_QUOTA = `{"NY":50000,"FL":11700}` — the formula's
  output (services = 50,000 × DMA/DMA(NYC), Nielsen TV households, nearest 100).
  Creators 5% documented; CREATOR_TARGET=100 (get-100-then-audit) still governs
  creators until the founder lifts it. Phase-2 quotas pre-computed in the build spec
  but OUT of the map until Phase 1 fills — an absent DMA is locked, never unbounded.
- BOTH consumers parse the map FAIL-CLOSED (empty/unparseable/bare-number/non-positive
  → Phase 2 locked, no default anywhere):
  - `fulfill-crawl` counts leads per DMA bucket (`.in('city', locs)`) — Brooklyn and
    Queens fill ONE 50,000 bucket, not six.
  - `scripts/_growth-scope.mjs` `activeCities()` same semantics for the seeder.
- The DMA→locations grouping exists twice (Deno can't import the node module):
  `P1_DMA` in fulfill-crawl and `DMA_LOCATIONS` in _growth-scope — **gate #240 welds
  them byte-for-byte** (the previous two-city-lists drift was a Part-6 defect).
  FL keeps the 8 legacy Miami areas so their queued rows aren't stranded.
- PHASE2 += Boston (founder decision replaces the old "I am not inventing a 9th city"
  note); gate #240 pins it.
- Gate #207 updated: the controls file must carry EXACTLY the founder map (NY 50000,
  FL 11700, no extra keys). #205 unchanged in force: still no default anywhere.

## Gate

`#240`, mutation-tested (see PR): wrong NY number, extra DMA key, empty map, bare-number
parse restored in either consumer, DMA lists drifted, Boston removed — all FAIL.
