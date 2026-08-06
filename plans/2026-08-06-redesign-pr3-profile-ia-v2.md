# Redesign handoff PR 3 — Profile IA v2

Brief: `design_handoff_profile_booking/KICKOFF.md` "PR 3" + `Profile IA v2.dc.html`
(three shapes = ONE component, empty sections omitted) + README.md "Profile element
order (v2)" + field-mapping tables. This is the ONE screen where the IA changes
(founder-signed, STYLE_MIGRATION "the one exception already agreed").

## Element order (v2, founder's IA doc)

1. Name · 2. Local Creator badge (+ one FacetBadge per service facet) ·
3. Followers on Cergio (named mutuals) · recos made · 4. IG handle · follower count ·
5. Creator line (creators only) · 6. Per-service facet: title + "recos received incl …"
(named) + blurb · 7. IG Spotlights (received / made) · 8. {First}'s Services cards
(facet + reco count, cover, offering title + price, lead reco quote + DATE) ·
9. **Services Recommended by {First}** (renamed from Go-Tos). Empty sections don't render.

## What changes / what stands

- RENDER ONLY rebuilt with kit primitives (Avatar, FacetBadge, QuoteBubble, Card,
  SectionTitle, SeeAllLink). DATA LAYER UNCHANGED: same selects, same summaries
  (svcRecoSummary, recosByService, goToSummary, goToOwnerCounts, netSet mutuals).
  Additive only: recommender/owner `avatar_url` into the shaped rows (it's already
  in the selects since PR 1), + two honest count queries for the Spotlights heading
  (made = their posted free-barter bookings; received = posted free-barter bookings
  on their services).
- Removed per v2: ProfileSignalBlock mount (stays for /inbound), standalone
  "Recommendations received" section + RecoRow (lead quote now sits ON the service
  card, dated), dead `reviews` fetch, `recommenderCounts` fetch (its rows are gone).
  ServiceTile + PHOTO_GRADIENTS move VERBATIM to their only consumer
  (PublicProfileServicesScreen) so the migrated profile file has zero raw hex.
- Kept: Follow (behavior, not listed in the design's removals — sits next to the new
  Share copy-link pill), spotlight tiles (IgPostTile, real posts — SPEC-49e),
  "View all services" → /u/:id/services after 3, recos-made > displayed rule
  (SPEC-49d), no services-consumed section, empty/loading/notFound states, the
  quarantined ?reqId bar, useDocumentMeta.
- Trust stays trust-first: per-service line NAMES viewer mutuals
  ("17 recos received incl Jane, Sam + 3 friends (and 2 Local Creators)");
  recommended rows keep recoByline(goToSummary) + SocialReachLine + named date.

## Gates (scripts/qa.mjs — SHARED-CHANGE-APPROVED)

- AMEND `spec-49-unified-profile` + `spec-49g-reputational-streams`: layout pins that
  the founder's 2026-08-05 handoff supersedes (block mount, serviceMode-on-profile,
  "Recommendations received" section, RecoRow===1, recommenderCounts) re-pinned to
  the v2 equivalents. Everything else stands (block internals for /inbound, PDP
  asserts, netSet mutual regex, reputation primitives, useDocumentMeta).
- NEW gate `#262 profile-ia-v2`: element ORDER by source position, kit primitives
  imported, Share copy-link, dated lead quotes, "Services Recommended by" rename,
  no raw-hex utility classes in the migrated file (the STYLE_MIGRATION done-check).
- FROZEN_SPEC.md gains SPEC-49h recording the supersession; MASTER-SPEC +
  SPEC-REGISTRY gain S-262 (CODED until live proof).
- Mutation-test #262 + each amended assert: break → FAIL → restore.

## Ship

`ship/pr3-profile-ia-v2` → bundle + one-click .command (same as PR 2) → auto-ship.
After merge the profile LOOKS DIFFERENT — this is the first visible redesign PR.
