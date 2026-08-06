# SCOPE

Redesign handoff PR 4 — the Service PDP (founder 2026-08-05, brief:
`design_handoff_profile_booking/KICKOFF.md` "PR 4", visual spec
`Service PDP.dc.html`, code side PATCHES.md §3/§4). ServiceDetailScreen
rebuilt to the design's three price states, all resolved in the new
`src/lib/servicePricing.js` (viewer-gated free · service-wide discount ·
plain). "Leave a go-to review" removed (reviews are post-booking only).
Recommenders select grows `avatar_url` (the PR-1 deferral; gate #159 amended
in place). Token `paper` added. Spec: FROZEN_SPEC SPEC-49i + S-263 row; new
gate #263; every pinned behavior (#38/#53/#134/#136/#49g/#61) kept.

- `src/screens/ServiceDetailScreen.jsx`
- `src/lib/servicePricing.js`
- `tailwind.config.js`
- `plans/2026-08-06-redesign-pr4-pdp.md`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED: `scripts/qa.mjs` — ONE amendment: gate #159's pinned
recommender-profiles select literal grows `avatar_url`
(`'id, display_name, cc_verified_at, instagram_handle, avatar_url'`). This is
the deferral PR 1 recorded ("its avatar_url lands with the PR 4 PDP rebuild,
which revisits that gate anyway"). The SPEC-154 core the gate exists for —
instagram_handle fetched, carried onto the row, linked out — is untouched and
still asserted. Gate #263 adds the PDP-v2 pins; mutation-tested per CLAUDE.md.
