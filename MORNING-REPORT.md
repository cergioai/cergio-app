# Morning report — 2026-08-02 04:13 UTC

**0 of 8 agents GREEN.** Everything below is sorted worst first.

| agent | verdict | own gates | open defects | green when |
|---|---|---|---|---|
| **payments** | **NEEDS WORK** | 1/2 | 2 | one real booking reaches paid_at with a Stripe charge id |
| **booking-loop** | **NEEDS WORK** | 2/3 | 1 | a live walk completes the loop with two real accounts |
| **crawl-sources** | **NEEDS WORK** | 6/6 | 2 | every paid source routes through Apify, or is parked with the reason recorded |
| **creators** | **NEEDS WORK** | 3/3 | 2 | 100 creators from ig-scraper-user-search, then the source stops itself |
| **spend-guard** | **NEEDS WORK** | 4/4 | 1 | ledger total matches the vendor account total within 5% |
| **data-dashboard** | **NEEDS WORK** | 2/2 | 1 | the screen total equals a direct count for the same filter |
| **ci-health** | **NEEDS WORK** | 1/1 | 2 | e2e is green and required, or deleted with the reason recorded — a permanently red advisory check is worse than no check |
| **legal-copy** | **NEEDS WORK** | 1/1 | 1 | legal review clears the copy, or it is de-securitised and the paraphrases are added to the gate |

## What each agent is waiting on

### payments — Payment on accept — THE LAUNCH BLOCKER

- bookings_paid has been 0 for the life of the project — no card has ever been charged end to end
- counter-offer price shown vs charged (SPEC-211/212 shipped; needs live proof)

Full report: `reports/payments.md`

### booking-loop — Request -> accept -> schedule -> complete

- core loop is auth-gated so it has only ever been verified in code, never walked live

Full report: `reports/booking-loop.md`

### crawl-sources — The 8 crawl sources

- google_sponsored still calls SerpAPI while VENDOR_OF_SOURCE claims apify — the spend meter is wrong on this source
- yelp is a third paid vendor, against 'all paid via Apify'

Full report: `reports/crawl-sources.md`

### creators — Creators as a first-class class

- ig-creator-marketplace PARKED pending IG_USER_ID + IG_MARKETPLACE_TOKEN (founder/Meta action)
- follower band 5k-500k not enforced on the ig_services creator path

Full report: `reports/creators.md`

### spend-guard — No dollar without output

- ledger was blind to 78% of spend once; reconciliation must keep proving itself

Full report: `reports/spend-guard.md`

### data-dashboard — /ops/data — every dataset live + downloadable

- screen counts have never been reconciled against a direct REST count

Full report: `reports/data-dashboard.md`

### ci-health — CI honesty

- the e2e Playwright suite has been RED on main since roughly CI #11 and is advisory, so it never blocks a merge
- 9 duplicate gate IDs baselined in qa-id-baseline.json

Full report: `reports/ci-health.md`

### legal-copy — Securities language

- /rainmaker/apply carries securities-PARAPHRASE copy that gate #170 is blind to — it bans 5 exact phrasings, not the risk

Full report: `reports/legal-copy.md`

## The honest limit of this page

The gate suite is STATIC — it reads source and makes no network calls. A GREEN agent
means "the code says the right thing and its guards are in place". It does NOT mean
"this works in production". Every item needing live proof is listed as an open defect
and stays open until an artifact exists: an HTTP status, a screenshot, or a DB row.

No agent in this fleet edits code unattended. They verify and report. Fixes are
approved in the morning and applied one at a time inside a cell.
