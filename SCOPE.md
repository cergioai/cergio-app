# SCOPE

Pics fixes + remaining design modules (founder 2026-08-06/07, "back to back ships"):
FW-19 avatar upload UI · FW-18 service photos+videos gallery · FW-20 fake-person
placeholder purge · FW-21 real IG post images (token-gated official oEmbed) ·
PR 5 booking free-form box → chat-parse + request attachments. Gates #270–#274.

- `src/lib/storage.js`
- `src/lib/api.js`
- `src/components/ui/EditProfileModal.jsx`
- `src/components/ui/ProviderCard.jsx`
- `src/components/ui/IgPostTile.jsx`
- `src/components/ui/RequestQuoteSheet.jsx`
- `src/screens/ProfileScreen.jsx`
- `src/screens/ServiceDetailProviderScreen.jsx`
- `src/screens/ServiceDetailScreen.jsx`
- `src/screens/ManageServicesScreen.jsx`
- `src/screens/ResultsScreen.jsx`
- `src/screens/ActivityScreen.jsx`
- `src/screens/PublicProfileServicesScreen.jsx`
- `src/screens/ProfileSharedScreen.jsx`
- `src/screens/SocialPostsScreen.jsx`
- `src/screens/RequestFromConnectorScreen.jsx`
- `src/App.jsx`
- `supabase/migrations/20260807040000_service_media.sql`
- `supabase/functions/ig-oembed/index.ts`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — src/lib/api.js: ONE existing line changed (FW-20:
`photo_class: draft.photoClass || 'fv-jamie'` → `|| null` — new listings must
not record a fake-person placeholder class); everything else is additive
(listServiceMedia, listRequestAttachments).

SHARED-CHANGE-APPROVED — scripts/qa.mjs: gate #133's detail-screen assert
amended in place because the PDP hero became the FW-18 story pager — the
invariant (cover_url renders when present) is unchanged, cover_url is
heroImages[0]; the assert now follows that derivation. All other qa.mjs
changes are additive (gates #270–#274 appended).
