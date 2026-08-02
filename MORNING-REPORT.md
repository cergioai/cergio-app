# Morning report — 2026-08-02 16:58 UTC

**0 of 9 agents GREEN.** Everything below is sorted worst first.

| agent | verdict | gates | defects |
|---|---|---|---|
| **data-dashboard** | **CANNOT RUN** | 2/2 | 1 |
| **ops-dashboard** | **DID NOT RUN** | 0/0 | 5 |
| **payments** | **NEEDS WORK** | 1/2 | 2 |
| **booking-loop** | **NEEDS WORK** | 2/3 | 1 |
| **crawl-sources** | **NEEDS WORK** | 6/6 | 2 |
| **creators** | **NEEDS WORK** | 3/3 | 2 |
| **spend-guard** | **NEEDS WORK** | 4/4 | 1 |
| **ci-health** | **NEEDS WORK** | 1/1 | 2 |
| **legal-copy** | **NEEDS WORK** | 1/1 | 1 |

**Green when:**

- **data-dashboard** — the screen total equals a direct count for the same filter
- **ops-dashboard** — changing any filter changes the counts, and every facet list is derived from live rows
- **payments** — one real booking reaches paid_at with a Stripe charge id
- **booking-loop** — a live walk completes the loop with two real accounts
- **crawl-sources** — every paid source routes through Apify, or is parked with the reason recorded
- **creators** — 100 creators from ig-scraper-user-search, then the source stops itself
- **spend-guard** — ledger total matches the vendor account total within 5%
- **ci-health** — e2e is green and required, or deleted with the reason recorded — a permanently red advisory check is worse than no check
- **legal-copy** — legal review clears the copy, or it is de-securitised and the paraphrases are added to the gate

## Did not run — read this first

An agent that produced no report is the most dangerous state on this page, because
silence reads like success. Treat each of these as UNKNOWN, not as fine.

- **ops-dashboard** — /ops/status — the founder's console

## COULD NOT START — read this before anything else

These agents did not fail; they never began. This is the state that hid the build
agent for weeks: it was dark on a 400 while every dashboard read green, because
nothing distinguished "idle" from "unable to start". The API's own words follow.

- **data-dashboard** — ANTHROPIC_API_KEY is not set on this runner — the agent is not idle, it is unable to start

## What the CI subagents DID this run

No subagent changed anything this run.

## What the agents found this run

No agent reported a new defect in its own files this run.
## What each agent is waiting on

### data-dashboard — /ops/data — every dataset live + downloadable

- screen counts have never been reconciled against a direct REST count

Full report: `reports/data-dashboard.md`

### ops-dashboard — /ops/status — the founder's console

- every count and CSV must obey City (DMA), Location, Category, Time and Rows — the LIVE counts bypassed all of them and made working filters look broken
- DMAs and every facet must come FROM THE DATA, never a hardcoded list
- deleting an export from opsPayload crashed the whole console with 'SOURCES is not defined' — no count, no filter, no DMA
- exactly TWO creator sources; a list of six put four permanent zeros beside the real ones
- google_sponsored is folded into google_lsa, never shown as its own row

Full report: `reports/ops-dashboard.md`

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
