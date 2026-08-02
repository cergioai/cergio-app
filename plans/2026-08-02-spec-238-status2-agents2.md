# SPEC-238 — dedicated founder URLs /status2 and /agents2

Founder, 2026-08-02: "want to create another dedicated url for the dashboard.. call it
/status2 and /agents2..."

Aliases of OpsStatusScreen and AgentFleetScreen — same components, never copies (a
duplicate screen is a second source of truth). Admin gating lives inside the screens,
so the aliases inherit it. /agents2 added to HIDE_NAV_PATHS_EXTRA to match /ops/agents.
Gate #238, mutation-tested. Live proof after deploy: HTTP 200 + screen renders on both.
