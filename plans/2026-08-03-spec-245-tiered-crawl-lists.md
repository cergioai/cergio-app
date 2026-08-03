# SPEC-245 — the founder's tiered crawl lists, committed and encoded

**Founder-provided lists, 2026-08-02** (uploaded doc). 130 service types in 3 tiers,
70 creator categories in 3 tiers, per-tier order, BLOCKED entries marked. Handoff item:
"(e) commit the list into the repo as a specs/ file so the subagents read it."

## The change, one micro-feature

1. `specs/CERGIO-CRAWL-LISTS.md` — the founder lists verbatim, committed to the repo.
   Phase 3 placeholder STANDS (forthcoming from founder — never invented).
2. `scripts/_growth-scope.mjs` — TYPES_T1 (12, exact founder order) / TYPES_T2 (16) /
   TYPES_T3 (98 = the Tier-3 ontology minus the four founder-BLOCKED entries).
   `TYPES = [...T1, ...T2, ...T3]` — derived, never restated. Tier order is crawl
   order: the seeder emits Tier 1 first, so FIFO drains it first.
3. `creator-harvest/index.ts` — NICHE_TIERS (founder tiers 1–3 + legacy niches kept
   LAST so rows already tagged with legacy categories are never quarantined);
   TARGET_CATEGORIES **derived** from NICHES — the SPEC-86b trap (add a niche, forget
   the category, quarantine everything it harvests) is now impossible; query walk
   allocates each run's budget per tier (24/12/8/4 of 48) with rotation inside each
   tier — search discovery has no queue to exhaust, so budget share is how "crawl
   first" is encoded.
4. Gate `#245`, mutation-tested 8 ways (blocked type in, T1 reorder, hand-flattened
   TYPES, tier-1 category dropped, hand-written TARGET_CATEGORIES, nightlife niche,
   placeholder deleted, budget ignored). Every service type is verified against
   fulfill-crawl's own OSM_BLOCKED regex — one definition of blocked.

## Verified

126 service types extracted, 0 blocklist hits, 0 duplicates. Suite 233 green; build
green; tdz/deno guards clean.
