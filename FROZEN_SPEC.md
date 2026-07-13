# CERGIO FROZEN SPEC

**This file is law. Every item here is a confirmed, frozen behavior.**
Every Claude session must read this file before touching any code.
Items are only changed when Tarik explicitly says so in chat.
Every item has a matching qa.mjs test ID that blocks pushes.

If you are about to write code that conflicts with any item below,
STOP. Surface the conflict to Tarik before proceeding.

---

## HOW THIS WORKS

- **FROZEN** = confirmed behavior. Never regress. Never "improve" without explicit approval.
- **SPEC-ID** = the number used in qa.mjs (`#NN`) and in CERGIO-GUARD comments.
- **Changed** = date the item was last explicitly updated by Tarik.

---

## UI / COPY — RESULTS SCREEN

### SPEC-42 · Results waiting state copy
**Status:** FROZEN — 2026-06-11  
**Rule:** When no providers are found (loading OR zero results), the canonical waiting state is:
- Leaf icon (LeafLogo component)
- Text: `"We'll let you know when offers land."`

**Banned copy (must never appear):**
- "Sent to Connectors near you · they barter for $250 in free spotlights"
- "Connectors are locals who get free services in exchange for spotlighting them on IG/TikTok. The first one to claim wins the barter."

These phrases regressed once (2026-06-11). The barter pill block in ResultsScreen has been permanently removed. qa.mjs #42 enforces this.

---

## UI / BEHAVIOR — INVITE FRIENDS SCREEN

### SPEC-43 · Invite contacts scoped to real network only
**Status:** FROZEN — 2026-06-11  
**Rule:** `listInvitableProfiles()` must ONLY return profiles the signed-in user follows (via the `network` table, `follower_id = meId`). It must never dump the full `profiles` table.

**Banned behaviors:**
- Showing seed profiles (Alex Tester, Connie Connect, Jackie Sitter Connector, etc.) to any user
- Pre-selecting any contacts on load (the `setSelected(new Set(data.slice(0,2)...))` pattern is permanently banned)
- Synthesizing phone/email fields that weren't in the DB

qa.mjs #43 enforces this.

---

## UI / BEHAVIOR — GEOCODER / SETUP BANNER

### SPEC-44 · Geocoder error suppressed when Nominatim succeeds
**Status:** FROZEN — 2026-06-11  
**Rule:** When Google geocoder returns REQUEST_DENIED (or any non-OK status that sets `status.lastError.kind === 'geocode'`), AND the Nominatim fallback successfully resolves the address, `status.lastError` must be cleared to `null` before returning. SetupCheckBanner must not show a geocoder error to the user when their address resolved successfully.

**Auth errors (`kind === 'auth'`) are NOT cleared — those affect more than geocoding.**

qa.mjs #44 enforces this.

---

## UI / DATA — NO FAKE DATA ON REAL SCREENS

### SPEC-12 · No mock data on signed-in paths (pre-existing, qa.mjs #12)
**Status:** FROZEN — 2026-05-XX (pre-existing guard)  
**Rule:** Mock data imports (`MOCK_FEED`, `NETWORK_EARNINGS`, `TRANSACTIONS`, `MOCK_ACTIVITY`, etc.) must never render to signed-in users on live screens. This includes Feed, Activity, Earnings, Transactions, and any network-data screen.

This regressed once (caught by audit). qa.mjs #12 enforces this.

---

## BUSINESS LOGIC — SPOTLIGHT / FREE SWAP

### SPEC-45 · Free ($0) spotlight swap invariants
**Status:** FROZEN — 2026-05-31 (from project memory)  
**Rule:** A spotlight marked as free ($0) must:
1. Skip the Pay step entirely — no payment UI shown
2. Not be gated by `paid_at` — free swaps are considered paid immediately
3. Be exempt from the 24-hour expiry rule that applies to unpaid spotlights
4. Filter the roster on `handle` (IG handle), NOT on rate card amount

qa.mjs #45 enforces this.

---

## UI / BEHAVIOR — RECO FORM CONTACT PICKER

### SPEC-46 · Reco form contacts: device-only, single-select, auto-populate
**Status:** FROZEN — 2026-06-11  
**Rule:** In `RecommendServiceFormScreen`, the "Pick from your contacts" button must:
1. Use ONLY the native Contact Picker API (`navigator.contacts.select`) — never fall back to `seededPool` / Cergio network profiles (those have no phone/email)
2. Use `multiple: false` (single select) so the chosen contact's name + phone + email populate all three fields immediately
3. On unsupported browsers (desktop): show a toast directing the user to enter details manually — no fake contacts

**Banned behaviors:**
- Using `listInvitableProfiles()` or any Cergio network data as a contact source in this form
- Loading a "pool" of contacts that require a secondary search step to pick from
- Showing a toast that says "N sample contacts loaded" when no real device contacts were imported

qa.mjs #46 enforces this.

---

## DATA QUALITY — INFLUENCER CRAWLER

### SPEC-CQ1 · Influencer follower band
**Status:** FROZEN — 2026-06-11 (updated 2026-06-11)  
**Rule:** Only profiles with **5,000–150,000 followers** are inserted into `influencers.db` and counted toward the city target. Accounts outside this band are silently skipped (`quality-skip` log line), never inserted, never counted.

Phone/email contact is stored when found but is **NOT** required for counting — the IG handle is the contact method for outreach (DM).

Enforced in `influencer_crawler.py` via `MIN_FOLLOWERS` / `MAX_FOLLOWERS` constants, overrideable via `APIFY_TUNING.json`. Changing the band requires explicit approval from Tarik.

---

## DATA QUALITY — REPORTED COUNTS

### SPEC-CQ2 · Reported influencer counts use quality-gated query
**Status:** FROZEN — 2026-06-11  
**Rule:** `city_count()` in `influencer_crawler.py` must apply the same `followers >= MIN_FOLLOWERS AND followers <= MAX_FOLLOWERS` filter as the insert gate. The number shown in logs, STATUS.md, and reports must equal the number of profiles that actually meet the quality bar — never the raw `handle_verified=1` count.

---

## BUSINESS LOGIC — FREE-SERVICE BARTER LOOP

### SPEC-47 · Free-service barter completion loop + gate
**Status:** FROZEN — 2026-06-12 (Tarik flow board "User Flow / SVP Flow")  
**Rule:**
1. Every real booking goes through the ScheduleSheet (calendar + time + Done) — the user confirms day/time; `schedule_confirmed_at` is stamped. No more silent "+24h placeholder" confirmations.
2. Bookings (free AND demo-mode paid) stay **pending** until the provider accepts — never auto-confirm on submission. **EXCEPTION (SPEC-47b, Tarik 2026-06-15):** a booking made off a provider's EXISTING offer (the "Book a time" action on a "Responses to your requests" card → `handleBook({preConfirmed:true})` → `createBooking({confirmed:true})`) is created **confirmed**, because the provider already said yes by offering. It lands in both parties' Upcoming immediately — no redundant re-accept. A cold consumer-initiated booking still stays pending.
3. After a FREE job, the Connector posts an IG spotlight (`markBookingPosted` → post_url + posted_at), it surfaces on the activity feed (kind `barter`), and the provider must **accept** (`confirmBookingPost` → post_confirmed_at + status completed) or **flag** (`flagBookingPost`).
4. **THE GATE:** a Connector with an accepted free booking whose post is not yet confirmed cannot order another free service (`getOutstandingFreeBarter` checked in `handleBook` before any free booking).

**SPEC-47c · Mark-complete + rate-with-post (FROZEN 2026-06-15, Tarik):**
- The PROVIDER can **Mark job complete** anytime (even before start) on a Jobs → Upcoming
  "Jobs for you" card → `markBookingComplete` stamps `bookings.completed_at` and fires
  notify-request (`job_complete`) so the Connector is nudged to post (email + in-app; SMS once
  Twilio is wired). This is distinct from `post_confirmed_at` (the barter still closes only on
  provider confirm). For PAID jobs, `completed_at` starts the auto-release window (paid module).
- The Connector **rates + posts in ONE step** (`MarkBookingPostedModal`): a star rating is
  required. **4★+** → `createReview` + `markBookingPosted` publishes the spotlight. **Below 4★**
  → the post is **HELD**: the Connector must explain; the review is saved (`createReview` with
  comment), shown as PRIVATE ("truthful reviews from trusted friends, not gamed reviews from
  strangers"), shared with the provider; the spotlight does NOT go live until resolved. Provider
  reply / escalate / admin dispute = the next module.
- **The written-review textarea appears once the user picks a rating, and is MANDATORY**
  (Tarik 2026-06-27: "keep hidden until the user picks a star, then expose" + "review is
  mandatory regardless of stars"). At **0★** (not yet rated) no box; at **1–3★** the held path
  shows its required "what went wrong" textarea; at **4★+** the required "Write a review"
  textarea shows. Submit is blocked with an error until `comment.trim()` is non-empty for ANY
  star count. All saved via `createReview`. (NB: don't remove the box or make it optional —
  both are regressions Tarik flagged.)
- **Only 4★+ becomes a public recommendation** (Tarik 2026-06-27). 4★+ → `recommendService`
  writes a service-linked recommendation that surfaces on profiles (provider's "Recommendations
  received" + recommender's Go-Tos), and the IG spotlight may publish. **1–3★ is a PRIVATE
  review** — saved to `reviews` only, shared with the provider + Cergio admin to help them
  improve, never public and never a recommendation; no `recommendService`, no `markBookingPosted`.
- Easy surfacing: the Jobs **Overview** shows action rows — "Post your IG spotlight · N" (you're
  the Connector, provider marked complete) and "Spotlights to review · N" (you're the provider,
  Connector posted).

**SPEC-47d · Spotlight = the Connector's UNIQUE referral link, Story-first (FROZEN 2026-06-15, Tarik).** The post step (`MarkBookingPostedModal`, 4★+ path) is built around conversions:
- The Connector's UNIQUE link `buildInviteUrl(connectorId)` (`/i/{code}`) + `?s={bookingId}`. Signups through it credit them (7% up to $250, first-touch via the existing referral system); `?s=` ties a click to THIS spotlight for the auto-audit.
- Story-first guided flow (the only clickable, trackable IG surface): copy link → add to Story with the **Link sticker** → save to a **"Spotlights" Highlight** (permanence past 24h). "Open Instagram" helper. Bio-link upsell ("earns on every post"; feed posts tag @cergio + #cergiofeed). Earnings shown inline to motivate.
- Qualify/audit: clickthrough on the unique link is the live-proof now; automatic **oEmbed caption check** (@cergio + link + #cergiofeed) activates once Meta Graph access is approved (scheduled).

**SPEC-47h · Provider accept-with-time → confirmed booking + reschedule (FROZEN 2026-06-16, Tarik).** On the connector-request screen, the provider's accept can set the TIME: "Pick a time & accept" (flexible request) and "Accept & confirm" (specific time) now create a **CONFIRMED booking** at the chosen time via the `accept_request_with_time` SECURITY DEFINER RPC (provider creates the booking for the Connector; verifies caller owns the service) — NOT just an offer. It lands in both parties' Upcoming immediately. EITHER party can then **Reschedule** (inline datetime control on the Upcoming cards → `rescheduleBooking`) — "change the time together." (The plain inline-inbox "Accept" still sends a quick offer; the time-pick lives on the detail screen.)

**SPEC-47i · Forced barter post-gate on the Connector (FROZEN 2026-06-16; rev 2026-06-18, Tarik — fires EARLIER).** Once the barter SERVICE HAS HAPPENED — the provider **marked the job complete** (`completed_at`) **OR the scheduled time has passed** (`scheduled_at < now`) — and the Connector has **not yet posted** their spotlight, the Connector's WHOLE app is **hard-blocked on login** by a full-screen interstitial (`BarterPostGate`, mounted at App root): headline "{Provider} marked your service complete" (or "Your {service} is done" when only the time has passed) + button **"Rate & post to IG"** (opens `MarkBookingPostedModal`). NOT dismissible — closing the modal returns to the block. The block **releases** the moment the Connector has acted: a 4★+ post (`posted_at`) OR a review of any kind (held <4★ counts — never a permanent lock). `getOutstandingFreeBarter` surfaces a **`serviceHappened`** flag (`completed_at || scheduled_at-passed`) + a `reviewed` flag for this. **Future-dated, not-yet-happened barters do NOT block.** The provider's "Mark job complete" button still drops once the Connector has posted (`canMarkComplete` gates on `!posted_at`). qa.mjs #47i enforces this.

**SPEC-47g · Paid 3-hr auto-release (PLANNED — NOT YET BUILT, Tarik 2026-06-16).** Hold this spec; build after QA + other priorities. When live: paid funds release to the provider automatically **3 hours after the provider marks the job complete** (`completed_at`), unless the payer challenges within the window. **GUARD (Tarik 2026-06-16):** if the provider marks complete **BEFORE the booking's scheduled start time** (`completed_at < scheduled_at`), auto-release is **BLOCKED** — the Connector/consumer must explicitly **CONFIRM the job was done** before funds release. This prevents a premature "mark complete" before the work actually happened. Needs Stripe Connect transfer + a scheduled edge function/cron (Stripe confirmed live). A code TODO marks the spot at `markBookingComplete` in lib/api.js.

**SPEC-47f · IG post tile on feed + Previous spotlights (FROZEN 2026-06-16, Tarik).** The confirmed barter shows its Instagram spotlight as a tappable `IgPostTile` (IG-branded gradient + glyph + "View", links to `post_url`) on the Activity feed and in the frame-3 **"Previous spotlights on Cergio"** track record (`getConnectorSpotlights(connectorId)` — the Connector's prior barter posts). HONEST link tile only — no fabricated photo until Meta media access is approved (SPEC-12); swap the gradient for the real `<img>` then.

**SPEC-47e · Below-4★ private review dispute (FROZEN 2026-06-16, Tarik).** When a Connector rates a barter <4★ the spotlight is held (SPEC-47c) and a private dispute opens (`review_threads` table + `bookings.dispute_escalated_at`; `getMyOpenDisputes` / `listReviewThread` / `addReviewReply`). Both parties see the rating + comment and reply; the PROVIDER (rated low) can also **Escalate** → stamps `dispute_escalated_at` + pings support (admin handles manually now; AI resolution phase 2). Surfaced via the inbox **Overview** "Ratings to resolve · N" + a Requests-tab section. Reviews are **private, not public** ("truthful reviews from trusted friends, not gamed reviews from strangers"). The post goes live only when the rating reaches 4★+.

**Banned behaviors:**
- Auto-confirming a booking at submission time (except SPEC-47b: booking off a provider's existing offer)
- Creating a free booking without consulting `getOutstandingFreeBarter`
- Releasing the gate on `posted_at` alone (provider must CONFIRM)

qa.mjs #47 enforces this.

---

## UI / DATA — PROVIDER REQUEST SCREEN (ACCEPTING A FREE SERVICE)

### SPEC-48 · Inbound connector-request screen required elements
**Status:** FROZEN — 2026-06-13 (Tarik dictated as SPEC; flow board "Accepting Free Service request"). Updated 2026-06-13: the canonical screen is `RequestFromConnectorScreen` at route `/inbound/:reqId`, opened from the Inbox "New requests near you" card. The old bare profile path (`/u/:id?reqId=`) is NO LONGER the response surface — it had only a one-line Accept/Counter/Decline bar. (`RequestDetailScreen` at `/request/:id` remains the DIRECT-booking detail screen and carries the same elements.)
**Rule:** `RequestFromConnectorScreen` (the screen the service provider sees for an inbound request from a Connector) must render, for a free request:
1. **Job details** — service title, free-for-Connectors pill, description, appointment.
2. **Approximate-location card** — copy "Map shows approximate location"; the exact address is shared ONLY after the user confirms the booking. No live map tile and no precise pin until confirmed.
3. **Requester block** — the requester's **Connector status** + strength signals (IG follower count, reco count, listed services) shown ALWAYS so the provider can judge how strong a Connector they are + a working "See Instagram" link. **Connector rule** (`isConnectorProfile`, Tarik 2026-06-13): `cc_verified_at` set OR `instagram_followers ≥ CONNECTOR_MIN_FOLLOWERS` (300 at launch from the user-entered IG count; rises to 3000 post-launch, or manual admin acceptance). A "Connector" badge renders when this is true.

**Free-barter framing is driven by Connector status:** a request FROM a Connector is a FREE service ↔ social-reach exchange (`isFree = isConnectorProfile(requester) || requests.is_free_for_rainmaker`). It must NOT read as "Paid request". (The `requests` table never writes `is_free_for_rainmaker`, so connector status is the operative free signal.)

**Post-launch gate (NOT enforced yet — testing):** submitting a connector request will require a verified CC. Unverified is allowed for now.

**Layout:** `/inbound` is in `HIDE_NAV_PREFIXES` so the global BottomNav never covers the fixed Accept/Counter/Decline bar.
4. **Friends-in-common** — mutual connections with the requester via `getMutualConnections` over the `network` graph (any edge, either direction; buckets friends + Connectors). Hidden when zero.
5. **Actions** — Accept / Counter / Decline via `respondToRequest` ("Accept free request" label for free requests) + the "free marketing / service verification with a 4+ star rating" subcopy. Plus a "See full profile" link to the requester's PublicProfile.

**FROZEN layout — finalized 2026-06-14 (Tarik):**
- Header: back · (no requester name) · **Flag + Share** (Share = Web Share / copy link; Flag reports). No kebab.
- **Top headline:** "Free {service} ⇄ Free spotlight to {N} followers" + a date chip. No separate big service title / no "wants to market" banner.
- **Connector tile — LEAD WITH REACH (Tarik 2026-06-15):** a Connector requesting a FREE service is judged on reach first, in this exact order (matches the profile interim screen): (1) Connector badge, (2) **"{N} IG followers"** as its own prominent line (+ TikTok when present), (3) **"{network} network on Cergio · {reco's} reco's made"**, (4) **See Instagram** link, (5) **bio** (`profiles.bio`/`headline`). THEN below: **Services + reco's RECEIVED** (contrasted vs reco's made up top), then **Mutual friends** (linked to each profile; explicit empty state "You have no mutual friends with {name} yet."), then "See full profile". The shared `formatKeyCounts(…, {recoKind:'made'})` mirrors this reach-led order on the inbox cards + booking detail.
- **Personalized message** composed from the requester's RAW task text (`description`/`query`, not the parsed type), greeting the provider by **first name** ("Hi {First}," when available), no doubled date.
- **Map:** real keyless **OpenStreetMap** embed of the AREA (no precise pin), **tappable → expands** (Airbnb-style). Approximate area (city/state) only; exact street address **blocked until accept + confirm**. Sits BELOW the message, above the Accept button.
- **Pre-booking Q&A:** "Ask a question before you accept" — preset chips + free text via `askRequestQuestion`; thread renders question + reply. (Requester reply surface = follow-up.)
- **Actions:** "Accept free request" / **Counter** ($ + optional note via `respondToRequest(message)`) / Decline.

**Banned behaviors:**
- Faking the IG photo grid. The "+N more" thumbnail strip renders ONLY from real `data.igMedia` (populated once Meta Graph media access is approved). Hardcoded placeholder thumbnails are banned (SPEC-12).
- Synthesizing follower counts, mutual-connection counts, or names not present in the DB.
- Revealing the exact job address before `status` is confirmed.

qa.mjs #48 enforces this.

**SPEC-48b · Booking detail parity + new-card-only inbox.** FROZEN 2026-06-15 (Tarik: "the new cards are the ONLY cards (for bookings and connector free request)… quarantine anything else… it regressed completely, freeze it — free and paid").
- The direct-booking detail `RequestDetailScreen` (`/request/:id`) — used for FREE and PAID bookings — carries the SAME frame-3 elements as `/inbound`: approximate-location card, IG block + "See Instagram", friends-in-common, AND a **Connector badge + key-counts line** (`network · reco's made · IG · TikTok` via `usePartyCounts`/`formatKeyCounts`; mutuals omitted from the line since the dedicated friends-in-common block carries them).
- **No fake data:** the old demo `FALLBACK` (Reyna / Gervon / Housekeeper) is QUARANTINED. A missing/invalid booking renders a clean "This request is no longer available" state — never mock data (SPEC-12).
- **Inbox cards:** every inbound card in the Jobs "Requests" tab — connector free-service requests AND bookings — renders the same key-counts line (`formatKeyCounts`). The old bare booking card (no counts) is replaced; it is the single card design for both request types.
- `usePartyCounts` / `formatKeyCounts` (`src/hooks/usePartyCounts.js`) is the ONE source for inbox/detail key counts on `/inbound`, `/spotlight`, `/request/:id`, JobsInbox, and ConnectorRequests — no parallel count-formatting variations.

**SPEC-48c · Party-signal ordering RULE (FROZEN 2026-06-15, Tarik: "make it a rule… lead with the same info next to each user type everywhere, but show respective priority").** Every card/detail that renders another user leads with the same signal block, ordered by who is looking:
- **A service/provider viewing a CONNECTOR** (free-service request inbox cards, `/inbound`, `/request/:id` free): LEAD with the **Connector badge**, then **IG followers · Cergio network · reco's made**, then mutual. Reach is the decision driver. `getInboxPartyCounts` returns `isConnector` (via `isConnectorProfile`) so the badge renders; `formatKeyCounts(…, {recoKind:'made'})` gives the reach-led order.
- **A user/Connector viewing a SERVICE/provider** (spotlight inbox cards, `/spotlight`): LEAD with the **service type + reco's RECEIVED**, then mutual, then network, then IG. Service reputation is the decision driver. `formatKeyCounts(…, {recoKind:'received'})`.

qa.mjs #48 enforces this.

---

## UI / DATA — UNIFIED PUBLIC PROFILE

### SPEC-49 · Viewer-prioritized unified profile (service / connector / both)
**Status:** FROZEN — 2026-06-16 (Tarik)
**Rule:** `/u/:profileId` (`PublicProfileScreen`) is the ONE canonical profile for every user — a SERVICE, a CONNECTOR, or BOTH. It LEADS with a party-signal block (`ProfileSignalBlock`) that reuses the EXACT same data + formatter as the request previews (`getInboxPartyCounts` → `formatKeyCounts`) — no parallel count formatting (SPEC-48b DRY rule).
- **Connector facet:** Connector badge + `formatKeyCounts(recoKind:'made')` → e.g. "319 IG · 5 network · 5 recos made · No mutuals".
- **Service facet:** role + always-on "{N} recos received" + `formatKeyCounts(recoKind:'received', includeReco:false, includeReach:false, includeNetwork:false)` → e.g. "Hair Stylist · 0 recos received" then "No mutuals". **IG/TikTok reach AND the Cergio-network count are NOT on the service facet** (SPEC-49b) — only the always-on mutuals line.
- **Lead facet (rev 2026-06-18, Tarik — SUPERSEDES the serviceMode flip):** when the subject is a **Connector** (with or without services), the **Connector facet ALWAYS leads** — reach is the headline signal, mirroring the interim `/inbound` accept screen ("not plumber then connector"). The headline renders under the Connector badge; the service facet drops below. A pure service (non-Connector) shows the service facet alone. `serviceMode` is retained (`connectorLeads = isConnector || serviceMode`) for the consumer/booking nuance but never demotes a Connector below their service.
- **"People who love {name}" = recommendations RECEIVED** (recommender + their note), NOT the bookings-review table. **"{name}'s Go-Tos" = recommendations MADE.**
- The old standalone RoleBadge/ConnectorBadge row + reviews-sourced section are QUARANTINED. No fake data (SPEC-12).

**SPEC-49b · Profile layout + IG de-duplication (FROZEN 2026-06-17, Tarik).**
- **IG reach + network live ONCE, around the Connector badge.** `formatKeyCounts` gained `includeReach` and `includeNetwork` options (both default true; existing callers unchanged). The unified profile's SERVICE facet passes `includeReach:false, includeNetwork:false` so IG/TikTok AND the Cergio-network count render only on the CONNECTOR facet — they were duplicating across both facets, and reach + network are connector signals, not relevant to a service (e.g. a plumber).
- **"By the numbers" stats grid is REMOVED** (redundant — the signal block already carries network/recos/IG). The dead `getPublicProfileStats` fetch + `stats` state are removed from `PublicProfileScreen`.
- **"View Instagram" link RESTORED** beneath the signal block (regressed off the profile; matches the SPEC-48 "See Instagram" affordance). Opens `instagram.com/{handle}`. The standalone Social-section IG handle + follower-count row is REMOVED — the handle is reachable by tapping View Instagram.
- **About (bio) moved to the TOP** of the content, directly under the identity/signal block, before Services.

**SPEC-49c · Services lead their own recommendations + dedicated all-services page (FROZEN 2026-06-17, Tarik).**
- **Each service LEADS its own recommendations.** On `/u/:profileId`, up to **3 services render inline**; each service tile is immediately followed by **its top 3 recommendations RECEIVED** (the recommender + their note), with a per-service **"See all N recommendations"** in-place expand. Recommendations are grouped per service in `recosByService` (built from the same `recommendations` rows; no fake data, SPEC-12).
- **Mutuals-with-viewer always surface.** Within each service the recommenders are ordered **mutuals-with-the-viewer → Connectors → everyone else**. A recommender the VIEWER is connected to (via `getMyNetworkIds`, both directions of the `network` graph) gets an **"In your network"** badge; verified Connectors get the **Connector** badge. Signed-out viewers simply see no mutual badges.
- **Recommendations Made (the "{name}'s Go-Tos" section) sits BELOW the 3rd service.**
- **More than 3 services → "View all {name}'s services (N) →"** appears after the 3rd service and routes to the dedicated **`/u/:profileId/services`** page (`PublicProfileServicesScreen`), which lists every listed service with the same `ServiceTile` + reco summary. (Inline services no longer expand in place.)
- **Curator with NO services:** the Services block is skipped entirely; the profile shows only Recommendations Made, led by the signal-block counts (network/recos/IG) — unchanged.

**SPEC-49d · "Recos made" count INTENTIONALLY exceeds what Go-Tos displays (FROZEN 2026-06-17, Tarik).** A recommendation can be made to a provider who has NOT claimed/registered yet — the `recommendations` row holds the recommender's review (`message`) + the provider's contact (`recipient_id`/`recipient_phone`) so they can be notified (repeatedly) to eventually register. These rows **count** toward "recos made" (raw count of `recommendations` where `recommender_id = profile`) and feed the notify-to-register loop, but they are **NOT displayed** on the profile — there's no claimed provider profile/photo to show (no fake data, SPEC-12). The Go-Tos / Recommendations Made section renders ONLY recommendations whose `service_id` resolves to a real service (`recoServices` resolves `service_id` → `services` and drops the rest). **Do NOT "reconcile" the count with the section** by either dropping the count or rendering unclaimed recos — the difference is the point.

**SPEC-49e · Connector-first hierarchy + spotlight track record on the full profile (FROZEN 2026-06-18, Tarik).**
- The full profile (`/u/:profileId`) mirrors the interim `/inbound` accept screen's information hierarchy: **Connector/reach leads** (badge → headline → "IG · network · recos made" → View Instagram), **then** About (bio), **then** the service facet/services. NOT "plumber then connector".
- **Spotlights on Cergio** section added: the Connector's posted track record (`getConnectorSpotlights(profileId)` — free barters with a confirmed `post_url`), rendered as **small `IgPostTile`s (`w-[76px]`, aspect 4/5, ~70%)** in a wrapping row, labeled `Spotlight: {service title}`. Same source + tile as the interim screen. Real post links only — collapses silently when none (SPEC-12).

**SPEC-49f · Recommendations-received section (FROZEN 2026-06-18, Tarik).**
- **"Recommendations received"** — a consolidated header + list of every recommendation RECEIVED across the profile's services (`recosReceived`, rendered with `RecoRow`). This is the SPEC-49 "People who love {name}" surface as its own section, in addition to the per-service inline recos (SPEC-49c). Collapses when none.
- **No "Services received / used" section** — Tarik 2026-06-18: services a person *booked* are NOT shown on their profile (wasn't in spec). The profile shows services they OWN ({name}'s Services) and services they RECOMMEND ({name}'s Go-Tos), not services consumed.
- Section order on the full profile: signal block → Spotlights on Cergio → {name}'s Services → Recommendations received → {name}'s Go-Tos.
- **Mutuals on Go-Tos** — each recommended-service (Go-To) card shows an **"In your network"** badge when the VIEWER is connected to that recommended provider (owner in the viewer's `getMyNetworkIds` set). Same trust signal as the per-service recos; computed once so curators with no own services still get it.

**SPEC-49g · Reputational streams everywhere (FROZEN 2026-06-25, Tarik — "the game-changers").** Trust, mutuals, reco-network size, and social reach are Cergio's core differentiator and must be surfaced anywhere a person or recommendation appears. On the unified profile (`PublicProfileScreen` + `ProfileSignalBlock`):
- **Solid Connector badge** — the Connector identity badge is SOLID green (`bg-g text-white`), not the soft mint pill. Same solid treatment on every Connector chip (recommender rows, Go-To cards).
- **Distinct type ramp** — service-type (green bold), reach/IG (bold black), strength counts (light-gray meta), headline (gray meta), bio (body prose), mutuals (green) each render at a visibly different size/weight/color. No more "everything looks the same font".
- **Social reach on BOTH facets** — the subject's IG/TikTok followers + Cergio-network count render on the SERVICE facet too, not just the Connector facet. **This reverses SPEC-49b's "reach/network are connector-only" rule** (Tarik 2026-06-25: "next to connectors add social data — # Cergio network, IG if any").
- **Recommender rows carry full reputation** — every "People who love {name}" row (`RecoRow`) shows the recommender's **mutual-with-viewer badge** ("In your network"), **Connector badge**, AND **social counts** ("12.3K IG · 40 network", `SocialReachLine`, sourced from `getInboxPartyCounts`). Recommender social counts loaded into `recommenderCounts`.
- **Trust-first reco byline** (`recoByline`) — every service tile (`ServiceTile`) and Go-To card names the viewer's own connections FIRST: "Reco'd by you and your friend Jason + 4 more", falling back to plain counts ("Reco'd by 5 friends and 1 Connector") when the viewer shares no one. Go-To cards also show the recommended provider's Connector badge + `SocialReachLine` (`goToOwnerCounts`) + per-service reco summary (`goToSummary` counts ALL recommenders, flags mutuals/viewer).
- **De-dup recos-received** — the per-service inline `RecoRow` list under each service tile is REMOVED (it duplicated the consolidated "Recommendations received" section). **This supersedes SPEC-49c's "each service leads its own recommendations" inline list**; per-service trust now reads via the tile's `recoByline`, and the full testimonials live ONCE in the consolidated section (which gains an "on {service}" line when the provider has >1 service). Tarik 2026-06-25: "reco's received is duplicated — remove the upper ones".

**Shared primitives + apply across the app.** The reputational primitives live in ONE module — `src/components/ui/reputation.jsx` — and every surface reuses them (no per-screen reinvention, SPEC-48b DRY): `recoByline`, `SocialReachLine`, `compactN`, `firstNameOf`, `ConnectorChip` (solid), `MutualBadge`, and **`TrustStream`** (the headline strip — big bold mutuals · on-Cergio · recos numerals that POP, leading with mutuals-with-the-viewer; `recoKind` = 'received' for providers, 'made' for connectors; collapses when no signal). Tarik 2026-06-25: "anywhere we need to display REPUTATIONAL STREAMS (trust, mutuals, size of reco's network) — these are the game-changers… apply across elegantly and thoroughly."
- **PDP (`ServiceDetailScreen`)** carries the same streams: a popping `TrustStream` directly under the provider identity ("next to connector"), the provider's own `SocialReachLine`, the **real provider type** (`taxonomy_provider_type`, e.g. "Hair Stylist") in the identity line — NOT the vague `category` ("Beauty"); a **personalized** "About {firstName}" header; and every "What people say" row carries the recommender's `MutualBadge` + solid `ConnectorChip` + `SocialReachLine` (counts from `getInboxPartyCounts`). The hero story-ruler reflects the **actual** image count (`heroImages.length > 1`) — a single cover no longer fakes a 5-segment "more to scroll" ruler, and the hardcoded fake caption is removed (SPEC-12).
- **Rollout target** (same treatment, in progress): ResultsScreen provider cards, request/inbound previews, and the activity feed.

qa.mjs #49 enforces this.

---

## UI / BEHAVIOR — INBOX (ACTION-FIRST)

### SPEC-50 · Action-first inbox Overview
**Status:** FROZEN — 2026-06-16 (Tarik)
**Rule:** The Jobs **Overview** tab is a single prioritized **action feed**, not a passive digest. Each item is a compact one-liner (`ActionRow`): a headline + short sub-line + the PRIMARY action INLINE. Rules:
- **Lead with $** when a real amount exists (`total_cents`, `offered_price_cents`) — never fabricate an amount (inbound requests have no stored budget, so they lead with the service, not a fake $).
- **Green tone** = "your turn / needs your review" (provider Accept-post, consumer Rate & post). **Salmon** = dispute. Plain = neutral.
- **Order (rev 2026-06-18, Tarik):** the feed is sorted **chronologically, newest first** so the "All" view shows the latest items (including free barters) on top instead of being grouped by section. **Disputes stay pinned** above the chronological list (they block a payout). The build order of the sections no longer dictates display order.
- **Inline actions** reuse existing handlers: Accept post (`handleConfirmPost`), Rate & post (`setPostTarget`), Pay (`payForBooking`), View (`/inbound/:id`).
- **Every row is also VIEWABLE (rev 2026-06-18, Tarik):** the row body (headline + sub) is a tappable button (`onView`) that opens the item's detail (service PDP / request), shown with a "· View →" cue. A row never offers only an action with no way to see what it is. ("given a button to accept but no way to view!! this has regressed").
- **Confirmed bookings stand out:** a confirmed booking renders a green "✓ Confirmed · {service}" row with a one-tap **Add to calendar** (Google Calendar template link from `scheduled_at`), so the user clearly sees it's locked in and can add it.
- **Inbox dot (`useInboxUnread`)** lights on: fresh inbound request, fresh pending booking, a provider accepting your request, a Connector posting your spotlight, AND a **fresh recommendation received** on your services (a 4★+ rate writes one) — so "T rated → info gets the dot" works.
- A **money / free filter** (chips) sorts the feed. Cut clutter copy — no long explanatory paragraphs.
- Empty state: "You're all caught up." Slim Upcoming/Past shortcuts sit below the feed. The Requests/Sent/Upcoming/Past tabs remain the detailed folders.

qa.mjs #50 enforces this.

---

## ANALYTICS — IG POST PERFORMANCE

### SPEC-51 · Spotlight click tracking (connectors + services)
**Status:** FROZEN — 2026-06-16 (Tarik)
**Rule:** Every tap on a Connector's unique spotlight link (`/i/{code}?s={bookingId}`) increments `bookings.spotlight_clicks` via the `record_spotlight_click` SECURITY DEFINER RPC (also stamps `spotlight_verified_at`). ONE booking counter serves BOTH parties: the Connector sees clicks on posts they made; the service/provider sees clicks their spotlight drove. Per-spotlight counts render on the Inbox spotlight rows; a role-split total renders on **Earnings** ("IG spotlight clicks"). No fake data — the Earnings card hides when total is 0. qa.mjs #51 enforces this.

---

## UI / BEHAVIOR — CONTACTS IMPORT (INVITE SPINE)

### SPEC-52 · Contacts import: native picker + Gmail + file fallback
**Status:** FROZEN — 2026-06-16 (Tarik: "best most intuitive easy picker… both gold standard + desktop Gmail")
**Rule:** The invite/reco picker (`InviteFriendsScreen`) offers, in order of intuitiveness:
1. **Native phone Contact Picker** (`navigator.contacts.select`) — mobile gold standard (Cash App-style). Primary button.
2. **Connect Gmail** — desktop gold standard via Google Identity Services token flow + People API (`contacts.readonly`), in `lib/googleContacts.js`. **Env-gated on `VITE_GOOGLE_CLIENT_ID`** — hidden/disabled until configured so it NEVER breaks the page. Setup steps in `GOOGLE_CONTACTS_SETUP.md`.
3. **CSV / vCard upload** — desktop fallback when Gmail isn't configured.

**No fake contacts** (SPEC-12): every path keeps only real `name||email||phone` rows; imported contacts get `dev:` ids and are sent real email/SMS invites.

**SPEC-52b · Single clear path, Gmail is the permanent web gold standard (FROZEN 2026-06-18, Tarik — "do (b), it's a permanent web solution; native iOS/Android post-launch").** iOS Safari has no native Contact Picker, so the picker shows ONE clear PRIMARY per device and at most ONE quiet fallback — **never two identical "upload a file" buttons** (the old "Upload Gmail contacts (.csv)" duplicate is removed):
- Android → native phone picker (primary).
- iOS/desktop **with Gmail configured** → **Connect Gmail** (primary, one-tap); "Or upload a contacts file" is the quiet secondary.
- Otherwise → a single clean contacts-file upload.
`FindFriendsScreen` offers the same real, config-gated **Connect Gmail** row (the old "lying" coming-soon Google tile is replaced by the wired OAuth flow). **To go live, Gmail needs `VITE_GOOGLE_CLIENT_ID` set + Google's restricted-scope verification** (external, multi-week). Native iOS/Android picker = post-launch. qa.mjs #52 enforces this.

---

## UI / BEHAVIOR — RECOMMEND A PROVIDER + REVIEWS

### SPEC-53 · Recommendations come from a completed booking (rate + post); IG post optional when paid
**Status:** FROZEN — 2026-06-17 (Tarik — SUPERSEDES the earlier same-day "Recommend button on the service page" version, which was removed)
**Rule:**
- A recommendation (with a star) can ONLY be made AFTER the user has **booked & completed** that service on the platform. It happens in the **rate + post** flow (`MarkBookingPostedModal`) — there is **NO standalone "Recommend" button on the service page** (`ServiceDetailScreen` mounts no recommend modal).
- That flow serves **both free and paid** bookings. The **IG post is REQUIRED for free/barter** (the barter obligation) and **OPTIONAL when the user PAID** (`isPaid = !is_free_for_rainmaker`; paid submit skips `markBookingPosted` when no link).
- A **4★+** submit writes a **service-linked recommendation** (`recommendService` → `recommendations.service_id`) so it surfaces on the provider's profile ("People who love {name}" / recos received) AND the recommender's Go-Tos. Below-4★ stays the private held-review path (SPEC-47c/47e).
- **EXCEPTION:** the first/**invite recommendation** that onboards a not-yet-registered provider (`RecommendServiceFormScreen`, free-text, `service_id = null`) needs no booking — it drives notify-to-register (SPEC-49d).
- Inbox surfaces **"Rate & post"** (free) and **"Rate & recommend"** (paid, time-boxed 14d) for completed bookings.
- No fake data (SPEC-12): the review text is the user's own words; the recommendation is a real row.

qa.mjs #53 enforces this.

---

### SPEC-54 · Find-a-Connector roster shows ACCEPTED connectors only (with the agreed price)
**Status:** FROZEN — 2026-06-18 (Tarik — "only show confirmed connectors (this one is not confirmed)"; SUPERSEDES the earlier rule that counted `offered`/`countered` as confirmed)
**Rule:**
- On `BrowseConnectorsScreen` (the provider's "Find a Connector to spotlight you" screen), a Connector appears **only** when they have a spotlight_requests row from this provider with **`status === 'accepted'`**. `pending` / `offered` / `countered` / `declined` / `withdrawn` / `expired` do **NOT** qualify — a counter is an open negotiation, not a confirmation (a seeded/provider-side counter must never surface a Connector who never said yes).
- The confirmation lookup is a `Map<connector_id, agreedCents>` built from `offered_price_cents ?? official_price_cents ?? 0`. The roster row shows the **agreed deal** — "Free swap · accepted" when `agreedCents === 0`, else "Agreed $X/post" — **never the rate-card sticker** (`spotlight_price_*`).
- Free-first sort and the "free first" / "no free connectors" messaging key off `agreedCents`, not the rate card.

qa.mjs #54 enforces this.

---

### SPEC-55 · Provider fan-out must re-hydrate services_near rows before the provider-type filter
**Status:** FROZEN — 2026-06-18 (Tarik — bug: providers never got "new request near you" notifications)
**Rule:** `services_near` returns ONLY proximity columns (id / title / location / distance), NOT `taxonomy_provider_type`. Any code that strict-filters its results on `taxonomy_provider_type` MUST first re-hydrate full rows from `services` by id (id → `services.select(id, owner_id, taxonomy_provider_type, status).eq(status,'listed')`), exactly like `searchServices` does. `getProvidersForNotify` filtered the RAW rpc rows → `taxonomy_provider_type` was always undefined → matched nothing → `createRequestAndFanOut` fanned out to ZERO providers (no `new_request` notifications ever written). The re-hydrate is required for fan-out to work. The requester is excluded from their own fan-out (`ownerIds.filter(id => id !== uid)`).

qa.mjs #55 enforces this.

---

### SPEC-56 · Recommendation + accept-with-time must fire their notifications
**Status:** FROZEN — 2026-06-18 (Tarik — "verify real email/SMS fire for the key events")
**Rule:** Two events were writing their row but never firing a notification, so the recipient got no email/SMS:
- **`recommendService`** must fire `notifyUser({ event: 'service_recommended', recipient: <service owner> })` after writing the recommendation (the notify-user edge fn already has that template). Best-effort; never blocks the rating. Skips self-recommendation.
- **`acceptRequestWithTime`** must fire `fireBookingNotify(bookingId, 'accepted')` after the RPC — this path creates the confirmed booking directly (no `request_response` row), so without it the requester is never told their request was accepted.

qa.mjs #56 enforces this.

---

### SPEC-57 · Referral settlement — SERVER-AUTHORITATIVE (the growth-engine money path)
**Status:** FROZEN — 2026-06-26 (Tarik — "the heart of the growth engine; a disaster if users can't get paid / receive credits / track invites"). **Supersedes the 2026-06-18 client-side version.**
**Rule:**
- **Canonical credit lives in ONE Postgres RPC `credit_referral_for_booking(booking)`** (migration `20260626020000`), SECURITY DEFINER. The **Stripe webhook** calls it on `payment_intent.succeeded` (the reliable path, both held + instant modes, after stamping `paid_at`); the client `creditInviterOnFirstBooking` calls the SAME RPC as a safe redundant trigger. No more best-effort client-side math.
- **Economics (Tarik-confirmed):** 1st tier (direct) = **7% of each paid booking, ACCUMULATING, cap $250 per friend**; 2nd tier (fof/chain) = **0.5% of each paid booking, ACCUMULATING, cap $12.50 per friend-of-friend** (= 5% of the $250 tier). Depth 2 only (great-grandparent never earns). All from `REWARDS` (referrerSharePercent 7 / perFriend 250 / chainSharePercent 0.5 / friendOfFriendBonus 12.5).
- **Idempotent + guarded:** at most one earnings row per (earner, booking, tier); only credits when the booking is `paid_at`-stamped and `total_cents > 0` — so a FREE booking never credits and never burns the referral, and re-firing (webhook retry + client) can't double-credit.
- **Status `cleared`** — referral credit is platform credit owed once the booking is paid, so it counts as EARNED immediately (`getMyEarningsSummary` counts `cleared`); it is NOT stuck `pending`. (Cash-out for Connectors stays the payout request.)
- **invite_joined still fires** on signup (`recordInviteFromActiveRef`). **InviteTrackingScreen shows the $** (earned header + per-row reward badge). *(Follow-up: server-side "you earned" notify on credit — was client-side, now owed by the webhook.)*
- qa.mjs #57 enforces the RPC economics + guard + idempotency + webhook wiring.

qa.mjs #57 enforces this.

---

### SPEC-58 · On-demand city expansion (app REQUESTS crawls; it never crawls)
**Status:** FROZEN — 2026-06-18 (Tarik — "crawl 10 best services / 5 best influencers when we don't have data for a city"; reuse the crawl spec)
**Rule:** Per `CRAWLER_BRIEF.md`, the app **consumes** crawl directories and **never crawls itself**. When a request lands in a city with no matching data, the app **enqueues a `crawl_requests` row**; the separate crawler service polls `status='new'`, sources the leads, ingests into `leads_services` / `leads_influencers`, fires outreach, and stamps `delivered`.
- **`enqueueCityCrawl({ kind, city, lat, lng, serviceType, targetCount, triggerRequestId })`** inserts the queue row (best-effort; idempotent via a partial-unique index on `(kind, city, service_type)` for OPEN rows; requires sign-in for RLS).
- **Services trigger:** `createRequestAndFanOut` — when `ownerIds.length === 0` (no provider matched in radius) with a known `provider_type` + coords → enqueue `kind:'services'`, `targetCount:10`.
- **Influencers trigger:** `broadcastSpotlightRequest` — when the service's city has **0** `leads_influencers` → enqueue `kind:'influencers'`, `targetCount:5`, with the service's adjacency type. City-scoped, error-safe.
- Migration `20260618000000_crawl_requests.sql` (RLS: insert/select own; crawler uses service role).

qa.mjs #58 enforces this.

---

### SPEC-59 · Credit-card identity gate on POST (test accounts bypass)
**Status:** FROZEN — 2026-06-19 (Tarik — "no Connector/user/service can initiate a post without verifying identity against a credit card; test accounts bypass")
**Rule:**
- **Publishing a spotlight post requires a verified card.** Both publish paths gate on it: `MarkBookingPostedModal` (barter rate+post — gates only the actual publish; a held <4★ rating and a paid no-post recommendation still pass) and `MarkPostedModal` (paid spotlight). If `cc_verified` is false they open `CcGateModal` (reason `post`, Stripe **SetupIntent** — no charge); on success the post proceeds.
- **Single source of truth:** the gate reads `getMyCcStatus()`. **Test accounts bypass** — `getMyCcStatus` returns a synthetic `cc_verified_at` (+ `cc_bypass`) for `IDENTITY_BYPASS_EMAILS` (`t@cergio.ai`, `info@cergio.ai`), so they (and every other gate that reads it — request/listing/photos) pass without a real card.
- Verification stamps `profiles.cc_verified_at` (`markCcVerified`); the `setup_intent.succeeded` webhook is the canonical confirm.

qa.mjs #59 enforces this.

---

### SPEC-60 · No duplicate listings + PDP polish (terminology / lines / free-form request)
**Status:** FROZEN — 2026-06-19 (Tarik — "one bug: duplicating services"; PDP design audit)
**Rule:**
- **No duplicate services.** The list flow was double-firing `createService` (initial-verified + post-gate + strict mode), inserting two identical rows microseconds apart. Fixed at two layers: `ServiceListSetupScreen` guards the persist effect with a one-shot `submittedRef`; **`createService` de-dupes** — before inserting it returns any listing this owner already has with the SAME `title` created in the last 2 minutes (`deduped:true`).
- **PDP (`ServiceDetailScreen`) polish:** offering cards use **lighter/thinner selection** (`border-g/70 bg-gl/40` selected, `border-line` unselected — no heavy 1.5px ring). "Submit a request for a custom quote" opens the **homepage free-form** (`/home` with a prefill), not the structured quote sheet.
- **Terminology (Cergio canon):** GOAT→Connector, Romio→Cergio, **Go-Tos→Recommendations** ("{name}'s Recommendations"). qa #60 + the screens enforce this.

qa.mjs #60 enforces this.

---

### SPEC-61 · SEO part 1 — per-record document meta (SSR is part 2)
**Status:** FROZEN — 2026-06-19 (Tarik — SEO; full prerender chosen)
**Rule:** `useDocumentMeta` sets per-record `<title>`, description, canonical, Open Graph + Twitter tags from the record being viewed. Wired on **`/u/:profileId`** (person name + headline/bio) and **`/service/:serviceId`** (listing + owner + cover image). `index.html` carries default brand meta the screens override. The hook is called **before** any early return (rules-of-hooks) and gated by `ready` until the record loads; it restores the prior title on unmount.
- This helps Google (which renders JS) + correct tab/share titles. **Full social-scraper coverage (FB/LinkedIn/iMessage) requires SSR/prerender — SEO part 2**, a separate build-verified pass (Vike), NOT shippable as client-only tags.

qa.mjs #61 enforces this.

---

### SPEC-62 · SEO part 2 — server-rendered link previews for crawlers
**Status:** FROZEN — 2026-06-19 (Tarik — SEO part 2)
**Rule:** `api/meta.js` (Vercel serverless fn) server-renders a full HTML document — `<title>`, description, canonical, Open Graph, Twitter, and JSON-LD (`Person` for profiles, `Service` for listings) — by fetching the record live from Supabase via the public anon key (same RLS-gated read the public page does; **no new secrets**). `vercel.json` routes **`/u/:id`**, **`/u/:id/services`**, and **`/service/:id`** to this function **only when the `user-agent` header matches a known crawler** (facebookexternalhit, Twitterbot, LinkedInBot, Slackbot, WhatsApp, Discord, Telegram, Googlebot, bingbot, Applebot, etc.). **Humans never hit the function** — they fall through to the SPA `index.html` catch-all, so there is zero risk to the live app.
- **Why not Vike/SSG:** these pages are user-generated and change constantly → they don't exist at build time, so SSG can't prerender them; a full Vike SSR migration would rewrite the 100-screen react-router shell (regression risk). This delivers full crawler-meta coverage at ~0 risk.
- **Invariants:** all output is HTML-escaped (injection guard); the record `id` is sanitised via `cleanId` (UUID-ish only — SSRF/REST-injection guard); a missing/unreadable record returns a branded `WebSite` fallback at HTTP 200 (never a broken preview); responses set `s-maxage=300, stale-while-revalidate` for CDN caching. Every `/api/meta` rewrite MUST stay UA-gated and the SPA `/(.*)` → `index.html` catch-all MUST remain last.
- **Deploy note:** needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` present in Vercel env (already set for the frontend build — serverless fns read all project env vars).

qa.mjs #62 enforces this.

---

### SPEC-47g · Held funds + 3-hour auto-release for paid bookings
**Status:** FROZEN — 2026-06-20 (Tarik — "do 2"; staged + flag-gated rollout)
**Rule:** Paid bookings can be held in escrow and released to the provider 3 hours after the provider marks the job complete. **Gated by edge-function env `HOLD_RELEASE_ENABLED`:**
- **OFF (default):** `create-payment-intent` uses a Stripe **destination charge** (`transfer_data` + `application_fee_amount`) → provider paid instantly. Legacy/live behavior; unchanged until the flag flips.
- **ON:** `create-payment-intent` creates a **separate charge** to the platform under `transfer_group = booking_<id>` (no `transfer_data`); the webhook records `stripe_charge_id` and does **not** book earnings yet; the `release-funds` worker later transfers the provider share (total − 10%) from that charge and books earnings.
- **Release window:** `markBookingComplete` sets `release_due_at = completed_at + 3h`. **GUARD:** if `completed_at < scheduled_at` (provider marked complete before the job started), it sets `release_requires_confirm = true` and **no** `release_due_at` — the consumer must call `confirmJobDone` (which sets `release_due_at = now`) before any release.
- **release-funds worker** (service-role bearer only) transfers funds for bookings that are held (`transfer_group` set), unreleased (`stripe_transfer_id`/`released_at` null), have a charge, are due (`release_due_at <= now`), and not cancelled/refunded/disputed. Idempotent via `stripe_transfer_id` guard + Stripe `idempotencyKey: release_<id>`. Instant-mode bookings have no `transfer_group`, so they are never touched (no double-pay).
- **Trigger:** `Release Due Funds.command` (manual, staged) or the documented pg_cron block in the migration (every 15 min) once enabled.

qa.mjs #47g enforces this.

---

### SPEC-63 · Crawl pipeline monitoring + failure alerts (can't fail silently)
**Status:** FROZEN — 2026-06-20 (Tarik — "need an automatic admin dashboard + alerts for crawls that don't deliver")
**Rule:** The on-demand crawl pipeline must surface its own failures.
- **`crawl-health-check`** edge fn (service-role only; cron + `Crawl Health Check.command`) classifies problems and **emails the admin** (Resend, `notify@cergio.ai` → `ADMIN_ALERT_EMAIL`, default t@cergio.ai) with a plain-English diagnosis + fix: **STALLED** (status new/crawling older than `CRAWL_STALE_HOURS`, default 2h → crawler not polling), **FAILED** (status='failed'), **EMPTY** (delivered with delivered_count=0). Emails only when issues exist (or `?force=1`).
- **`admin-crawl-status`** edge fn (admin-gated by caller JWT email in `ADMIN_EMAILS`; reads via service role) returns the live dashboard JSON.
- **`/admin/crawls`** (`AdminCrawlScreen`, admin-only, auto-refresh 60s) renders health banner, stalled/failed/empty issue cards, queue-by-status, recent requests, leads funnel — a live link.
- Read-only **`Monitor Crawl + Outreach.command`** gives the same picture from the terminal. Automatic 15-min cron documented in the migration; manual launchers ship meanwhile.

qa.mjs #63 enforces this.

---

### SPEC-64 · In-app crawl fulfillment (no crawl → no notify, fixed)
**Status:** FROZEN — 2026-06-21 (Tarik chose "A — build in-app auto-fulfillment")
**Supersedes** the `CRAWLER_BRIEF.md` "app never crawls itself" rule **for services**: fulfillment now runs as a background edge function (NOT in the user's live search path), which is the deliberate trade chosen to make no-data searches actually deliver.
**Rule:** **`fulfill-crawl`** edge fn (service-role only; cron + `Fulfill Crawls.command`) processes `crawl_requests` where `kind='services'`, `status='new'`:
1. Google Places **Text Search + Details** for `service_type` in `city, state` (server key `GOOGLE_PLACES_API_KEY`, must be unrestricted).
2. Upsert businesses into **`leads_services`** (dedupe by Google `place_id`), `data_source='google_places'`, **`outreach_status='new'`** (raw/ungraded). _(2026-06-28 reset: was `leads_localbiz`; that bucket is now dormant brick-and-mortar Phase 2. The DATA-QUALITY GATE promotes reachable mobile types `new→queued` and quarantines storefront/off-target `→do_not_contact`; only `queued` is ever contacted.)_
3. Stamp `crawl_requests` `status='delivered'` + `delivered_count` (or `failed` w/ notes; 0 results → delivered/0 → EMPTY alert via SPEC-63).
4. **Email the searcher** (`requested_by`) so they're never left hanging.
- **COMPLIANCE INVARIANT:** `fulfill-crawl` NEVER sends cold email/SMS to the sourced businesses — leads land `outreach_status='new'` (raw) and are only contactable after the gate promotes them to `queued` (operator-reviewed), because unsolicited business outreach is governed by CAN-SPAM / TCPA. Only the SEARCHER (an existing user) is emailed.
- Influencer crawls (`kind='influencers'`) are out of scope here (Google Places is a business directory).

qa.mjs #64 enforces this.

---

### SPEC-65 · Automated business outreach (compliant, opt-out enforced)
**Status:** FROZEN — 2026-06-21 (Tarik — auto-notify sourced businesses)
**Rule:** Sourced leads are contacted automatically, **compliantly**:
- **`outreach-send`** (service-role; cron + `Send Outreach (email).command`) auto-emails **`leads_services`** rows that are **`outreach_status='queued'`** (gate-APPROVED only — never raw `new`) AND have an `owner_email`, gated by `OUTREACH_EMAIL_ENABLED` (default true). _(2026-06-28 reset: was `leads_localbiz` + `new`.)_ Every email has: honest sender identity, the **legal postal address** (Yogotoo, 14 West 23rd, 5th Floor, New York, NY 10010), and a **one-click unsubscribe** (footer link + RFC 8058 `List-Unsubscribe` header). Send-once (flips to `sent`), throttled (batch 40).
- **`outreach-optout`** (PUBLIC, HMAC-verified) inserts into `outreach_suppressions` and flips matching leads to `do_not_contact`. **Every send checks `outreach_suppressions` first** — opt-outs are permanent + immediate.
- **`fulfill-crawl`** best-effort captures a public contact email from each business website so email outreach has an address.
- **SMS (SPEC-66):** `outreach-send` also texts services/influencers we have a PHONE for but no email (one channel per lead — email preferred, SMS fallback) via Twilio, **gated by `OUTREACH_SMS_ENABLED` (default false)**. Every text carries identity + "Reply STOP to opt out" (Twilio Messaging Service auto-honors STOP) and is suppression-checked + send-once. **Hard prerequisites before it can deliver:** Twilio creds set AND US A2P **10DLC** brand+campaign registered (carriers block unregistered traffic). TCPA exposure (a published number is not consent) is the operator's accepted business decision — Tarik 2026-06-22; counsel recommended.
- **WhatsApp:** still NOT auto cold-sent — Meta prohibits messaging non-opted-in users (opt-in + approved templates only; cold blasting → account ban). Reserve for replied/opted-in contacts.
- **SPEC-67 · Influencers:** `outreach-send` also processes `leads_influencers` (keyed by `ig_handle`) — creator-flavored email where we have their public business email, gated SMS where we have a phone, same suppression/opt-out/send-once rules. Of the sourced Miami creators: 92% have a phone, 65% email, 100% reachable. **There is NO compliant scalable auto-DM** on IG/TikTok (no cold-DM API; automation = bans); reach is via the published contact email/phone (the same data Modash et al. aggregate — the Graph API does NOT return third-party emails/phones). Email coverage is raised by enrichment (paid creator-data provider, or website/linktree scrape) — NOT by the official Meta API.

qa.mjs #65 enforces this.

---

### SPEC-68 · Influencer contact enrichment (safe, non-IG)
**Status:** FROZEN — 2026-06-22 (Tarik). **Rule:** `enrich-influencers` edge fn (service-role; cron + launcher) raises email/phone coverage on `leads_influencers` by parsing `bio` and fetching the creator's own `external_url` (link-in-bio/website) — third-party public sites, **never Instagram** (IG harvesting stays in the clean-room external crawler per `CRAWLER_BRIEF_IG_contacts.md`). Fills only NULL fields, never overwrites, skips `do_not_contact` + suppressed. qa.mjs #68.

### SPEC-69 · Periodic workers (self-running pipeline)
**Status:** FROZEN — 2026-06-22 (Tarik). **Rule:** pg_cron (via pg_net + a Vault `edge_fn_bearer` service key) runs `fulfill-crawl` (15m), `enrich-influencers` (30m), `crawl-health-check` (2h), `release-funds` (15m). **`outreach-send` is deliberately NOT scheduled** — cold email/SMS stays manual until explicitly automated. qa.mjs #69.

qa.mjs #65 enforces this.

---

## CODE HEALTH — SUPABASE RPC

### SPEC-RPC1 · Never call `.catch()` on a supabase.rpc() builder
**Status:** FROZEN — 2026-06-16 (Tarik — bug: every invite/spotlight `/i/` link hung on "Opening profile…")
**Rule:** `supabase.rpc(...)` returns a thenable QUERY BUILDER with **no `.catch()`** — calling `.catch()` throws synchronously and aborts the caller. Fire-and-forget RPCs must be wrapped: `Promise.resolve(supabase.rpc(...)).catch(()=>{})` or awaited in try/catch. qa.mjs #rpc1 enforces this.

---

## PROCESS — HOW SPEC ITEMS ARE ADDED

1. Tarik confirms a behavior in chat ("this is correct", "keep it like this", "that's frozen").
2. Claude adds a SPEC-NN entry to this file immediately in the same session.
3. Claude adds a matching `test('spec-NN', ...)` to `qa.mjs`.
4. Claude pushes both via `Unlock and Push.command`.
5. The item is now enforced on every future push.

**Changing a frozen spec item:**
Tarik must explicitly say "change SPEC-NN" or "this behavior should now be X" in chat.
Claude updates this file, updates the qa.mjs test, and pushes.

---

## QA GATE SUMMARY

Every `git push` runs `qa.mjs` via `Unlock and Push.command`. A failing test **blocks the push**.

| SPEC-ID | qa.mjs ID | Description |
|---------|-----------|-------------|
| SPEC-42 | #42 | No barter pill on waiting state |
| SPEC-43 | #43 | Invite contacts from network table only, no pre-selection |
| SPEC-44 | #44 | Geocoder error clears when Nominatim rescues |
| SPEC-12 | #12 | No mock data on signed-in screens |
| SPEC-45 | #45 | Free spotlight: no Pay step, no paid_at gate, no 24h expiry |
| SPEC-46 | #46 | Reco form: device contacts only, single-select, auto-populate |
| SPEC-47 | #47 | Free barter loop: schedule confirm, no auto-confirm, post → accept gate |
| SPEC-48 | #48 | Request screen: job details, approximate map, IG block, friends-in-common, no fake photos |
| SPEC-67b | #67b | Reco RECEIVED surfaces as a "You were recommended" item in the Inbox Overview (reco dot must have a landing, not dead-end) |
| SPEC-67c | #67c | Resolver never emits generic "Service Provider" (derives specific type from category); fan-out matches case-insensitively on provider_type OR category |
| SPEC-68 | #68 | Resolver: complete index from offering_master; provider-type/category matched FIRST; accent-normalized (ES/PT); fuzzy guesses routed to Claude (<0.60, never confident-wrong); where-step accepts any reply as address (no re-ask loop) |

---

## SPEC-67b · Recommendation-received has an inbox landing
**Status:** FROZEN — 2026-06-24
**Rule:** The inbox dot (`useInboxUnread`) lights on a fresh recommendation received
(`recoTimesOnMyServices`). That dot MUST land on something: `listRecosOnMyServices`
fetches recos received on the signed-in user's own services, and the Inbox Overview
action-feed renders a `reco-<id>` item ("<Recommender> recommended you · <service> ·
\"<review>\""). Do not light the reco dot without this landing item.

## SPEC-67c · Parser ontology — no generic mislabel, no silent no-match
**Status:** FROZEN — 2026-06-25
**Why:** 450/932 offerings (48%) were tagged `notify_as="Service Provider"` (generic
catch-all) → e.g. "personal chef" resolved to "Service Provider", which exact-matched
NO provider listing, so ~half of all searches silently notified nobody.
**Rule:**
- `resolveQuery` MUST return the specific provider type. `pickType(offering)` returns
  `notify_as` unless it is a generic value (`Service Provider`/`provider`/etc.), in
  which case it returns the offering's `category` (the granular ontology node). No
  resolver return site may emit raw `notify_as` directly.
- `getProvidersForNotify` matches **case-insensitively** on `taxonomy_provider_type`
  **OR** `category` — never a single exact, case-sensitive field.

**Ontology precision standard (2026-06-26).** Two gates protect "Ferrari" quality:
`scripts/eval-ontology.ts` (109 labeled phrases — 100% local, 0 confident-wrong)
and `scripts/audit-ontology-coverage.ts` (the FULL catalogue — every real search
term, 7,285 across 932 offerings). Full-catalogue audit: 79% correct, 20%
ambiguous-OK (cross-listed across types), 0% miss, **0.73% (53) TRUE
confident-wrong — all intentional parent/synonym bridges** (notify the broader
populated type, e.g. "EV charger"→Electrician, "balayage"→Hair Stylist; several
are *more* correct than the taxonomy label). The audit is a regression gate
(budget 60). Parent-bridge mappings are INTENDED — do NOT "fix" them toward the
hyper-niche child type, which would notify nobody. Run via "Audit Ontology
Coverage.command".
- A request that matches no provider must NOT fail silently: it enqueues an on-demand
  services crawl and the requester sees a "we'll keep looking" state.

---

### SPEC-70 · Soft-launch opt-in barter outreach (the seam into the growth system)
**Status:** FROZEN — 2026-06-27 (Tarik soft launch).
**The pitch (both sides, sharpened, founder-voiced):**
- **To businesses:** give ONE free service to a vetted local creator → they spotlight you to their followers on IG/TikTok. New clients, zero ad spend.
- **To creators/connectors:** get free local services in exchange for an IG/TikTok spotlight to your followers.

**Rules:**
- **Email** (`outreach-send`, CAN-SPAM, already live) carries the barter copy + a prominent **per-recipient opt-in CTA** (`ctaButton` → `outreach-optin?t=biz|inf&a=<addr>&k=<hmac>`). Opt-out footer stays.
- **`outreach-optin`** (new, PUBLIC, HMAC-verified, no auth): marks the matching lead `outreach_status='opted_in'` (+ timestamp) and **302-redirects into the app** (`/auth?src=soft_launch&role=service|connector`). Tapping the link = the recipient's consent — this is the seam that migrates a personal launch convo into the permanent product (claim → request → referrals).
- **Free WhatsApp channel:** `outreach-send?wa=1&limit=N` is a **read-only generator** returning `wa.me` click-to-chat links (message + opt-in link pre-filled) for phone leads. The **"Generate WhatsApp Outreach.command"** builds a clickable page; the FOUNDER taps each to send **personally** — no bulk send, no API, no ban risk. Keep ~20–40/day, personalize line 1.
- **SMS** bodies updated to the same barter copy + opt-in link, but stay gated behind `OUTREACH_SMS_ENABLED` + Twilio funding/10DLC (SPEC-66). Cold SMS is NOT auto-sent.
- No cold WhatsApp bulk send, ever (ban + ToS). qa.mjs #70 enforces the opt-in link + function + wa.me generator.

---

---

### SPEC-71 · Founder-frozen decisions (2026-07-09) — authoritative, testable
**Status:** FROZEN — 2026-07-09 (Tarik). Principle: **founder decisions live HERE, in the frozen spec — not in memory or chat.** Each item below is a fixed target the acceptance-test suite asserts against.

1. **Rolling-wave dispatcher numbers (FROZEN, no longer "tunable"):** first wave at request time, next waves at **T+2 minutes** each, **10 providers per wave**, **60-minute overall cap**, and **stop conditions: 1 booking OR 2 responses** received. Each wave writes `request_wave_N` notification rows. Tests assert these exact numbers.
2. **Search Results = ONLY confirmed responses.** The `request_responses` path is canonical: Results shows only providers who have **confirmed** a response to the request. The live `listServices`/rank path is used for *dispatch/discovery*, NOT rendered as the requester's Results list. Tests assert Results never shows unconfirmed providers.
3. **CONNECTOR_MIN_FOLLOWERS = 300 for testing; lifts to 5000 at soft launch.** The Connector badge/eligibility asserts against the currently-active value (300 now → 5000 at launch flip).
4. **Escrow (SPEC-47g) = ON (FROZEN).** Customer's payment is HELD in escrow, not paid through at checkout. Release rules:
   - **Default auto-release: 6 hours after the job START time.**
   - **(a) Expedited early release** when ALL of: the **service confirms the job done**, AND the **user rates** the service, AND the **user confirms** completion → funds release immediately (before the 6h).
   - **(b) Challenge/hold:** if the **user rejects the "done"** and submits the problem → funds are **held** and the case **escalates to support** (dispute thread), not released on the 6h timer until resolved.
   - Tests assert: funds held at checkout; auto-release at start+6h with no challenge; early release on the (service-done + rated + confirmed) triple; and hold+escalate on a challenge.
5. **Blocked categories (FROZEN, authoritative — supersedes memory):** massage, tattoo, makeup, personal chef, PLUS SHAFT — plastic surgery, drugs, alcohol, tobacco, gambling, firearms, adult, nightclub/DJ. These never resolve to a provider_type and never sit sendable in `leads_services`. Tests assert none ever surface.

---

---

### SPEC-72 · Operating law: firing-honesty + max output (2026-07-09, FROZEN)
**Status:** FROZEN — 2026-07-09 (Tarik). Top-severity operating rules; violation is the worst-class failure.

1. **FIRING-HONESTY (never mislead about status).** Every status claim MUST distinguish three states with evidence: **WRITTEN** (in spec/code, not deployed) · **BUILT** (deployed but not yet proven) · **VERIFIED-LIVE** (proven firing with live evidence — rows moved / test green). It is FORBIDDEN to write something into the spec, ledger, or code and imply it is "firing / running / live / done" unless it is VERIFIED-LIVE. Writing a requirement ≠ shipping it. The dashboard + requirements ledger must show each item's true state (verified vs open), and no verbal claim may outrun the evidence. This is the #1 rule.
2. **Verified requirements are FROZEN, not re-listed.** Once a requirement is VERIFIED-LIVE it becomes frozen spec (locked, assumed-held via its regression test) and drops off the "open/pending" surface — the open list shows ONLY what is not yet verified, so the remaining work is always the honest, shrinking delta.
3. **MAX OUTPUT AT HIGHEST QUALITY, LEAST TIME.** Every task ships at the highest output and quality achievable in the least time. Padding, self-throttling, artificial pacing, and unused capability are forbidden waste; quality (the CI/test gate) is the only valid brake. Small tasks that can be done in ~30 min must be, not stretched.

---

## OPS / THE AUTONOMOUS LOOP (it must never run blind)

### SPEC-73 · Every failure records a REAL reason — "[object Object]" is banned
**Status:** FROZEN — 2026-07-13
**Rule:** Supabase/PostgREST rejects with a **plain object** (`{message, details, hint, code}`), not an `Error`. `String(e)` on it produces the literal string `"[object Object]"` — which is how **11 of 11 failed autonomous actions** recorded an unreadable `coo_proposals.result` and the loop went blind for days.

Every worker that writes a failure to the DB (`coo-execute`, `creator-harvest`, `enrich-influencers`, `fulfill-crawl`, `cergio-watchdog`, `cergio-orchestrator`, `qa-suite`) MUST serialize thrown values with the **canonical `serr()` helper**, which extracts `message` → nested `error.message` → `details`/`hint`, plus the SQLSTATE/HTTP `code` and two stack frames.

**Banned:** `e instanceof Error ? e.message : String(e)` and any raw `String(e)` on a thrown value.
**Anti-drift:** all copies of `serr()` must be byte-identical (they deploy separately; one fork = one blind agent).

qa.mjs #73 enforces this — it *executes* the shipped helper against a PostgREST-shaped rejection.

---

### SPEC-74 · A worker that finds rows and writes none must say WHY (no silent success)
**Status:** FROZEN — 2026-07-13
**Rule:** `raw_found > 0 && rows_written = 0` is never `status:'ok'`. It is `'empty'` (or `'error'` when a write genuinely failed) with an explicit reason string on `agent_runs.error` and a per-reason `skips` tally in `agent_runs.meta`.

Two mechanics are mandatory for any worker that scans a lead table:
1. **A CURSOR.** A candidate query with no ordering and no attempt marker re-selects the SAME head-of-table rows every run — a livelock, not a collision (this is what froze `enrich-influencers` at "found 40 / wrote 0" for 5 days). Every candidate LOOKED AT is stamped (`leads_influencers.enrich_attempted_at`), hit or miss, and the query takes least-recently-attempted first.
2. **PROOF OF WRITE.** Every update/upsert ends in `.select('id')`; an error **or a 0-row match** counts as a failure, never as success.

qa.mjs #74 enforces this.

---

### SPEC-75 · A defect may not sit unfixed — staleness escalates
**Status:** FROZEN — 2026-07-13
**Rule:** Any `qa_finding` still **open** after `QA_ESCALATE_AFTER_HOURS` (default **12h**) with no fix is escalated by `cergio-watchdog`: severity → `critical`, and a **needs-approval** `coo_proposal` ("STALE DEFECT: …") is raised naming it as a stale unfixed defect and stating whether a fix was ever attempted. `qa_findings.escalated_at` is stamped so it escalates **exactly once** (never a loop); `cergio_qa_check` clears `escalated_at` and resets `found_at` when the finding is genuinely fixed, so a NEW occurrence can escalate again. Escalations are capped per heartbeat. The escalation proposal is `requires_approval=true` / `action_kind='none'` — the executor can never auto-run it.

qa.mjs #75 enforces this.

---

### SPEC-47j · Scheduled-vs-instant is a WRITE-TIME invariant
**Status:** FROZEN — 2026-07-13 (clarifies SPEC-47.1; the rule itself is unchanged)
**Rule:** "Scheduled bookings honor the chosen time" is asserted **relative to the booking's own `created_at`** — `scheduled_at > created_at + 12h` AND `schedule_confirmed_at` stamped — never as "`scheduled_at` is in the future relative to the clock". A QA fixture is written once and then ages: comparing a stored booking to `Date.now()` turns a correct row red days later (that false red is exactly what sat on the dashboard). `accept_request_with_time` is the code under test and is correct (`coalesce(p_scheduled_at, …)`).

qa.mjs #47j enforces this (and `qa-suite` + `qa-live.mjs` share the assertion).

---

### YellowPages: RETIRED (2026-07-13)
YP answers datacenter IPs with **HTTP 403**, permanently. `fulfill-crawl` no longer fetches `source='yellowpages'` jobs; leftovers are quarantined once as `yp-blocked-permanent` and never retried; the seeder cron is unscheduled and the agent disabled. **Google Places is the live services path.** The parser stays dormant behind `YP_ENABLED` (default false) — reversible in one env var. Requirement `p10-crawl-yp-drain` is retired. qa.mjs `p10-crawl-yp-retired` enforces this.

---

*Last updated: 2026-07-13 by Claude (Cowork session) — SPEC-73/74/75 + SPEC-47j: the autonomous loop must never run blind (canonical serr, no silent success, staleness escalation) + YellowPages retired*
