# SPEC-241 — growthPause.ts agrees with the cron record

Handoff item 3 (2026-08-02): growthPause.ts still listed creator-harvest (and the
other four growth agents) as PAUSED while 20260731020000_resume_growth_on_growth_db.sql
rescheduled ALL five crons (and 20260802170000 restored creator-harvest again) — the
file's own same-commit rule was violated on resume, leaving two sources of truth. The
orchestrator's self-heal therefore refused to revive exactly the agents that were
supposed to be running, and a stalled scheduled agent read as "paused on purpose".

## Change

- PAUSED_GROWTH_AGENTS is now EMPTY; the mechanism (orchestrator import + skip,
  crawl-health isGrowthPaused) stays for the next emergency. "Are we crawling?" is
  answered by growth-controls.json (SPEC-207/237/239), enforced inside the functions.
- Gate #119 flipped its membership pins: the five names must NOT be in the set while
  their crons stand (scans stripComments — the names live in the history comment).
  Mechanism asserts unchanged. Mutation-tested: re-adding creator-harvest FAILS.
- Pausing again = add names + unschedule crons + update #119, in ONE commit.
