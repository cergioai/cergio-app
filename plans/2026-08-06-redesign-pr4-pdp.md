# Redesign handoff PR 4 — the Service PDP

Brief: KICKOFF "PR 4" + `Service PDP.dc.html` (3 price states) + PATCHES §3
(servicePricing) + §4 (review entry point moves post-booking). Biggest file in
the repo; markup rebuilt to the design, every pinned behavior kept.

## What lands

1. **`src/lib/servicePricing.js`** (NEW, PATCHES §3 near-verbatim):
   `priceForViewer(service, offering, viewerIsConnector)` → the three states:
   viewer-gated FREE (`service.free_for_connectors` + viewer `cc_verified_at`),
   service-wide discount (`service.discount_pct` — one rate, every offering,
   NEVER per-offering), plain price. Plus `money(cents)`.
2. **ServiceDetailScreen rebuilt to the design**: hero (white control circles:
   back/heart/pin/share, mute, ruler only when >1 real image), name 26 +
   full facet list (FacetBadge/creator chip), perk headline
   "Free for Local Creators" + viewer-aware gate copy when the service flags
   it, green go-to line + 46px lead Avatar, "Book {First}" (SectionTitle pdp)
   + state-aware info sub, 260px offering cards (price/was/pill from
   priceForViewer; legacy $0 offerings still read free w/ struck comparable —
   the 2026-05-30 founder rule), mint custom-quote panel (unchanged wiring —
   gate #136), About the provider section, go-to review cards (Card r=12,
   horizontal, real reviewer avatars), "What people say" reco rows KEPT
   (SPEC-154 IG links + 49g badges), sticky bar: selected offering title +
   price + "Request {First}" (replyOffer/liveOffer labels unchanged — #134).
   **"Leave a go-to review" button REMOVED** (KICKOFF §4 — it was only a nav
   shortcut to /inbox; the actual composer stays in the rate+post flow, so
   nothing becomes unreachable).
3. **PR 1 deferral lands**: recommenders select gains `avatar_url`
   (+ real avatars on rows) — gate #159's pinned literal AMENDED to the new
   one. Services select gains `free_for_connectors, discount_pct`.
   Viewer flag via own-profile `cc_verified_at` (ResultsScreen pattern).
4. **Tokens**: `paper #FFFBF3` (the PDP page bg from the handoff README) added
   to tailwind.config.js. Zero raw hex left in the file (AV_GRADS dies;
   avatars via the Avatar primitive).

## What is NOT touched

Data flows + pinned behaviors: recommendersRaw fast path + cold fallback
(#38), liveOffer CTA strings (#134), targeted custom quote (#136), no
standalone recommend modal (#53), TrustStream/SocialReachLine/MutualBadge/
mutualNamesText/displayType/heroImages pins (#49g), useDocumentMeta (#61),
cover_url render pin, bookings→reviews join, chat-parse (PR 5), booking flow.

## Gates

- NEW #263 `pdp-v2`: servicePricing exists + viewer-gated + service-wide
  discount pins, PDP imports priceForViewer, flags in the services select,
  'Leave a go-to review' ABSENT, no per-offering discount reads, no raw-hex
  utility classes. Mutation-tested.
- AMENDED in place (SHARED-CHANGE-APPROVED): #159 select literal grows
  avatar_url (the PR-1 deferral this PR was always meant to close).
- FROZEN_SPEC SPEC-49i + S-263 registry rows (CODED until live proof).

## Ship

`ship/pr4-pdp` → bundle + one-click .command → auto-ship → PR merges on green.
