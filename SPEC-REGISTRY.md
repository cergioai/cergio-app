# Spec Registry — what is PROVEN, what is not

One row per micro-feature. A row is **PROVEN** only when all four columns are real.
The drift detector (`qa.mjs` #186) fails the build if this file and the gates separate.

**Status meanings**
- `PROVEN` — spec line + mutation-tested gate + dated live artifact. Trustworthy.
- `CODED` — code and gate exist, never proven live. **Not** trustworthy.
- `UNGUARDED` — spec line with no gate. This is where regressions come from.
- `BLOCKER` — required for soft launch and not proven.
- `DEFERRED` — approved, deliberately sequenced later; not a gap.
- `SCHEDULED-LAST` — intentionally the final step before launch.

<!-- REGISTRY:START -->
| SPEC ID | Behaviour (plain English) | Gate | Live proof | Status |
|---|---|---|---|---|
| S-152 | A signed-in user clicking "Claim your founding spot" goes to the listing flow, never back to the login screen | #157 | live walk 2026-08-01 | PROVEN |
| S-152b | The claim CTA carries its destination through sign-in, so a new user lands on the listing flow after auth | #158 | live walk 2026-08-01 | PROVEN |
| S-153 | The homepage shows a FREE entry point under the search box, naming both sides of the offer | #160 | screenshot 2026-08-01 | PROVEN |
| S-154 | A provider reading a recommendation can click through to the Connector's real Instagram account | #159 | — | CODED |
| S-159 | No identifier may be used where it is not bound — screens AND module-level worker code | #164, #165, #170 | homepage restored + 4 gdb refs fixed 2026-08-01 | PROVEN |
| S-174 | Every crawl source is scheduled every run; none can be starved by another | #181 | per-source table 2026-08-01 | PROVEN |
| S-177 | A worker never writes a column the growth schema lacks, and a write failure is never swallowed | #177 | leads 1067 -> 2816 | PROVEN |
| S-183 | A metered vendor run is cancelled server-side at our deadline, so an abandoned run cannot keep billing | #183 | — | CODED |
| S-185 | No paid source may spend past its $1 tranche without producing leads at <= $0.05/lead | #185, #189 | $23.59 -> 9,742 leads = $0.0024/lead 2026-08-01 | PROVEN |
| S-CRAWL-OSM | OpenStreetMap produces service leads for Miami + NYC, free | #64 | 1,107 leads 2026-08-01 | PROVEN |
| S-CRAWL-YELP | Yelp produces service leads within its 240-result ceiling | #180 | 1,620 leads 2026-08-01 | PROVEN |
| S-CRAWL-GSPON | Google Sponsored (LSA) produces service leads | #105 | 68 leads 2026-08-01 | PROVEN |
| S-CRAWL-CL | Craigslist produces service leads at <= $0.05/lead | #178, #187 | 129 leads 2026-08-01 | PROVEN |
| S-CRAWL-YP | YellowPages produces service leads at <= $0.05/lead | #179 | not yet run | CODED |
| S-CRAWL-GMAPS | Google Maps produces service leads at <= $0.05/lead | #182 | 1,659 leads @ $0.0018 2026-08-01 | PROVEN |
| S-CRAWL-IG | IG-for-services — founder OVERRODE the IG rule and instructed it to keep running (2026-08-01). Producing, but no gate guards it yet. | — | 262 leads @ $0.0017 2026-08-01 | UNGUARDED |
| S-CRAWL-LSA | google_lsa produces leads WITH contact, via Apify (SerpAPI retired) | #193 | — | CODED |
| S-BOOK-PAID | A consumer completes a PAID booking end to end — **FINAL step of soft launch, after features stabilise (founder, 2026-08-01)** | — | — | SCHEDULED-LAST |
| S-LOOP-ACCEPT | A provider receives a request and accepts it | #143 | — | CODED |
| S-P01 | A visitor searches in plain English and gets the right kind of provider (not a fabricated match) | #13, #29, #67c, #68 | live walk 2026-08-01 | PROVEN |
| S-P02 | A blocked category (massage, tattoo, DJ…) never appears in results or the feed | #83, #96, A1j-v2, ontology-bridge-c | — | CODED |
| S-P03 | A search that finds nothing says so honestly — never a fake "we'll notify you" wait | #96, launch-02, #15 | live walk 2026-08-01 | PROVEN |
| S-P04 | A typed address is verified, saved, and never silently reverts | #21, #19, launch-06, launch-12-address-isolation | 134 Henry held 2026-08-01 | PROVEN |
| S-P05 | A budget or date can never be mistaken for the address | #A1c, #A1i | — | CODED |
| S-P06 | Submitting a request creates a real row and fans out to matching providers | #28, #55, #F34 | requests 276→277 | PROVEN |
| S-P07 | The requester is never notified about their own request | launch-05 | — | CODED |
| S-P08 | A matched provider is notified in-app AND by email, server-side | #125, #126, #143, #56 | housekeeper confirmed 2026-07-31 | PROVEN |
| S-P09 | A provider's inbox shows the request using the same matching rule as the fan-out | #127 | housekeeper confirmed 2026-07-31 | PROVEN |
| S-P10 | A guest tapping Inbox sees a calm empty state, never an endless spinner | #154 | live walk 2026-08-01 | PROVEN |
| S-P11 | A provider can accept a request and set a time, without creating duplicate bookings | #131, #56, #47j | — | CODED |
| S-P12 | A provider keeps a record of every offer they sent, after accept or decline | #134 | — | CODED |
| S-P13 | The service page shows the right CTA when that provider already sent an offer | #134 | — | CODED |
| S-P14 | A custom quote goes to the service being viewed, not the whole market | #136 | — | CODED |
| S-P15 | Listing a service uploads the provider's own photos, never a generic avatar | #133 | — | CODED |
| S-P16 | A listing always saves real coordinates, so it is reachable by search | #124, #111 | — | CODED |
| S-P17 | A $0 spotlight skips payment entirely and is exempt from the 24h expiry | #45, #47g | — | CODED |
| S-P18 | The barter loop requires a real IG post before the swap completes | #47, #47i, #53 | — | CODED |
| S-P19 | A Connector's reach and trust signals are real, never fabricated counts | #49, #92, #12 | — | CODED |
| S-P20 | Referral credit is server-authoritative and states the real rate and cap | #57, #A1g, #A1h | — | CODED |
| S-P21 | No screen promises equity, IPO or securities upside | #170 | live audit 2026-08-01 | PROVEN |
| S-P22 | Cold outreach is CAN-SPAM compliant and never auto-sends SMS | #65, #70, #83, #84 | — | CODED |
| S-B01 | The request flow captures the WHEN even from a typo ("tonoight") — it must not silently drop the time | — | founder-found 2026-08-01 | UNGUARDED |
| S-B02 | A requester can see their existing requests and any replies from one place | — | founder-found 2026-08-01 | UNGUARDED |
| S-B03 | Viewing a counter-offer shows a Book button AT THE COUNTER PRICE, not the generic profile CTA | — | founder-found 2026-08-01 | UNGUARDED |
| S-B04 | Accepting a counter-offer charges the card automatically (Stripe, testable with a test card) | — | founder-found 2026-08-01 | UNGUARDED |
| S-B05 | The IG story-highlight step is MANDATORY, not optional | — | founder-found 2026-08-01 | UNGUARDED |
| S-B06 | "Copy link" on a spotlight points at the SERVICE's profile, not the recommender's | — | founder-found 2026-08-01 | UNGUARDED |
| S-B07 | When a spotlight/IG review is submitted, the other party is notified to review and approve | — | founder-found 2026-08-01 | UNGUARDED |
| S-B08 | /services/manage opens the manage screen, never the first-time listing form | — | founder-found 2026-08-01 | UNGUARDED |
| S-B09 | The Inbox never shows duplicated jobs or notifications for the same booking | — | founder-found 2026-08-01 | UNGUARDED |
| S-192 | HARD SPEC: a lead with no phone AND no email is never saved — we do not pay for unreachable rows | #192 | — | CODED |
| S-193 | HARD SPEC: all paid crawling goes through Apify — SerpAPI is retired | #193 | — | CODED |
| S-237 | Each creator source stops ITSELF at CREATOR_TARGET and obeys the committed crawl switch; creator writes cannot fail silently on a missing column (is_business/created_at healed on the LIVE table) | #237 | — | CODED |
| S-238 | /status2 and /agents2 are dedicated founder URLs, aliases of /ops/status and /ops/agents (never copies) | #238 | — | CODED |
| S-239 | yelp is PAUSED by founder order, never deleted: out of CRAWLS_ONLY, kept in the rota + dashboards with rows, pause reason surfaced on the yelp row, fleet brief records the order not a defect | #239 | — | CODED |
| S-240 | PHASE1_CITY_QUOTA is the founder DMA formula ({"NY":50000,"FL":11700}, creators 5%): per-DMA buckets in both consumers, fail-closed map parsing, welded DMA→locations lists, Boston is the 9th metro | #240 | — | CODED |
| S-241 | growthPause agrees with the cron record: the paused set is EMPTY while the resume migrations schedule all five growth crons; pausing again = set + unschedule + gate in one commit | #119 | — | CODED |
| S-242 | Every cron job's FINAL schedule resolves its secrets: invoke via cergio_call_edge (Vault), never app.settings GUCs — a schedule that applies cleanly but can never run is a dead agent reading as scheduled | #242 | — | CODED |
| S-243 | Every services source stops ITSELF at SOURCE_AUDIT_CAP=100 leads (founder: "all sources not just creators.. 100 leads each max to review (except yelp)"): checked before the claim, fail-closed on unreadable counts, multi-name row counting via one shared map, capped state rendered on the founder screen | #243 | — | CODED |
| S-244 | The DMA is its own Nielsen definition, never the state column (founder: "that's unrelated to state.. use a standard DMA definition / boundary"): everything DMA-shaped keyed on codes 501/528, LOCATION→DMA decides membership first (Jersey City/Newark → 501), NJ/CT rows in-target, no boundary invented beyond founder-named seeds | #244 | — | CODED |
| S-245 | The founder's tiered crawl lists are committed (specs/CERGIO-CRAWL-LISTS.md) and encoded: TYPES derived from pinned tier arrays (Tier 1 in exact founder order, seeded first), every entry blocklist-verified, creator NICHE_TIERS with per-run tier budget, TARGET_CATEGORIES derived from niches (SPEC-86b quarantine trap closed), Phase 3 placeholder stands | #245 | — | CODED |
| S-246 | The audit is 100 FRESH leads per source (founder: "No I need 100 FRESH peices of DATA from each to VERIFY they're solid to scale"): cap counts rows since the committed AUDIT_FRESH_SINCE line; ig_services EXEMPT from the cap (dual-class, governed by CREATOR_TARGET — capping its service half closes the last paid creator path, the S-230 shape); creator-harvest on a TEMPORARY 15-min fast lane until the founder verifies ("override the 2 hours window of IG.. need data now") | #243 | — | CODED |
| S-248 | ig_services is EXEMPT from the contactability bar and its parked jobs are un-parked every run: the bar measures the SERVICE half of a dual-class source (6% for IG) and parking the queue was the third automatic rule to close the last paid creator path in one night (S-230 rule; founder IG override stands) | #243 | — | CODED |
| S-249 | The per-source audit board on /ops/data: absolute fresh-100 state per source, counts obeying every filter (class, DMA, location, type, time, rows), contactable drill-down (phone/email/both %), queue health incl. parked, per-source filtered download, and count errors surfaced verbatim — never a confident zero | #249 | — | CODED |
| S-251 | The fresh-100 queues actually run (founder: "they're not working.. need them up ... status of # our of 100 accurate"): duplicate-safe un-parks (the blanket form 400'd every run and un-parked nothing), spend guard + tranche gate count through the welded multi-name maps, balance floor measures FRESH rows, x/100 never displays past 100, and a dead queue says NO RUNNABLE JOBS instead of "crawling" | #251 | — | CODED |
| S-253 | Strict pay-per-delivery (founder: "been charging Apify WITHOUT any delivery... MUST institute a strict pay per delivery with 0.5 increments... can't spin wheels or spend on no delivery"): the $1 tranche ladder is dead — every paid source spends in $0.50 steps from the committed checkpoint (2026-08-03T20:30Z, the fresh-$10 line; the >$100 waste stays on the report but no longer decides the next step), the next $0.50 unlocks only when spend-since-checkpoint produced FRESH contactable leads at ≤$0.05/lead, spend = max(ledger, actor-level Apify meter) with the shared compass actor billed in full to each of its three sources (fail-closed), and a $5/source hard ceiling stops even a broken meter — worst case $3 across all six Apify sources with zero output | #253 | — | CODED |
| S-254 | YellowPages actor replaced (founder, 2026-08-04: "let's find an alternative for yellowpages... run the rest in the meantime... so i see 100 pieces of data per source"): trudax died in production — HTTP 403 monthly-limit then 400, $0.66 since the checkpoint for 0 leads, pay-per-delivery-blocked — replaced with solidcode~yellowpages-scraper (PAY-PER-RESULT $0.80/1,000, zero delivery = zero charge), input searchTerms[]+locations[] at metro level, APIFY_ACTOR_OF_SOURCE updated so the S-253 money meter follows the live actor, and the mapper now writes data_source under its rota name yellowpages_apify (legacy 'yellowpages' rows keep counting through the AUDIT_CAP_SOURCES alias) | #254 | — | CODED |
| S-255 | Craigslist actor replaced + checkpoint moved (founder, 2026-08-04: "and also one for craigslist that's cheaper... so i see 100 pieces of data per source"): memo23 measured $0.104/fresh-lead — 2x the $0.05 ceiling, blocked at $0.50 — replaced with solidcode~craigslist-scraper (PAY-PER-RESULT $1.40/1,000), input region (CL_SUBDOMAIN via metroOf; Jersey City/Newark → newyork added) + category label + head-noun searchTerm + maxResults ≤350 (one run can never blow a $0.50 step) + includeDetails, mapper reads phoneNumbers[]/emails[] and skips isDeleted; SPEND_CHECKPOINT_AT moves to 2026-08-04T16:30Z so the dead actors' $2.75 ($0.66 YP + $2.09 CL) does not eat the replacements' first $0.50 (gate #253 still passes) | #255 | — | CODED |
| S-256 | Total spend lock (founder, 2026-08-05: "added another $10... apify has now burnt through 195 with marginable delivery... there's leakage that drains budget once we scale... need this tightly locked.. there cannot be spending without delivery"): an ACCOUNT-month ceiling above the S-253 per-source steps — committed APIFY_MONTH_BASELINE_USD=$195 (the console reading at order time) + APIFY_MONTH_CEILING_USD=$10 (the new money), new spend = vendor month meter − baseline, checked FIRST in spendBlockedReason for every non-free vendor (yelp too; unparseable → ceiling 0, all paid crawling stops); need-bounded buys — ONE boundedBuy(need, cap) = max(10, min(cap, ceil(need × 1.5))) at all 4 paid apifyRun sites (CL/YP/IG/gmaps-lsa), sized from the audit-cap fresh counts (ig_services from CREATOR_TARGET remaining) so pay-per-result actors never bill rows past the remaining need; and in-tick meter freshness — bustSpendCaches() in apifyRun's finally clears the 60s vendor+actor caches so jobs 2..5 of a tick gate against post-spend truth | #256 | — | CODED |
| S-257 | The IG creator path searches CREATOR CATEGORIES, not service types (founder, 2026-08-05: "the services IG creators has 'junk removal' .. which wasn't part of the spec... the creators web crawling spec should have included multi step... (search top 25 micro to mid influencers (per each of the indicated cateogries), crawl names and emails and IG handles (visible from site ..) 3-get tel and email from website and or IG or other..."): the dual-class ig_services search is SPLIT — the service half keeps the service_type query (unchanged rows into leads_services), the creator half runs its OWN apifyRun over shared CREATOR_CATEGORIES (opsPayload — creator Tiers 1+2 of specs/CERGIO-CRAWL-LISTS.md in founder order, WELDED by gate to creator-harvest's NICHE_TIERS slugs; T3 follows the same shape when the founder clears it), first category in tier order under CREATOR_CAT_CAP=25 creator rows gets this job's search (a full category is skipped — "top 25 per category"), buy sized boundedBuy(min(creator-target remainder, category open slots), 25), rows stamped category=slug with discovered_via='ig-scraper-user-search' kept EXACT so CREATOR_TARGET/dashboard/audit eq() counts are untouched; the 3-step pipeline + micro-to-mid band (~10k–500k, a MARK never a drop) recorded verbatim in growth-controls _CREATOR_PIPELINE; creator-enrich (step 3) untouched | #257 | — | CODED |
| S-258 | /ops/data's PRIMARY view is a straight simple list of the filtered results (founder, 2026-08-05: "redesign the dashboard so it's very easy to view and click.. straight simple list of results (that changes dynamicaly with filter)"): one phone-friendly tappable zebra row per lead (name/handle · type-or-category · city · ☎ · ✉ · source chip · relative time) rendered from data.rows so every existing filter re-renders it, row click opens the best link in a new tab via the committed chain website_url → external_url → IG profile → yelp_url → cl_post_url (linkless rows are a plain div with no ↗ affordance), the SPEC-249 audit board + by-source panel move behind one default-collapsed "Source status" toggle (unchanged inside — gates #249/#251 pins hold), the size selector still feeds the fetch limit, and the empty/error states stay honest (verbatim errors, never a confident zero) | #258 | — | CODED |
| S-259 | CREATOR_TARGET counts only NEW-SPEC creator rows (founder, 2026-08-05: "share 100 new resuls from the creator new spec run... to complete the evaluation...."): the ONE ig creator-target count in fulfill-crawl chains .in(category, CREATOR_CATEGORIES slugs) after eq(discovered_via,'ig-scraper-user-search') — since SPEC-257 only creator-category-search rows carry a slug, so the old "junk removal" deviation rows (kept, never deleted — data is data) no longer stop the crawl ~67 short of the 100 new-spec rows the founder is evaluating; the same filtered count feeds the SPEC-256 need snapshot so buys size to the new-spec remainder; creator-harvest's like(se:web-harvest%) prefix count is pinned UNCHANGED (its rows carry their own category values — filtering it too would be the SPEC-230 closing-a-creator-path shape); rule + verbatim recorded in growth-controls _CREATOR_TARGET | #259 | — | CODED |
<!-- REGISTRY:END -->

## Open drift (found by #186 on its first run)

`S-CRAWL-YELP` and `S-CRAWL-YP` are **UNGUARDED**: their gates (#180 Yelp 240-ceiling,
#179 YellowPages live-actor swap) were written and pushed but PR #202 never merged, so
neither the fix nor its guard is on `main`. Yelp is producing 1,620 leads live with NO
gate protecting it — precisely the silent gap this registry exists to expose. Re-ship
both, then flip these rows.

## Readiness

Computed by `node scripts/spec-readiness.mjs` and printed by the QA suite.
The only number that answers "is this ready to soft launch?".
