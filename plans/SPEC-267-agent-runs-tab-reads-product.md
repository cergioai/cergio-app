# SPEC-267 — the Agent-runs tab reads the database agents actually log to

Date: 2026-08-07. MEASURED: creator-harvest ran 6+ ticks post-SPEC-264/265 and wrote 0 rows
(ops-console: 98 runs/24h, last_status 'empty'); the ONE surface that could say WHY — the
/ops/data "Agent runs" tab (meta carries {queried,found,inserted,skips,dbg}) — reads
agent_runs on the GROWTH project, a table no worker writes: logAgentRun() inserts into
agent_runs on PRODUCT (the SPEC-132 cutover deliberately kept agent_runs/qa_findings there).
The tab has shown "AGENT RUNS 0" since the cutover — a permanent confident zero (#249 class).
Second latent defect found while fixing: the runs audience ordered by created_at, a column
agent_runs does not have (backbone schema: started_at) — 42703 on every rows load, invisible
only because the empty growth copy never got that far.

## Change (ONE micro-feature, leads-dashboard only)
- `const db = audience === 'runs' ? createClient(url, svc) : gdbAll` — ONLY the runs
  audience reads product; leads stay on growth (SPEC-203 stands: that cutover is why the
  founder can sign in during a crawl; gate #203's forbidden literal stays absent).
- tsCol for runs = 'started_at' (crawls keeps created_at; leads keep fetched_at).

## Why now
Unblocks the SPEC-264/265 zero-insert diagnosis with a founder-visible surface instead of a
one-off probe: the next "0 new creators" question is answered by opening the tab.

## Gate #267 (mutation-tested): pins the runs→product branch, the started_at tsCol, and that
gate #203's growth rule still holds for lead audiences.
