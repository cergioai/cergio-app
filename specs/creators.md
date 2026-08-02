# Creators as a first-class class

**CI subagent:** `creators` · **priority** 4

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

100 creators from ig-scraper-user-search, then the source stops itself

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
