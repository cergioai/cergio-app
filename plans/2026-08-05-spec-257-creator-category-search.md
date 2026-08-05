# SPEC-257 — the IG creator path searches CREATOR CATEGORIES, not service types

Founder, 2026-08-05, verbatim: "the services IG creators has 'junk removal' .. which
wasn't part of the spec... the creators web crawling spec should have included multi
step... (search top 25 micro to mid influencers (per each of the indicated
cateogries), crawl names and emails and IG handles (visible from site ..) 3-get tel
and email from website and or IG or other..."

## The deviation (given, not re-derived)
fulfill-crawl's dual-class ig_services source ran ONE Apify IG user search built from
the JOB's service_type ("junk removal Bronx") and wrote a creator row per hit — so
creators arrived tagged with services-rota terms the founder never listed for
creators. The committed creator categories live in specs/CERGIO-CRAWL-LISTS.md
(SPEC-245): Tier 1 pets, parenting, fitness, home, beauty, local city life; Tier 2
food, wellness, style, photography, events, neighbourhood accounts. Tier 3 exists but
ships later; it follows the same shape.

## Changes
1. `_shared/opsPayload.ts`: export `CREATOR_CATEGORIES` — ordered {slug, igQuery}
   for Tiers 1+2 in founder order — and `CREATOR_CAT_CAP = 25` (founder: "top 25 ...
   per each of the indicated cateogries"). creator-harvest keeps its local NICHE_TIERS
   (it needs multiple phrasings per category + per-tier budgets); gate #257 WELDS the
   two files' slug sets (the #251 names() technique) so they cannot drift.
2. `fulfill-crawl` fulfillIgServices — split the dual class:
   - SERVICE half: unchanged. Same service_type search, same leads_services rows
     (SPEC-230: ig_services legitimately follows the services rota for services).
   - CREATOR half: its OWN apifyRun. Category picked by rotating pointer: first
     category in tier order whose `leads_influencers` count
     (eq discovered_via='ig-scraper-user-search', eq category=slug) is under
     CREATOR_CAT_CAP; a category at 25 is skipped. Search `${cat.igQuery} ${city}`
     with maxItems = boundedBuy(min(remainingNeed('ig_services'),
     CREATOR_CAT_CAP − have), CREATOR_CAT_CAP). Creator rows keep
     discovered_via='ig-scraper-user-search' EXACTLY (CREATOR_TARGET and every
     dashboard counts eq() on it — no suffix needed because the `category` column
     already exists and is written by both creator paths) and now carry the category
     SLUG in `category` instead of job.service_type. Fail CLOSED: unreadable
     per-category count → skip the paid creator search, record _lastCreatorError.
3. `growth-controls.json`: new `_CREATOR_PIPELINE` doc key — the founder's 3-step
   spec verbatim + micro-to-mid banding note (~10k–500k followers, applied where the
   source exposes counts; out-of-band rows KEPT — the stored followers value is the
   mark, the audit filters).
4. qa.mjs gate #257 `creators-come-from-creator-categories-not-the-services-rota`
   (raw-text asserts, mutation-tested): pinned 12-slug founder-order list; creator
   apifyRun input references cat.igQuery and the creator region never touches
   rawType/job.service_type; per-category cap 25 via CREATOR_CAT_CAP; the two-file
   slug weld; discovered_via stays exact; _CREATOR_PIPELINE verbatim present.
5. S-257 rows (CODED, #257) in SPEC-REGISTRY.md + MASTER-SPEC.md.

## Untouched by order
CREATOR_TARGET=100 self-stop, $0.50 pay-per-delivery, month lock (gates #253–#256);
creator-enrich (step 3 hooks unchanged).

## Verify
node scripts/qa.mjs (241, 0 fail) → mutation FAIL lines → tdz-guard → deno-guard →
npx vite build. No commit/push.
