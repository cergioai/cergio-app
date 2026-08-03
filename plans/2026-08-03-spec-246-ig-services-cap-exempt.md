# SPEC-246 — the fresh-100 audit (corrects SPEC-243)

**Founder, 2026-08-03, verbatim:** "No I need 100 FRESH peices of DATA from each to
VERIFY they're solid to scale" · "override the 2 hours window of IG.. need data now...
we'll reinstate schedule after we verify data is solid"

Three parts, one feature: (1) the audit cap counts FRESH rows only — fetched_at ≥ the
committed AUDIT_FRESH_SINCE line — so every source crawls a NEW hundred and then stops,
instead of pausing instantly on historical rows; (2) ig_services is exempt from the cap
(below — the original finding); (3) creator-harvest moves to a TEMPORARY 15-minute fast
lane (migration 20260803030000), reinstate '17 */2 * * *' after founder verification.

## Part 2 as originally found — ig_services exempt from the audit cap

Found by reading the LIVE table an hour after SPEC-243 merged, not by a gate — recorded
here so the gate that now exists (#243, ig_services assertion) has its story.

Live facts at 02:18Z: leads_services 21,552 with ig_services at 262; leads_influencers
at **0**. SPEC-243's cap counted ig_services' SERVICE half (262 ≥ 100) → it dropped out
of the rota → its DUAL-CLASS creator half could never run → the 100-creators founder
target was unreachable by its only paid path, while the screen said "audit-cap met".
That is the SPEC-230 failure shape verbatim: three defensible-looking decisions once
closed every creator path; no automatic rule may remove the last path to a founder-set
target.

## The change

`AUDIT_CAP_SOURCES` loses its `ig_services` entry (its stop is CREATOR_TARGET,
pre-claim, since SPEC-205 — unchanged). Gate #243 gains a mutation-tested assertion
that ig_services can never re-enter the map. A growth-fire file rides along so
growth-setup regenerates GROWTH-STATUS.md after merge and the creator counts are
re-measured live.

Trade-off recorded: ig_services' service rows may exceed 100 while it chases the
creator target. The founder audits sample-100-ig_services.csv (newest-first), so the
100-to-review contract holds.
