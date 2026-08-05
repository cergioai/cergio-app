# SPEC-256 — the total spend lock (month ceiling + need-bounded buys + fresh meter)

Founder, 2026-08-05, verbatim: "added another $10... apify has now burnt through 195
with marginable delivery ... (including $~15 since we last implemented the tight hard
deliver against spend controls...)... there's leakage that drains budget once we
scale... need this tightly locked.. there cannot be spending without delivery"

## Measured leak vectors (given, not re-derived)
1. NEED-BLIND BUYS: paid runs request fixed maxItems regardless of remaining need
   (CL `|| '250'`, YP `|| '60'`, GMAPS `|| '60'`, IG `|| '200'`). Every returned row bills.
2. STALE METER IN-TICK: `_vendorSpendCache` / `_actorSpendCache` hold 60s; a tick
   processes ~5 jobs, so jobs 2..5 gate against the pre-job-1 meter.
3. NO ACCOUNT-MONTH CEILING: nothing in code stops the account month total if
   per-source math is ever wrong.

## Changes
1. growth-controls.json: `APIFY_MONTH_BASELINE_USD: "195"` (the meter as the founder
   read it when ordering the lock) + `APIFY_MONTH_CEILING_USD: "10"` (max NEW money
   this month for the WHOLE account). Fail CLOSED: unparseable → ceiling 0 → all paid
   crawling stops.
2. fulfill-crawl:
   a. `MONTH_BASELINE` / `MONTH_CEILING` consts near the SPEC-253 block (NaN → 0 for
      BOTH — a NaN baseline must read the whole meter as new spend so the lock fires;
      Infinity would make it unfireable). `apifyMonthLockReason()` returns the
      `MONTH LOCK: ...` reason when (meter − baseline) ≥ ceiling, called FIRST in
      spendBlockedReason for any vendor !== 'free' (yelp included), before per-source math.
   b. Need-bounded buys: module-level fresh-count snapshot written by the audit-cap
      pre-claim block (+ creator-target block for ig_services); `remainingNeed(source)`
      + ONE `boundedBuy(need, cap)` = `Math.max(10, Math.min(cap, Math.ceil(need * 1.5)))`
      at all 4 paid apifyRun call sites (CL, YP, IG, GMAPS — gmaps covers lsa/sponsored
      via provenance). Unknown need → cap (existing env caps stay the upper bound).
   c. `bustSpendCaches()` clears `_vendorSpendCache` + all `_actorSpendCache` keys;
      invoked in apifyRun's `finally` so EVERY paid run (success or error) busts the
      caches at the one choke point — no per-call-site drift.
3. qa.mjs gate #256 `month-lock-need-bounded-buys-no-spending-without-delivery`
   (raw-text asserts, each with the money consequence; mutation-tested one by one).
4. S-256 rows (CODED, #256) in SPEC-REGISTRY.md + MASTER-SPEC.md.

## Verify
node scripts/qa.mjs (240, 0 fail) → mutation FAIL lines → tdz-guard → deno-guard →
npx vite build. No commit/push.
