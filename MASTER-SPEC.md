# CERGIO — MASTER SPEC

**Single entry point. Everything referenced from here. Generated 2026-08-01.**

Nothing is duplicated into this file — duplication creates a second source of truth and
that is how drift starts. This is the INDEX plus the two things that are authoritative:
the founder's own words, and the machine-checked criterion table.

Gate `#186` fails the build if the criterion table drifts from the gates.
Gate `#194` fails the build if a spec file exists that this index does not name.

---

## 1 · Where every part of the spec lives

| File | What it holds |
|---|---|
| `FROZEN_SPEC.md` | Every frozen behaviour, dated, as agreed in chat. 59 sections. THE product spec. |
| `MARKETPLACE_SPEC.md` | Marketplace model — roles, barter loop, pricing, Connector economics. |
| `CRITICAL_FLOWS.md` | The end-to-end journeys that must never break. |
| `SPEC-REGISTRY.md` | The machine-checked criterion table (mirrored below; gate #186 validates it). |
| `CLAUDE.md` | Operating rules for whoever/whatever is building. Read every session. |
| `ROADMAP.md` | Sequence and phasing. |
| `CHECKLIST.md` | Pre-launch checks. |
| `SVP_FLOW_MAP.md` | Screen-by-screen flow map. |
| `TEST_PLAN_MONEY_FLOWS.md` | How the money paths must be tested — payment, holds, release, referral credit. |
| `REVIEWER_PROMPT.md` | The brief a reviewer works from. |
| `README-RUN.md` | How to run the project. |
| `OFF_MAC_DEPLOY.md` | The off-Mac ship pipeline (SPEC-81). |
| `GOOGLE_CONTACTS_SETUP.md` | Gmail contacts import setup (SPEC-52). |

---

## 2 · Founder instructions — VERBATIM, and binding

These outrank every inference. Where anything below conflicts with a paraphrase
elsewhere, these win.

| Date | Area | Tarik's words |
|---|---|---|
| 2026-08-01 | **LEAD QUALITY** | *"the spec specifically calls for email and or phone... without it the lead is useless.. we can't SPEND on lists that don't have email and or phone... This should have been a HARD spec"* |
| 2026-08-01 | **VENDORS** | *"we decided to switch out serpapi with apify... all paid should be apify as it's most economical and or best crawler"* |
| 2026-08-01 | **SPEND** | *"we can never spend another $1 without output"* |
| 2026-08-01 | **SPEND** | *"implement a rigourous $1 increment verification against output for each source... then raise the volume gradually once ALL crawls are up"* |
| 2026-08-01 | **INSTAGRAM** | *"continue running IG (override)"* |
| 2026-08-01 | **PAYMENT** | *"schedule payment feature as final step of soft launch (after we stabilise features)"* |
| 2026-08-01 | **METHOD** | *"one micro feature at a time... bind it to the spec so it never drifts"* |
| 2026-08-01 | **METHOD** | *"do not improvise... follow my instructions rigorously"* |
| 2026-07-30 | **METHOD** | *"NEVER GUESS AGAIN.. ALWAYS MEASURE AND DELIVER FACTUAL DIAGNOSES AND DEFINITIVE SOLUTIONS"* |
| 2026-07-28 | **REPORTING** | *"no claim of works/live/verified without a live artifact — Tarik relays status to investors"* |
| 2026-08-01 | **BUG · request** | *"mistyped and didn't pick the time"* |
| 2026-08-01 | **BUG · request** | *"Add place to see existing requests and any replies"* |
| 2026-08-01 | **BUG · book** | *"When viewing a reply to book, and seeing profile of the service, need to showcase the booking button with the price (from the counter).. not the generic request to book on profile"* |
| 2026-08-01 | **BUG · book** | *"user needs to pay when accepting a counter offer ... so their card is charged automatically"* |
| 2026-08-01 | **BUG · IG** | *"post story highlight should be mandatory not optional"* |
| 2026-08-01 | **BUG · IG** | *"copy link should take to profile of the service not the recommender"* |
| 2026-08-01 | **BUG · IG** | *"tarik.sansal2@gmail.com didn't get notified that t@cergio submitted IG review and post.. need a notification to review and approve"* |
| 2026-08-01 | **BUG · listing** | *"wrong form / screens here https://cergio.ai/services/manage"* |
| 2026-08-01 | **BUG · inbox** | *"duplicated notifications and jobs"* |

---

## 3 · The criterion table — what is PROVEN, what is not

`PROVEN` = criterion + mutation-tested gate + dated live evidence.  
`CODED` = exists, never demonstrated live — **not trustworthy**.  
`UNGUARDED` = no gate; regresses silently.  
`SCHEDULED-LAST` = deliberately the final step before launch.

<!-- REGISTRY:START -->
| SPEC ID | Behaviour | Gate | Live proof | Status |
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
| S-260 | /ops/data v3 — sources first, results on demand, compact filters, legacy creator rows out (founder, 2026-08-05: "creators have junk removal.. need to see a list of results accross SOURCES like in the table shared above.. to quickly scan sources.. (ahead of actual results.. i don't need to see results unless i download them or ask to load them on the screen).. redesign the filters so they're far easier to view more intuitive less bulky.."): the per-source SCAN TABLE (SPEC-249 board data — fresh x/target with the #251 Math.min rule, state with failures in danger red and FAILED never a confident 0, filtered rows, ☎/✉/both %, queue new/parked, per-source ⬇ CSV) is the PRIMARY always-visible view (S-258's collapsed toggle superseded, amended in gate #258 in place); the LeadRow list renders only after "Load results (N)" — RENDER-deferred, because the server treats limit:0 as the 1000 default and CSV-without-list needs the rows client-side anyway, so limit:size and every LeadRow/bestLink pin stand; filters compacted — segmented Services/Creators toggle (crawls/runs stay as quiet pills per #210), city pills All·NYC·Miami with the locality select only after a city is picked, one row for source+type/category, status/reachable/time/size behind a default-closed "More filters" disclosure, active non-default filters as removable chips, tokens only; Creators view default-EXCLUDES rows whose category is not one of the 12 CREATOR_SLUGS (client-side — leads-dashboard has no NOT-IN; welded by gate #260 to opsPayload CREATOR_CATEGORIES) from the visible rows AND all three CSV paths, unless a category is explicitly picked or the default-off "Show legacy rows from the pre-category run" checkbox is ticked — rows stay in the DB, display only | #260 | — | CODED |
| S-261 | The dashboard number and the CSV are the SAME query — trust weld (founder defect report, 2026-08-05: "IG scraper download had 1 record.. shoed 100 in download with 10% phone.. how can we trust the dashboard"): measured cause — board/filteredTotal were SERVER-side counts over the full filtered set while the CSV was a ROW_CAP page (newest-first, and NULL timestamps sort FIRST in Postgres desc so undated rows hijack the page) that the screen then filtered CLIENT-side (the SPEC-260 legacy exclusion) — count-population ≠ rows-population; leads-dashboard gains categoriesIn (string array or null) applied .in(category) to BOTH the rows query and the count query (a single explicit category is more specific and wins), the rows order becomes .order(tsCol,{ascending:false,nullsFirst:false}), the creators BOARD row for ig-scraper-user-search counts the NEW-SPEC population only (category ∈ the 12 CREATOR_CATEGORIES slugs — SPEC-259's definition of the creator hundred, imported from _shared/opsPayload.ts) with ☎/✉/both % over that SAME population (se:web-harvest unchanged — its rows are category-driven by construction), and the response carries the honesty bit rowsMatchCount = rows.length >= min(filteredTotal, ROW_CAP); the screen passes categoriesIn: CREATOR_SLUGS server-side under the exclude-legacy condition in ALL three fetch paths (load/view, downloadSource, downloadEach — the client .filter(isNewSpecCreator) stays as a belt-and-braces no-op guarding a stale slug copy), every CSV path warns "CSV has N rows; the count says M — mismatch, do not trust this export" via csvMismatch instead of silently saving fewer, the visible list warns on rowsMatchCount === false, and every CSV filename appends "(N rows)" as its own receipt | #261 | — | CODED |
| S-262 | Profile IA v2 (founder redesign handoff 2026-08-05, design_handoff_profile_booking — the ONE screen where the IA changes, STYLE_MIGRATION "the one exception already agreed"): /u/:profileId rebuilt to the founder's v2 element order — name · Local Creator badge + service FacetBadges · followers on Cergio (mutuals NAMED) · recos made · IG handle · follower count · creator line (creators only) · per-service facet block with NAMED "recos received incl …" + blurb · IG Spotlights (received / made, honest counts) · Services cards (facet + reco count, cover, offering title + price, DATED lead reco quote via QuoteBubble) · "Services Recommended by {First}" (renamed from Go-Tos, trust-first recoByline + owner SocialReachLine + dated reco); three profile shapes = ONE component, empty sections omitted; Share joins the top bar as a copy-link (Request/Message/Recommend gone — Request lives on the PDP; Follow stays); rendered with the PR-2 UI kit, zero raw hex in the migrated file; ProfileSignalBlock mount, serviceMode flip, standalone Recommendations-received section + RecoRow superseded on this screen only (SPEC-49h; the #49 gates amended in place, block lives on at /inbound); data layer unchanged — SPEC-49d count rule, no services-consumed section, real spotlight tiles, /u/:id/services after 3 all stand | #262 | — | CODED |
| S-263 | Service PDP v2 (founder redesign handoff 2026-08-05, Service PDP.dc.html + PATCHES §3/§4): ServiceDetailScreen rebuilt to the design's three price states, all resolved in src/lib/servicePricing.js priceForViewer — viewer-gated FREE (services.free_for_connectors AND the viewer's own cc_verified_at; non-creators see the price and can still request free), service-WIDE discount (services.discount_pct, one rate every offering, never per-offering), plain price; legacy $0 offerings keep the struck comparable (2026-05-30 rule); "Leave a go-to review" removed from the PDP (reviews are post-booking only — the composer stays in rate+post); recommenders select grows avatar_url (PR-1 deferral, gate #159 amended in place) and services select grows the two PR-1 pricing columns; rendered with the PR-2 kit (Avatar/FacetBadge/Card/SectionTitle/SeeAllLink), token paper #FFFBF3 added, zero raw hex left; reply-offer (FW-7) + live-offer (SPEC-135) CTAs, targeted custom quote (#136), no-recommend-modal (SPEC-53), 49g streams + real story ruler, SEO meta all stand | #263 | — | CODED |
<!-- REGISTRY:END -->

---

## 4 · Frozen spec sections — the full index

All 59 sections in `FROZEN_SPEC.md`, titles verbatim. Open that file for the full text.

| SPEC | Title (verbatim) |
|---|---|
| `SPEC-42` | Results waiting state copy |
| `SPEC-43` | Invite contacts scoped to real network only |
| `SPEC-44` | Geocoder error suppressed when Nominatim succeeds |
| `SPEC-12` | No mock data on signed-in paths (pre-existing, qa.mjs #12) |
| `SPEC-45` | Free ($0) spotlight swap invariants |
| `SPEC-46` | Reco form contacts: device-only, single-select, auto-populate |
| `SPEC-CQ1` | Influencer follower band |
| `SPEC-CQ2` | Reported influencer counts use quality-gated query |
| `SPEC-47` | Free-service barter completion loop + gate |
| `SPEC-47c` | Mark-complete + rate-with-post (FROZEN 2026-06-15, Tarik): |
| `SPEC-47d` | Spotlight = the Connector's UNIQUE referral link, Story-first (FROZEN 2026-06-15, Tarik). |
| `SPEC-47h` | Provider accept-with-time → confirmed booking + reschedule (FROZEN 2026-06-16, Tarik). |
| `SPEC-47i` | Forced barter post-gate on the Connector (FROZEN 2026-06-16; rev 2026-06-18, Tarik — fires EARLIER). |
| `SPEC-47g` | Paid 3-hr auto-release (PLANNED — NOT YET BUILT, Tarik 2026-06-16). |
| `SPEC-47f` | IG post tile on feed + Previous spotlights (FROZEN 2026-06-16, Tarik). |
| `SPEC-47e` | Below-4★ private review dispute (FROZEN 2026-06-16, Tarik). |
| `SPEC-48` | Inbound connector-request screen required elements |
| `SPEC-48b` | Booking detail parity + new-card-only inbox. |
| `SPEC-48c` | Party-signal ordering RULE (FROZEN 2026-06-15, Tarik: "make it a rule… lead with the same info next to each us |
| `SPEC-49` | Viewer-prioritized unified profile (service / connector / both) |
| `SPEC-49b` | Profile layout + IG de-duplication (FROZEN 2026-06-17, Tarik). |
| `SPEC-49c` | Services lead their own recommendations + dedicated all-services page (FROZEN 2026-06-17, Tarik). |
| `SPEC-49d` | "Recos made" count INTENTIONALLY exceeds what Go-Tos displays (FROZEN 2026-06-17, Tarik). |
| `SPEC-49e` | Connector-first hierarchy + spotlight track record on the full profile (FROZEN 2026-06-18, Tarik). |
| `SPEC-49f` | Recommendations-received section (FROZEN 2026-06-18, Tarik). |
| `SPEC-49g` | Reputational streams everywhere (FROZEN 2026-06-25, Tarik — "the game-changers"). |
| `SPEC-50` | Action-first inbox Overview |
| `SPEC-51` | Spotlight click tracking (connectors + services) |
| `SPEC-52` | Contacts import: native picker + Gmail + file fallback |
| `SPEC-52b` | Single clear path, Gmail is the permanent web gold standard (FROZEN 2026-06-18, Tarik — "do (b), it's a perman |
| `SPEC-53` | Recommendations come from a completed booking (rate + post); IG post optional when paid |
| `SPEC-54` | Find-a-Connector roster shows ACCEPTED connectors only (with the agreed price) |
| `SPEC-55` | Provider fan-out must re-hydrate services_near rows before the provider-type filter |
| `SPEC-56` | Recommendation + accept-with-time must fire their notifications |
| `SPEC-57` | Referral settlement — SERVER-AUTHORITATIVE (the growth-engine money path) |
| `SPEC-58` | On-demand city expansion (app REQUESTS crawls; it never crawls) |
| `SPEC-59` | Credit-card identity gate on POST (test accounts bypass) |
| `SPEC-60` | No duplicate listings + PDP polish (terminology / lines / free-form request) |
| `SPEC-61` | SEO part 1 — per-record document meta (SSR is part 2) |
| `SPEC-62` | SEO part 2 — server-rendered link previews for crawlers |
| `SPEC-63` | Crawl pipeline monitoring + failure alerts (can't fail silently) |
| `SPEC-64` | In-app crawl fulfillment (no crawl → no notify, fixed) |
| `SPEC-65` | Automated business outreach (compliant, opt-out enforced) |
| `SPEC-68` | Influencer contact enrichment (safe, non-IG) |
| `SPEC-69` | Periodic workers (self-running pipeline) |
| `SPEC-RPC1` | Never call `.catch()` on a supabase.rpc() builder |
| `SPEC-70` | Soft-launch opt-in barter outreach (the seam into the growth system) |
| `SPEC-71` | Founder-frozen decisions (2026-07-09) — authoritative, testable |
| `SPEC-72` | Operating law: firing-honesty + max output (2026-07-09, FROZEN) |
| `SPEC-73` | Every failure records a REAL reason — "[object Object]" is banned |
| `SPEC-74` | A worker that finds rows and writes none must say WHY (no silent success) |
| `SPEC-75` | A defect may not sit unfixed — staleness escalates |
| `SPEC-47j` | Scheduled-vs-instant is a WRITE-TIME invariant |
| `SPEC-78` | Launch blockers from the founder's own walk (2026-07-14, FROZEN) |
| `SPEC-79` | Launch blockers round 2 — founder live walk (2026-07-16, FROZEN) |
| `SPEC-80` | Ontology bridge — the search↔listing near-miss CLASS fix (2026-07-16, FROZEN) |
| `SPEC-81` | OFF-MAC BY DEFAULT (2026-07-16, FROZEN) |
| `SPEC-83` | SMS is OPT-IN ONLY — explicit consent before any text (2026-07-16, FROZEN) |
| `SPEC-86` | CREATOR DATA QUALITY GATE — no fabrication, verified only (2026-07-18, FROZEN) |

---

## 5 · Provenance rule

Every criterion must trace to one of three sources. Anything else is not spec:

1. **Founder verbatim** — section 2 above, or a dated quote in `FROZEN_SPEC.md`
2. **Frozen spec** — a `SPEC-xx` section
3. **Founder-approved** — written by the founder into the review sheet

A paraphrase by the builder is **never** a criterion. Every failure on 2026-08-01
came from that substitution: a rule invented by inference, then locked in by a gate,
then enforced with discipline against the wrong target.
