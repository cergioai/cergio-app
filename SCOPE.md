# SCOPE

Redesign handoff PR 3 — Profile IA v2 (founder 2026-08-05, brief:
`design_handoff_profile_booking/KICKOFF.md` "PR 3", visual spec
`Profile IA v2.dc.html`, element order + field maps in the bundle README).
`PublicProfileScreen` rebuilt to the founder's v2 element order with the PR-2
kit primitives — the ONE screen where the IA changes. Data layer unchanged
(same selects + trust math); additive only: shaped-row `avatar_url`, honest
IG-Spotlight counts. `ServiceTile` moves VERBATIM to its only consumer
(`PublicProfileServicesScreen`) so the migrated file has zero raw hex.
Spec: FROZEN_SPEC SPEC-49h + S-262 row (S-261 was taken by the trust weld while this PR was in flight); new gate #262; the #49 gates amended
in place (see below).

- `src/screens/PublicProfileScreen.jsx`
- `src/screens/PublicProfileServicesScreen.jsx`
- `plans/2026-08-06-redesign-pr3-profile-ia-v2.md`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED: `scripts/qa.mjs` — the founder-signed Profile IA v2
(2026-08-05 handoff) supersedes the LAYOUT pins inside gates
`spec-49-unified-profile` and `spec-49g-reputational-streams`
(ProfileSignalBlock mount on the profile, serviceMode-on-profile, the
standalone "Recommendations received" section, RecoRow===1,
recommenderCounts). Those asserts are AMENDED in place — each amendment is
dated, cites SPEC-49h, and re-pins the v2 equivalent; every non-layout pin
(block internals for /inbound, PDP asserts, netSet mutual regex, reputation
primitives, useDocumentMeta) stands untouched. Gate #262 adds the v2 pins.
No gate is deleted or left weaker: mutation-tested per CLAUDE.md.
