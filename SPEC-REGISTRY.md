# Spec Registry — what is PROVEN, what is not

One row per micro-feature. A row is **PROVEN** only when all four columns are real.
The drift detector (`qa.mjs` #186) fails the build if this file and the gates separate.

**Status meanings**
- `PROVEN` — spec line + mutation-tested gate + dated live artifact. Trustworthy.
- `CODED` — code and gate exist, never proven live. **Not** trustworthy.
- `UNGUARDED` — spec line with no gate. This is where regressions come from.
- `BLOCKER` — required for soft launch and not proven.

<!-- REGISTRY:START -->
| SPEC ID | Behaviour (plain English) | Gate | Live proof | Status |
|---|---|---|---|---|
| S-152 | A signed-in user clicking "Claim your founding spot" goes to the listing flow, never back to the login screen | #157 | live walk 2026-08-01 | PROVEN |
| S-152b | The claim CTA carries its destination through sign-in, so a new user lands on the listing flow after auth | #158 | live walk 2026-08-01 | PROVEN |
| S-153 | The homepage shows a FREE entry point under the search box, naming both sides of the offer | #160 | screenshot 2026-08-01 | PROVEN |
| S-154 | A provider reading a recommendation can click through to the Connector's real Instagram account | #159 | — | CODED |
| S-159 | No screen may reference an identifier that is not bound in its scope | #164, #165, #170 | homepage restored 2026-08-01 | PROVEN |
| S-174 | Every crawl source is scheduled every run; none can be starved by another | #181 | per-source table 2026-08-01 | PROVEN |
| S-177 | A worker never writes a column the growth schema lacks, and a write failure is never swallowed | #177 | leads 1067 -> 2816 | PROVEN |
| S-183 | A metered vendor run is cancelled server-side at our deadline, so an abandoned run cannot keep billing | #183 | — | CODED |
| S-185 | No paid source may spend past its $1 tranche without producing leads at <= $0.05/lead | #185 | spend ledger | CODED |
| S-CRAWL-OSM | OpenStreetMap produces service leads for Miami + NYC, free | #64 | 1,107 leads 2026-08-01 | PROVEN |
| S-CRAWL-YELP | Yelp produces service leads within its 240-result ceiling | — | 1,620 leads 2026-08-01 | UNGUARDED |
| S-CRAWL-GSPON | Google Sponsored (LSA) produces service leads | #105 | 68 leads 2026-08-01 | PROVEN |
| S-CRAWL-CL | Craigslist produces service leads at <= $0.05/lead | #178 | — | CODED |
| S-CRAWL-YP | YellowPages produces service leads at <= $0.05/lead | — | — | UNGUARDED |
| S-CRAWL-GMAPS | Google Maps produces service leads at <= $0.05/lead | #182 | — | CODED |
| S-CRAWL-IG | IG-for-services — **policy decision required before any spend** | — | — | BLOCKER |
| S-CRAWL-LSA | Google Local Services Ads resolves a metro CID and produces leads | #173 | — | CODED |
| S-BOOK-PAID | A consumer completes a PAID booking end to end | — | — | **BLOCKER** |
| S-LOOP-ACCEPT | A provider receives a request and accepts it | #143 | — | CODED |
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
