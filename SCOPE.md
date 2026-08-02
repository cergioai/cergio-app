# SCOPE

- `supabase/migrations/*growth_schema_reference*.sql`
- `scripts/growth-dedupe-queue.mjs`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
- `.github/growth-audit-fire/`
- `SCOPE.md`
- `agent-runs/`
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
