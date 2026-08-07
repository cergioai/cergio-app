# SCOPE

FW-22 + FW-23 (founder 2026-08-07): Edit Offerings now shows the real rows and
edits/adds/removes them in place (the api selected a `price` column that never
existed — price_cents — so every list read empty); Airbnb-style services.headline
leads cards + PDP, the auto service-in-location title becomes a badge, and
"by {provider name}" credits the human. Gates #275–#276.

- `src/lib/api.js`
- `src/components/ui/ProviderCard.jsx`
- `src/screens/ServiceDetailScreen.jsx`
- `src/screens/ServiceDetailProviderScreen.jsx`
- `src/screens/ResultsScreen.jsx`
- `src/screens/ServiceListMoreOfferingsScreen.jsx`
- `supabase/migrations/20260807130000_service_headline.sql`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — src/lib/api.js: getServiceOfferings' select literal is
CORRECTED in place (`price` → `price_cents` — the old line 42703'd on every
call, which IS the FW-22 defect); the two listServices select literals grow
`headline`. Everything else is additive (updateOffering, addOffering,
deleteOffering, fetchOwnerDisplayNames).

SHARED-CHANGE-APPROVED — scripts/qa.mjs: additive only (gates #275–#276
appended before main()).
