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
- Easy surfacing: the Jobs **Overview** shows action rows — "Post your IG spotlight · N" (you're
  the Connector, provider marked complete) and "Spotlights to review · N" (you're the provider,
  Connector posted).

**SPEC-47d · Spotlight = the Connector's UNIQUE referral link, Story-first (FROZEN 2026-06-15, Tarik).** The post step (`MarkBookingPostedModal`, 4★+ path) is built around conversions:
- The Connector's UNIQUE link `buildInviteUrl(connectorId)` (`/i/{code}`) + `?s={bookingId}`. Signups through it credit them (7% up to $250, first-touch via the existing referral system); `?s=` ties a click to THIS spotlight for the auto-audit.
- Story-first guided flow (the only clickable, trackable IG surface): copy link → add to Story with the **Link sticker** → save to a **"Spotlights" Highlight** (permanence past 24h). "Open Instagram" helper. Bio-link upsell ("earns on every post"; feed posts tag @cergio + #cergiofeed). Earnings shown inline to motivate.
- Qualify/audit: clickthrough on the unique link is the live-proof now; automatic **oEmbed caption check** (@cergio + link + #cergiofeed) activates once Meta Graph access is approved (scheduled).

**SPEC-47h · Provider accept-with-time → confirmed booking + reschedule (FROZEN 2026-06-16, Tarik).** On the connector-request screen, the provider's accept can set the TIME: "Pick a time & accept" (flexible request) and "Accept & confirm" (specific time) now create a **CONFIRMED booking** at the chosen time via the `accept_request_with_time` SECURITY DEFINER RPC (provider creates the booking for the Connector; verifies caller owns the service) — NOT just an offer. It lands in both parties' Upcoming immediately. EITHER party can then **Reschedule** (inline datetime control on the Upcoming cards → `rescheduleBooking`) — "change the time together." (The plain inline-inbox "Accept" still sends a quick offer; the time-pick lives on the detail screen.)

**SPEC-47i · Forced barter post-gate on the Connector (FROZEN 2026-06-16, Tarik).** Once the SERVICE/provider has **marked the job complete** (`completed_at` set) and the Connector has **not yet posted** their spotlight, the Connector's WHOLE app is **hard-blocked on login** by a full-screen interstitial (`BarterPostGate`, mounted at App root): headline "{Provider} marked your service complete" + button **"Rate & post to IG"** (opens `MarkBookingPostedModal`). It is NOT dismissible — closing the modal returns to the block. The block **releases** the moment the Connector has acted: a 4★+ post (`posted_at`) OR a review of any kind (the held <4★ path counts — never a permanent lock). `getOutstandingFreeBarter` surfaces `completed_at` + a `reviewed` flag for this. **If the provider has NOT marked complete, there is NO block** — the Connector posts from the Inbox at their own pace (the JobsInbox `needsPost` CTA). Relatedly, the provider's "Mark job complete" button drops out once the Connector has already posted (`canMarkComplete` gates on `!posted_at`) so the provider never sees "Mark complete" next to "Accept post". qa.mjs #47i enforces this.

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
- **Service facet:** role + always-on "{N} recos received" + `formatKeyCounts(recoKind:'received', includeReco:false)` → e.g. "Hair Stylist · 0 recos received" then "No mutuals · 12.4K IG · 3.1K TikTok".
- **Viewer priority (SPEC-48c, same rule as request previews):** consumer mode (`serviceMode===false`, looking to book) → **service facet leads**; provider mode (`serviceMode===true`, marketing) → **connector facet leads**. When the subject is BOTH, both facets show, priority on top.
- **"People who love {name}" = recommendations RECEIVED** (recommender + their note), NOT the bookings-review table. **"{name}'s Go-Tos" = recommendations MADE.**
- The old standalone RoleBadge/ConnectorBadge row + reviews-sourced section are QUARANTINED. No fake data (SPEC-12).

qa.mjs #49 enforces this.

---

## UI / BEHAVIOR — INBOX (ACTION-FIRST)

### SPEC-50 · Action-first inbox Overview
**Status:** FROZEN — 2026-06-16 (Tarik)
**Rule:** The Jobs **Overview** tab is a single prioritized **action feed**, not a passive digest. Each item is a compact one-liner (`ActionRow`): a headline + short sub-line + the PRIMARY action INLINE. Rules:
- **Lead with $** when a real amount exists (`total_cents`, `offered_price_cents`) — never fabricate an amount (inbound requests have no stored budget, so they lead with the service, not a fake $).
- **Green tone** = "your turn / needs your review" (provider Accept-post, consumer Rate & post). **Salmon** = dispute. Plain = neutral.
- **Priority order:** disputes → spotlight to review (provider) → rate & post (consumer) → pay-due ($) → new requests → offers to book.
- **Inline actions** reuse existing handlers: Accept post (`handleConfirmPost`), Rate & post (`setPostTarget`), Pay (`payForBooking`), View (`/inbound/:id`).
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

**No fake contacts** (SPEC-12): every path keeps only real `name||email||phone` rows; imported contacts get `dev:` ids and are sent real email/SMS invites. Native iOS/Android apps come later. qa.mjs #52 enforces this.

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

---

*Last updated: 2026-06-13 by Claude (Cowork session)*
