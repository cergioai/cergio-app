# SCOPE

Scoreboard fix: my 2026-08-03 fleet split used startswith('FW-1') which also matched
FW-10..FW-15, leaving stale duplicate defect copies in booking-loop while inbox/ig-verify
hold the annotated ones — the founder's green board undercounted (3 instead of 6).
Dedupe only; no behaviour change.

- `agents/fleet.json`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
