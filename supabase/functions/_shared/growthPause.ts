// SPEC-119 — the self-heal backbone must NEVER re-invoke a PAUSED growth agent.
//
// Root cause (forensic run 118, 2026-07-30): SPEC-118 (#121) paused background
// growth by UNSCHEDULING the growth crons, after DB saturation took the product
// down (/rest/v1/services returned 503 while /auth/v1/user stayed 200). But
// unscheduling a cron does NOT stop the still-running self-heal paths from
// re-firing those same agents:
//
//   • cergio-orchestrator (30-min heartbeat, deliberately left running) re-runs
//     any can_rerun + enabled agent whose health is 'stall' via cergio_call_edge.
//     A PAUSED agent becomes 'stall' precisely BECAUSE it was paused — so the
//     orchestrator would re-invoke fulfill-crawl and supply-engine within ~30 min
//     and re-saturate the connection pool, taking the product down again.
//   • crawl-health-check (2-h, left running) re-kicks crawl-seed-osm to refill
//     the crawl queue whenever it runs dry.
//
// Either path silently UNDOES the emergency pause. The product outranks growth
// unconditionally (SPEC-118), so the pause must be honoured by EVERY self-heal
// path, not only by the (removed) cron schedule.
//
// RESUMING growth — one source at a time, only after live evidence that REST
// stays 2xx (SPEC-118) — means removing that agent from this set in the SAME
// commit that reschedules its cron. The cron and this guard gate one decision.
//
// SPEC-241 (2026-08-02): THE SET IS NOW EMPTY, because the crons ARE the record.
// 20260731020000_resume_growth_on_growth_db.sql rescheduled ALL FIVE growth crons
// (fulfill-crawl, supply-engine, crawl-seed-osm, creator-harvest, creator-enrich)
// and 20260802170000 restored creator-harvest again — but nobody removed them
// here, violating this file's own same-commit rule. The result was two sources
// of truth: the cron said RUNNING while this set said PAUSED, so the
// orchestrator's self-heal refused to revive exactly the agents that were
// supposed to be running, and a stalled scheduled agent read as "paused on
// purpose". The membership is corrected to match the cron record; "are we
// crawling?" is answered by growth-controls.json (SPEC-207/237/239), which
// fulfill-crawl and creator-harvest honour INSIDE the function — a kill that
// works even when a self-heal path re-invokes them.
//
// THE MECHANISM STAYS. The next DB-saturation emergency pauses growth by adding
// the agent names back here IN THE SAME COMMIT that unschedules their crons
// (and gate #119 must be updated with that emergency's record in the same PR —
// it currently asserts these five are NOT listed while their crons stand).
export const PAUSED_GROWTH_AGENTS: ReadonlySet<string> = new Set([]);

export const isGrowthPaused = (agent: string): boolean =>
  PAUSED_GROWTH_AGENTS.has(agent);
