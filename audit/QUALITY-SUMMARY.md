# Crawl audit — quality per source

Generated 2026-08-08T01:08:08.570Z. Crawling is SUSPENDED (SPEC-197) while this is reviewed.

**The bar (founder, HARD spec):** a lead without a phone OR an email is useless and must not be paid for.

| source | leads | contactable | phone | email | website | IG | coords | verdict |
|---|---|---|---|---|---|---|---|---|
| **osm** | 2060 | **71.1%** | 1407 | 308 | 834 | 32 | 2060 | MIXED — usable, needs enrichment |
| **craigslist** | 271 | **100%** | 255 | 37 | 271 | 0 | 271 | STRONG — scale |
| **yellowpages_apify** | 159 | **100%** | 159 | 23 | 159 | 0 | 0 | STRONG — scale |
| **yelp** | 15796 | **98.4%** | 15547 | 0 | 0 | 0 | 15796 | STRONG — scale |
| **google_lsa** | 1387 | **100%** | 1387 | 0 | 1173 | 0 | 1116 | STRONG — scale |
| **google_sponsored** | 34 | **100%** | 34 | 0 | 34 | 0 | 0 | STRONG — scale |
| **gmaps_apify** | 2172 | **100%** | 2172 | 0 | 1613 | 0 | 2172 | STRONG — scale |
| **ig_services** | 276 | **60.5%** | 132 | 99 | 218 | 276 | 0 | MIXED — usable, needs enrichment |

---

## CREATORS — a SEPARATE data class

Creators are people with an audience who spotlight providers. They live in
`leads_influencers`, never mixed into the services numbers above. Only TWO discovery
paths exist:

| creator source | what it is | creators | contactable | with followers |
|---|---|---|---|---|
| **ig-scraper-user-search** | ig_services dual-class crawl (Apify Instagram, founder override) | 134 | 64.2% | 129 |
| **TOTAL** | ig_services dual-class crawl (Apify Instagram, founder override) | 253 | 67.6% | 143 |

`ig_services` is DUAL-CLASS: it writes a service row AND a creator row for the same person.


SERVICES per source: `sample-100-<source>.csv` and `all-<source>.csv`.
CREATORS: `sample-100-CREATORS.csv`, `all-CREATORS.csv`, `CREATORS-SUMMARY.csv`.

`QUALITY-SUMMARY.csv` holds the services numbers as data.

## Connection diagnostics

```
preflight: HTTP 200 · key sb_secret_g… (41 chars) · [{"id":"osm:node/2523856230"}]
```
