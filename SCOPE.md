# SCOPE

- `supabase/migrations/*growth_schema_reference*.sql`
- `scripts/growth-dedupe-queue.mjs`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
- `.github/growth-audit-fire/`
- `SCOPE.md`
- `agent-runs/`
- `src/lib/api.js`
- `qa-id-baseline.json`
- `scripts/_growth-env.mjs`
- `scripts/_growth-scope.mjs`
- `scripts/growth-audit-export.mjs`
- `scripts/seed-growth-queue.mjs`
- `scripts/growth-dedupe-queue.mjs`
- `supabase/functions/leads-dashboard/index.ts`
- `src/screens/DataExportScreen.jsx`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — fulfill-crawl: the creator catch block is replaced so it records
the error instead of swallowing it. That is the defect being fixed; no caller behaviour
changes, the write already failed on every call.

SHARED-CHANGE-APPROVED — scripts/qa.mjs #181: the per-source share now divides by the
sources ACTUALLY scheduled (ROTA) rather than the full declared rota. With an allowlist
active, dividing by 8 while running 1 source would hand it an eighth of capacity and idle
the rest. The declaration must still list all 8 — that assertion is unchanged and still
fails when a source is dropped.
- `growth-controls.json`
- `scripts/growth-controls.mjs`
- `.github/workflows/growth-setup.yml`

SHARED-CHANGE-APPROVED — src/lib/api.js: leadsDashboard gains two optional filter
arguments (status, contactableOnly) and forwards them in the request body. Additive; every
existing caller keeps its behaviour because both default to null/false.
- `agents/fleet.json`
- `specs/`
- `scripts/agent-report.mjs`
- `scripts/morning-report.mjs`
- `.github/workflows/night-fleet.yml`
- `reports/`
- `MORNING-REPORT.md`
- `scripts/agent-work.mjs`
- `scripts/agent-pr.mjs`
- `scripts/tdz-guard.mjs`
- `tdz-baseline.json`
- `.github/workflows/ci.yml`
- `scripts/auto-build.mjs`
- `scripts/auto-fix.mjs`
- `scripts/expand-coverage.mjs`
- `supabase/functions/support-triage/index.ts`

SHARED-CHANGE-APPROVED — scripts/qa.mjs: the support-triage assertion demanded the model
name 'claude-opus-4-8', which does not exist. The gate was ENFORCING the defect. Changed
to 'claude-opus-5'.
- `src/screens/AgentFleetScreen.jsx`
- `supabase/functions/ci-subagents/index.ts`
- `scripts/agent-publish.mjs`
- `supabase/migrations/20260802050000_ci_subagent_runs.sql`
- `src/App.jsx`
