# SCOPE

FW-16 v3 (founder live repro 2026-08-05, drift-proof reship): the fan-out notified the
driver but the inbox hid the request — inbox match now uses the same bridge UNION as
the fan-out. New qa gate guards it.

- `src/lib/api.js`
- `scripts/qa.mjs`
- `agents/fleet.json`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — src/lib/api.js: the listInboundRequests OR-filter block IS the
FW-16 defect; replaced with the union-set filter. qa.mjs change is purely additive.
