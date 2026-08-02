# The 8 crawl sources

**agent** `crawl-sources` · **priority** 3 · **NEEDS WORK** · 2026-08-02T04:12:43.947Z

> **Green when:** every paid source routes through Apify, or is parked with the reason recorded

## Its gates

| gate | state |
|---|---|
| #179 | pass |
| #180 | pass |
| #181 | pass |
| #182 | pass |
| #187 | pass |
| #205 | pass |

Whole suite: 207 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 412 of 421 repo files.

## Open defects it is accountable for

- google_sponsored still calls SerpAPI while VENDOR_OF_SOURCE claims apify — the spend meter is wrong on this source
- yelp is a third paid vendor, against 'all paid via Apify'

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
