# SCOPE

Redesign handoff PR 1 — schema + avatars (founder 2026-08-05, brief:
`design_handoff_profile_booking/KICKOFF.md`). Three idempotent migrations copied
verbatim from the handoff bundle, `avatar_url` added to the person-rendering
selects per the bundle's PATCHES.md §1, one shared `Avatar` primitive.
**No screen layout changes in this PR.** One deliberate deferral: the
ServiceDetailScreen recommenders select (the "What people say" rows) keeps its
exact literal because qa gate #159 pins it; its `avatar_url` lands with the
PR 4 PDP rebuild, which revisits that gate anyway.

- `supabase/migrations/20260805120000_profile_avatars.sql`
- `supabase/migrations/20260805121000_request_attachments.sql`
- `supabase/migrations/20260805122000_service_pricing_flags.sql`
- `src/components/ui/Avatar.jsx`
- `src/screens/PublicProfileScreen.jsx`
- `src/screens/ServiceDetailScreen.jsx`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
