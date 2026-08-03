# SCOPE

SPEC-251 — founder, 2026-08-03, verbatim: "all crawls are off this project.. also all old
COO forensick etc have been disabled.. so keep suspended .. other project will execute
and feed... just focus on bugs and features."

One commit: crawl-sources / creators / spend-guard marked SUSPENDED in fleet.json (briefs
+ standing orders like the yelp pause stay on record for the growth project), matrix
12 → 9 app-only agents, morning report + runners skip suspended agents, gate #214
extended so a suspended agent's absence from the matrix is REQUIRED, not an alarm.

- `agents/fleet.json`
- `.github/workflows/night-fleet.yml`
- `scripts/morning-report.mjs`
- `scripts/agent-report.mjs`
- `scripts/agent-work.mjs`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — qa.mjs gate #214: the single every-agent-in-matrix assert is
wrapped so SUSPENDED agents (with founder words on record) must be ABSENT from the
matrix while every active agent must still be present. Executes the founder's verbatim
2026-08-03 stop order; SPEC-241 flip procedure, old rule preserved in the gate text.
