# Crawl audit — quality per source

Generated 2026-08-02T02:48:21.395Z. Crawling is SUSPENDED (SPEC-197) while this is reviewed.

> **THIS EXPORT READ NOTHING.** Every source returned 0 rows. See Connection diagnostics at the bottom — the database is not empty, the export could not read it.

**The bar (founder, HARD spec):** a lead without a phone OR an email is useless and must not be paid for.

| source | leads | contactable | phone | email | website | IG | coords | verdict |
|---|---|---|---|---|---|---|---|---|
| **osm** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **craigslist** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **yellowpages_apify** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **yelp** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **google_lsa** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **google_sponsored** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **gmaps_apify** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |
| **ig_services** | 0 | **0%** | 0 | 0 | 0 | 0 | 0 | no data |

## Files

Per source: `sample-100-<source>.csv` (newest 100, for eyeballing) and `all-<source>.csv` (everything).

`QUALITY-SUMMARY.csv` holds these numbers as data.

## Connection diagnostics

```
preflight: HTTP 404 · key sb_secret_g… (41 chars) · {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample osm: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all osm @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample craigslist: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all craigslist @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample yellowpages_apify: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all yellowpages_apify @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample yelp: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all yelp @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample google_lsa: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all google_lsa @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample google_sponsored: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all google_sponsored @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample gmaps_apify: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all gmaps_apify @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
sample ig_services: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
all ig_services @0: HTTP 404 {"code":"PGRST125","details":null,"hint":null,"message":"Invalid path specified in request URL"}
```
