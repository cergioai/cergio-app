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
2. Bookings (free AND demo-mode paid) stay **pending** until the provider accepts — never auto-confirm on submission.
3. After a FREE job, the Connector posts an IG spotlight (`markBookingPosted` → post_url + posted_at), it surfaces on the activity feed (kind `barter`), and the provider must **accept** (`confirmBookingPost` → post_confirmed_at + status completed) or **flag** (`flagBookingPost`).
4. **THE GATE:** a Connector with an accepted free booking whose post is not yet confirmed cannot order another free service (`getOutstandingFreeBarter` checked in `handleBook` before any free booking).

**Banned behaviors:**
- Auto-confirming a booking at submission time
- Creating a free booking without consulting `getOutstandingFreeBarter`
- Releasing the gate on `posted_at` alone (provider must CONFIRM)

qa.mjs #47 enforces this.

---

## UI / DATA — PROVIDER REQUEST SCREEN (ACCEPTING A FREE SERVICE)

### SPEC-48 · Inbound request screen required elements
**Status:** FROZEN — 2026-06-13 (Tarik dictated as SPEC; flow board "Accepting Free Service request")
**Rule:** `RequestDetailScreen` (the screen the service provider sees for an inbound request from a Connector) must render, for a free request:
1. **Job details** — service title, free-for-Connectors pill, description, appointment.
2. **Approximate-location card** — copy "Map shows approximate location"; the exact address is shared ONLY after the user confirms the booking. No live map tile and no precise pin until confirmed.
3. **Instagram block** — the requester's IG handle + follower count + a working "See Instagram" link to `instagram.com/<handle>`. Hidden when the requester has no connected handle.
4. **Friends-in-common** — mutual connections with the requester via `getMutualConnections` over the `network` graph (any edge, either direction; buckets friends + Connectors). Hidden when zero.
5. **Accept CTA** — "Accept free request" + the "free marketing / service verification with a 4+ star rating" subcopy.

**Banned behaviors:**
- Faking the IG photo grid. The "+N more" thumbnail strip renders ONLY from real `data.igMedia` (populated once Meta Graph media access is approved). Hardcoded placeholder thumbnails are banned (SPEC-12).
- Synthesizing follower counts, mutual-connection counts, or names not present in the DB.
- Revealing the exact job address before `status` is confirmed.

qa.mjs #48 enforces this.

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
