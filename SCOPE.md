# SCOPE

FW-17 (founder live repro 2026-08-06): /services/:id is the provider EDIT surface but
rendered ANY service uuid — signed in as t@cergio it showed another account's service
in full edit chrome (RLS no-ops the writes). ServiceDetailProviderScreen now resolves
the live session and replace-redirects non-owners/signed-out viewers to the public
/service/:id view whenever the row records an owner_id. New qa gate #265 guards it.

- `src/screens/ServiceDetailProviderScreen.jsx`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

qa.mjs change is purely additive (one new gate appended after the FW-16 gate).
