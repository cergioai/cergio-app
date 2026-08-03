# SCOPE

SPEC-252 — founder, 2026-08-03, verbatim: "close and verify back to back no hourly wait.."

The fleet relaunches itself the moment a run finishes while FW work remains
(workflow_dispatch self-chain — GitHub's sanctioned cascade path). Stops itself on
ALL GREEN or when every agent CANNOT RUN (dead key). Concurrency group bounds it to
one running + one queued.

- `scripts/fleet-relaunch.mjs`
- `.github/workflows/night-fleet.yml`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
