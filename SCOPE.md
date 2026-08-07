# SCOPE

PR 6 (redesign handoff STYLE_MIGRATION.md, groups 4-6 — the LAST design module):
booking/request, profile-adjacent, and the 13 ServiceList* screens are locked as
kit-migrated. Real conversions: hand-built pink-gradient avatars → kit Avatar;
avatar/mutual-circle/map-tile hexes → tokens. Markup-only, IA untouched.
Gate #277.

- `src/screens/RequestFromConnectorScreen.jsx`
- `src/screens/RequestDetailScreen.jsx`
- `src/screens/ActivityScreen.jsx`
- `src/components/ui/ProviderCard.jsx`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

qa.mjs change is purely additive (gate #277 appended before main()).
