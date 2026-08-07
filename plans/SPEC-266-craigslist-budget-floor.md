# SPEC-266 — craigslist budget floor: defer, never burn (the "43s sync timeout" fix)

Date: 2026-08-07. Handoff task 4 ("craigslist to 100 — timeout bump"). MEASURED shape:
craigslist sits at 20/100 fresh; agent notes show runs where actorTimeoutSecs collapsed to
~43s because the job was claimed near the end of the tick's budget (msLeft(140000) returns
the scraps). solidcode~craigslist-scraper opens every post's detail page (includeDetails —
that is where phoneNumbers[]/emails[] come from), so a 43s window kills the run mid-crawl.
Today that job is then stamped 'delivered' with a timeout note and CONSUMED — the source
starves one job at a time while looking merely unlucky.

A literal "timeout bump" is impossible: the edge wall is ~150s and apifyRun already caps at
msLeft(140000). The honest fix is a FLOOR: if the remaining tick budget is under
CL_MIN_BUDGET_MS (75s), do NOT call the vendor at all (zero spend — the money gates never
even see a claim) and hand the job BACK (status 'new', the same shape as the orphan-reclaim
at line ~467), so it retries next tick where an earlier claim slot gives it a real window.

## Change (ONE micro-feature)
- fulfillCraigslist: top-of-function floor check → returns {defer: true, note} without any
  vendor call. CL_MIN_BUDGET_MS = 75000.
- craigslist caller branch: when r.defer, update the job to status 'new' + note (never
  'delivered', never cost_usd — nothing was spent, nothing was consumed).
- Money: STRICTLY less spend (a doomed pay-per-result run bills its partial results today;
  the deferred run bills nothing). All #253-#256 controls untouched.

## Gate #266 (mutation-tested)
Pins: the floor constant, the pre-vendor position of the check (before apifyRun in the
function body), the defer flag path in the caller writing status 'new' (not 'delivered'),
and that the defer path writes no cost_usd.
