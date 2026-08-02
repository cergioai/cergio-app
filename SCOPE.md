# SCOPE — what this change is allowed to touch

The blast-radius guard (`scripts/scope-guard.mjs`, required in CI) refuses any diff that
reaches outside this list. Update it as part of the change, not afterwards.

**Why this exists:** on 2026-08-01 a FREE-link change blanked the homepage, a spend-gate
change killed all crawling, and a YellowPages fix silently reverted craigslist. Every one
was a change to X that broke Y. This makes that mechanically impossible rather than
discouraged.

## Files this change may touch

- `.github/workflows/ci.yml`
- `scripts/scope-guard.mjs`
- `scripts/deno-guard.mjs`
- `scripts/qa.mjs`
- `deno-baseline.json`
- `SCOPE.md`
- `agent-runs/`

## Shared files

Imported by many features, so one change alters behaviour for every caller at once. They
may only GROW — new exports, or new optional parameters with defaults that preserve
current behaviour. To modify or delete an existing line, add `SHARED-CHANGE-APPROVED`
below with the reason.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — this change adds gate #195 to qa.mjs, which is append-only in
practice but the guard counts any diff line, so the marker is required.
