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

## Founder decisions on record

**2026-08-02, verbatim:** "keep g lsa and remove google sponsored.. explain what google
local is?"

### The service sources

| source | what it is | status |
|---|---|---|
| **osm** | OpenStreetMap / Overpass | free, live |
| **craigslist** | Apify craigslist scraper | live |
| **yellowpages_apify** | Apify (trudax actor) | live |
| **yelp** | Yelp Fusion API | live, paid |
| **google_lsa** | Google **Local Services Ads** — the verified-provider ad units at the very top of a service search, with a phone number | live, **KEPT** |
| **gmaps_apify** | Apify Google Places extractor | live |
| **ig_services** | Apify Instagram user search — DUAL-CLASS, writes a service row and a creator row | live |
| **google_sponsored** | was SerpAPI generic Google ads | **REMOVED** — 34 rows in its whole life, ran on SerpAPI against the Apify-only rule, and overlapped LSA almost entirely |
| **google_local** | Google **map pack** — the map results beneath the ads, carrying a real phone and coordinates | **not a crawler.** It is a BY-PRODUCT of the LSA crawl: the same SerpAPI response returns both the ad units and the local pack, and the local-pack rows get tagged `google_local` so their provenance is not misreported as LSA. 86 rows, all historical |

**So there is no google_local job to run or stop.** It appears in the counts because rows
carry that provenance, not because anything schedules it. Removing it would mean throwing
away 86 real leads or lying about where they came from.
