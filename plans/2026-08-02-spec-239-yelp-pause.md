# SPEC-239 — yelp: paused by founder order, never deleted, and the dashboard says so

Founder, 2026-08-02, verbatim: "ignore yelp as a source" → clarified "don't delete
yelp.. just pause as a source"

## What "paused" means (encoded, not implied)

- yelp stays OUT of CRAWLS_ONLY (growth-controls.json) — that absence IS the pause.
- yelp stays IN fulfill-crawl's SOURCES_RR and the dashboard SOURCES list; rows kept.
- The pause reason (founder verbatim) travels on the ops payload
  (`crawls.source_states.yelp`) and renders on the yelp row of /ops/status — an
  unexplained idle source reads as broken, and "broken" sources get deleted as cleanup.
- agents/fleet.json crawl-sources: the "yelp is a third paid vendor" DEFECT is replaced
  with the standing order (NOT-A-DEFECT) so the subagent stops hunting a founder
  decision as a bug. Gate #239 added to its gates.

## Gate

`#239` — fails if yelp enters CRAWLS_ONLY, falls out of the rota or the dashboard list,
the reason leaves the payload or the screen, or the fleet brief regresses to calling
the pause a defect. Scans RAW text (reason lives in string literals — the Part-6
template-literal trap). Mutation-tested 7 ways (all killed, see PR).

Re-activation is a founder decision: update the gate with the new verbatim order.
