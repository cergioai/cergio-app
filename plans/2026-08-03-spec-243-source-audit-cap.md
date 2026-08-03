# SPEC-243 — all sources into the crawl, 100 leads each max to review (except yelp)

**Founder, 2026-08-03, verbatim:** "add all sources not just creators to the crawl at
100 leads each max to review (except yelp)"

(Numbering note: the founder-order doc called this the SPEC-242 candidate; #242 was
consumed overnight by the creator-harvest cron-body fix (PR #258), so this is 243.)

## The change, one micro-feature

1. `growth-controls.json` — CRAWLS_ONLY grows from the two creator sources to the FULL
   rota minus yelp (`osm,craigslist,yellowpages_apify,google_lsa,gmaps_apify,ig_services,se:web-harvest`);
   new `SOURCE_AUDIT_CAP=100`. yelp stays out (SPEC-239 pause order, gate #239 — untouched).
2. `_shared/opsPayload.ts` — `AUDIT_CAP_SOURCES`: the ONE definition of which sources the
   cap governs and every `data_source` value each one's rows actually carry
   (yellowpages_apify writes 'yellowpages'; google_lsa history includes folded
   google_sponsored rows — counting only the rota name reads 0 beside real rows).
   `sourceAuditCap()`: unparseable → 100, never → no-cap. `source_states` marks
   `audit-cap met` with the founder's verbatim order, so an idle capped source can never
   read as a broken one.
3. `fulfill-crawl/index.ts` — per-source count BEFORE any job is claimed; ≥cap → source
   drops out of ROTA with the reason in the response (same shape as creatorTargetMet);
   unreadable count → that source refuses to run (fail closed). Spend rules unchanged.
4. Gate `#243`, mutation-tested (see below). Registries + fleet brief updated.

## What it does NOT do

- Does not touch yelp (gate #239 stands).
- Does not fix the yellowpages_apify provenance label (rows written as 'yellowpages') —
  recorded as its own defect in agents/fleet.json; the cap routes around it via the map.
- Does not change tranche/spend gating.

## Mutation tests planned

cap→0 in controls · drop a source from CRAWLS_ONLY · remove the ROTA filter · swallow
the count error · remove 'yellowpages' from the map · fallback 100→0 · remove the
'audit-cap met' state. Each must FAIL gate #243, then be restored.
