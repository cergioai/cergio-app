# SPEC-249 — the per-source audit board on /ops/data

**Founder, 2026-08-03, verbatim:** "need to see a clear per source status filetrable by
last 100 500 etc and time... filetrable by creators or services and per service type...
i can't see this right now.. so i don't know what's working and what's not and how to
download" + "per city and per location" + "with contactable % (with drill down to
(email%) % phone) % both"

One row per source on /ops/data (leads-dashboard + DataExportScreen): ABSOLUTE state
(fresh-100 progress vs the committed line — unfiltered, or a time filter reads as a
dying source), counts obeying every screen filter, phone/email/both %, queue new/parked,
and a per-row CSV download that carries the current filters. Every count error is
surfaced VERBATIM on the row — the ops console swallowed count errors into `?? 0` and
the founder saw "Services total 0" beside a reason string naming 166 real rows. Board
queries run sequentially (candidate cause for the console zeros is burst failure —
unmeasured; the board will name it on screen if so).

Gate #249 mutation-tested 5 ways (swallowed error, dropped DMA filter, dropped both%
computation, board not returned, download drops filters — first pass caught a gate that
matched field NAMES instead of computations; pinned the computations).

NOT in this PR: the ops-console (/status2) zeros fix — that is SPEC-250, after the
board's error surfacing has named the cause live.
