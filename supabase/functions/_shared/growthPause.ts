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
export const PAUSED_GROWTH_AGENTS: ReadonlySet<string> = new Set([
  'supply-engine',
  'fulfill-crawl',
  'crawl-seed-osm',
  'creator-harvest',
  'creator-enrich',
]);

export const isGrowthPaused = (agent: string): boolean =>
  PAUSED_GROWTH_AGENTS.has(agent);
