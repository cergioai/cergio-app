# Creators as a first-class class

**CI subagent:** `creators` · **priority** 4

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

100 creators from EACH of the two sources — ig-scraper-user-search (eq match) and
se:web-harvest (PREFIX match) — then each source stops ITSELF (SPEC-205 / SPEC-237)

## Owned files

- `scripts/growth-dedupe-queue.mjs`\n- `scripts/_growth-scope.mjs`

## Guards

- #202\n- #204\n- #208

## Open defects

- [ ] ig-creator-marketplace PARKED pending IG_USER_ID + IG_MARKETPLACE_TOKEN (founder/Meta action)\n- [ ] follower band 5k-500k not enforced on the ig_services creator path

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_

## Founder decisions on record

**2026-08-02, verbatim:** "fix creator sources.. we're supposed to have 2 (IG services and
the other IG local creator search)"

| # | source | `discovered_via` | what it is | cost |
|---|---|---|---|---|
| 1 | **ig_services** | `ig-scraper-user-search` | Apify Instagram user search. DUAL-CLASS: one person yields a service row AND a creator row | paid (Apify) |
| 2 | **creator-harvest** | `se:web-harvest-<date>` | free keyless web search (DuckDuckGo HTML) for local on-values creators; contact from their own link-in-bio | free |

`ig-creator-marketplace` (Meta first-party API) is REMOVED — it never produced a row and
needs a permission we do not have.

`se:web-harvest` is stamped PER RUN DAY, so it must be matched by PREFIX. An `eq()` on the
bare name once reported 0 beside a real total of 4,211.

**Why creators sat at 0:** all three paths were closed at once — marketplace removed,
creator-harvest unscheduled by SPEC-198, and the supply engine then auto-disabled
ig_services for low *service* yield without counting its creator half.

**2026-08-02, verbatim:** "activate the crawls just for the creator sources to get 100 of
each then pause alongside the rest to audit" · "set up CI subagents and dashboard and
share when they're live... ignore yelp as a source.. get the initial 100"

**SPEC-237 (activation, 2026-08-02):**

- `CRAWLS_ONLY = ig_services,se:web-harvest` — BOTH creator sources, nothing else.
  Listing only one re-creates the SPEC-230 failure (last path silently closed).
- **Each source stops ITSELF at CREATOR_TARGET=100**: ig_services counts
  `eq(discovered_via,'ig-scraper-user-search')` before any job is claimed (SPEC-205);
  creator-harvest counts `like(discovered_via,'se:web-harvest%')` — PREFIX, per-run-day
  tag — before any search fires, honours CRAWLS_SUSPENDED / CRAWLS_ONLY (fail closed),
  and refuses to crawl if the count is unreadable. Gate `#237`.
- **Why ig_services produced 262 service rows and 0 creators:** the SPEC-202 fix healed
  the schema REFERENCE, not the live TABLE — `is_business` had no
  `add column if not exists` guard, so every creator upsert still threw 42703. Healed,
  plus `created_at` (creator-harvest writes it), plus the verify now probes writer
  columns. Gate `#237`.

## Progress log

- 2026-08-02 SPEC-237: is_business/created_at heal guards; creator-harvest reads the
  committed controls + stops itself at 100 (prefix count); CRAWLS_ONLY carries both
  creator sources.
