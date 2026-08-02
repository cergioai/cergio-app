# The 8 crawl sources

**CI subagent:** `crawl-sources` · **priority** 3

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

every paid source routes through Apify, or is parked with the reason recorded

## Owned files

- `supabase/functions/fulfill-crawl/index.ts`

## Guards

- #179\n- #180\n- #181\n- #182\n- #187\n- #205

## Open defects

- [ ] google_sponsored still calls SerpAPI while VENDOR_OF_SOURCE claims apify — the spend meter is wrong on this source\n- [ ] yelp is a third paid vendor, against 'all paid via Apify'

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_
