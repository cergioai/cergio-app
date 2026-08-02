# SCOPE — what this change is allowed to touch

- `supabase/functions/fulfill-crawl/index.ts`
- `.github/workflows/growth-setup.yml`
- `.github/workflows/growth-audit.yml`
- `.github/growth-audit-fire/`
- `scripts/growth-audit-export.mjs`
- `scripts/qa.mjs`
- `SCOPE.md`
- `agent-runs/`

## Shared files
May only GROW. To modify an existing line, add `SHARED-CHANGE-APPROVED` with the reason.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — fulfill-crawl gains a suspension guard at the top of the handler
(pure addition, no existing line altered); qa.mjs gains gate #197.
