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
| S-159 | No screen may reference an identifier that is not bound in its scope | #164, #165, #170 | homepage restored 2026-08-01 | PROVEN |
| S-174 | Every crawl source is scheduled every run; none can be starved by another | #181 | per-source table 2026-08-01 | PROVEN |
| S-177 | A worker never writes a column the growth schema lacks, and a write failure is never swallowed | #177 | leads 1067 -> 2816 | PROVEN |
| S-183 | A metered vendor run is cancelled server-side at our deadline, so an abandoned run cannot keep billing | #183 | — | CODED |
| S-185 | No paid source may spend past its $1 tranche without producing leads at <= $0.05/lead | #185 | spend ledger | CODED |
| S-CRAWL-OSM | OpenStreetMap produces service leads for Miami + NYC, free | #64 | 1,107 leads 2026-08-01 | PROVEN |
| S-CRAWL-YELP | Yelp produces service leads within its 240-result ceiling | #180 | 1,620 leads 2026-08-01 | PROVEN |
| S-CRAWL-GSPON | Google Sponsored (LSA) produces service leads | #105 | 68 leads 2026-08-01 | PROVEN |
| S-CRAWL-CL | Craigslist produces service leads at <= $0.05/lead | #178 | — | CODED |
| S-CRAWL-YP | YellowPages produces service leads at <= $0.05/lead | #179 | — | CODED |
| S-CRAWL-GMAPS | Google Maps produces service leads at <= $0.05/lead | #182 | — | CODED |
| S-CRAWL-IG | IG-for-services — founder APPROVED 2026-08-01, sequenced AFTER Meta app review resolves (4 frozen-spec features depend on that approval) | — | — | DEFERRED |
| S-CRAWL-LSA | Google Local Services Ads resolves a metro CID and produces leads | #173 | — | CODED |
| S-BOOK-PAID | A consumer completes a PAID booking end to end — **FINAL step of soft launch, after features stabilise (founder, 2026-08-01)** | — | — | SCHEDULED-LAST |
| S-LOOP-ACCEPT | A provider receives a request and accepts it | #143 | — | CODED |
<!-- REGISTRY:END -->

## Founder decisions (2026-08-01)

1. **`ig_services` — APPROVED.** Tarik green-lit overriding the Instagram-scraping rule.
   Recorded and sequenced AFTER Meta app review resolves: FROZEN_SPEC gates the IG media
   grid, the oEmbed caption audit and the post tiles on "once Meta Graph access is
   approved", so scraping during review risks the approval those features need. Timing
   only — not a veto. Founder may override at any time.
2. **Paid booking — FINAL step.** Stabilise features first; payment is the last thing
   before soft launch. It therefore no longer blocks day-to-day work, but it remains the
   single gate that must be green before launching.

## Drift closed (found by #186 on its first run, fixed same day)

#186 caught that gates #179/#180 were written and pushed but PR #202 never merged, so Yelp
was producing 1,620 leads live with NO gate protecting it. Recovering them exposed a second
thing nobody had seen: the YellowPages trudax swap had **half-landed** — the comment named
trudax while the actual call still used the DEPRECATED cryptosignals actor. A half-merge
that reads correct. Both are now genuinely on `main` and both rows are re-bound.

## Readiness

Computed by `node scripts/spec-readiness.mjs` and printed by the QA suite.
The only number that answers "is this ready to soft launch?".
