# SPEC-251 — the fresh-100 queues actually run + honest board math

**Founder, 2026-08-03, verbatim:** "they're not working.. need them up ... and status
of # our of 100 accurate"

Measured from the live board (its own error-surfacing design): five sources at "0 of
100 FRESH — still crawling" with ZERO runnable jobs and 2,506–13,037 PARKED each.
Three mechanisms, all closed in this PR:

1. **The blanket un-park 400'd every run** (23505 on crawl_requests_open_uniq — re-
   opening every parked row re-creates duplicate open triples), so "un-parked ?" had
   un-parked NOTHING for nights while the spend guard and throttle kept parking more.
   All un-parks are now duplicate-safe: one earliest parked row per (city, type,
   source) triple, only where no open row exists — cannot violate the index.
2. **Single-name lead counting starved producing sources.** The spend guard (Node) and
   tranche gate (Deno) counted `data_source = rota-name`; yellowpages_apify writes
   'yellowpages', read as 0 beside 859 real rows, and was re-parked every cycle.
   Both now count through the multi-name map — AUDIT_COUNT_KEYS (Node) welded
   byte-for-byte to AUDIT_CAP_SOURCES (Deno) by gate #251.
3. **The balance floor measured TOTAL rows** — every producing source read "far ahead"
   on history and got throttle-parked while its FRESH count sat at 0. It now measures
   fresh rows since the committed AUDIT_FRESH_SINCE line (read from growth-controls.json).

Board honesty: x/100 never displays past 100 (overshoot in the detail — the cap gates
claims, one in-flight tick can land more than the remainder), and a source whose queue
holds nothing runnable says **NO RUNNABLE JOBS** in red, never "still crawling".

Gate #251 mutation-tested 7 ways; first pass caught the gate itself scanning stripped
template literals (counts of 0 vs 0 can never fail) — moved to raw text, re-verified.
A growth-fire file runs the revived un-park immediately on merge.
