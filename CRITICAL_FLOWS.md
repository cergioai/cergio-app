# Cergio Critical Flows — Engineering Contract

This file is the **single source of truth** for what must always be
true about Cergio. Every code change must:

1. Declare which invariant(s) below it touches in the commit message.
2. Be verified against `scripts/qa.mjs` before push (run `Test
   Critical Flows.command`). All flows must remain GREEN.
3. Be reviewed by a sub-agent when it touches any flow file
   (see `REVIEWER_PROMPT.md`).

If a code change requires changing an invariant here, the invariant
change and the code change land in the **same commit**. Never one
without the other.

The 7 invariants below are ordered by user-trust impact — highest at
the top. A regression on #1 is brand-killing; a regression on #7 is
correctable.

---

## 1. AUTH never leaves the user in a no-session orphan state

**Why:** users who think they signed up but aren't actually signed in
get re-prompted at every gated action. They blame Cergio. They leave.

**Test (qa.mjs `signup_returns_session_or_needs_confirm`):**
- POST `/auth/v1/signup` with a fresh test email.
- Response either has `session.access_token` OR our wrapper returns
  `{ needsEmailConfirm: true }`.
- A `{ user: {…}, session: null, needsEmailConfirm: undefined }`
  response is a HARD FAIL.

**Failure mode to prevent:** prior bug — we navigated to `/home`
regardless of session, leaving `isSignedIn=false` everywhere. Submit
buttons re-prompted auth in a loop.

**Guard:** `useSession.signUp` auto-attempts `signInWithPassword`
when session is missing; returns `needsEmailConfirm` only when
Supabase says "Email not confirmed".

---

## 2. ADDRESS never reverts on save

**Why:** users typing a new address and watching it snap back to the
old one is the #1 trust-destroying moment. They spent hours on it.
We will never let it regress.

**Test (qa.mjs `address_save_persists`):**
- Set `auth.user.user_metadata.default_address` to address A.
- Update to address B.
- Re-read. Must equal B.
- Code-level: grep `src/screens/HomeScreen.jsx` for the
  `lastChatWhereSyncedRef` pattern — its absence is a HARD FAIL.

**Failure mode to prevent:** the `chat.state.where` sync useEffect
had `locationText` in its deps, so every manual save retriggered the
effect and snapped locationText back to the stale chat value.

**Guard:** ref-based last-synced tracker in the effect; locationText
deliberately NOT in the deps; only fires when chat-where actually
changes.

---

## 3. TITLE and SHARE message draw from the same source

**Why:** when the Results-page title says one thing ("Looking for
live-in nannys") and the share message says another ("deep
cleaning"), users think we're broken. We are, in fact, broken — two
different searches' state is leaking.

**Test (qa.mjs `title_share_same_source`):**
- Code-level: in `ResultsScreen.jsx`, `displayNoun` MUST list
  `userNoun` (originalQuery) BEFORE `safeProviderType`.
- The share-message `lead` MUST derive from `userQuery` (alias of
  originalQuery) — NOT from `chatState.what` or `chatState.provider_type`.

**Failure mode to prevent:** title used `safeProviderType ||
userNoun` while share used `userQuery || userNoun`. After a second
search overwrote `safeProviderType` but originalQuery was still
stale, the two surfaces diverged.

**Guard:** `userNoun || safeProviderType` order in `displayNoun`;
all user-visible language pulls from `originalQuery` via
`deriveDisplayNoun` in `lib/serviceNoun.js`.

---

## 4. NOTIFY-PROVIDERS never fires without a verified provider_type

**Why:** sending a "unclog my toilet" request to a Driver or Dog
Sitter because the resolver was unsure is the trust-shattering
failure mode the user named directly. Real people get pinged. We
will not blast.

**Test (qa.mjs `notify_safe_gate`):**
- Call `getProvidersForNotify({ notifySafe: false, … })` →
  MUST return `{ blocked: 'notify_safe_false…' }`.
- Call `getProvidersForNotify({ verifiedProviderType: '', notifySafe: true, … })` →
  MUST return `{ blocked: 'no_verified_provider_type…' }`.
- Call with `notifySafe: true` + valid type → returns only providers
  whose `taxonomy_provider_type` EXACTLY matches the verified type
  (case-insensitive equality, NO substring, NO stem).

**Failure mode to prevent:** any code path that does an `ilike`
fuzzy match or a stem search and uses the result to fan out
notifications.

**Guard:** `getProvidersForNotify` in `lib/api.js` is the only
sanctioned fanout helper. `notifySafe` computed in
`useChat.applyParseResult`: confidence ≥ 0.7 AND non-generic
provider_type AND word-overlap drift check.

---

## 5. INVITE URL always carries `?ref=<inviter_uuid>` (or no ref at all)

**Why:** without the ref, the entire referral economy fails silently.
Inviters share, friends sign up, no one gets paid. They lose
trust in the $250 promise.

**Test (qa.mjs `invite_url_format`):**
- `buildInviteUrl(uuid)` MUST match `^https?://[^/]+/\?ref=<uuid>$`.
- `buildInviteUrl(null)` MUST return a bare origin (no
  `?ref=invite` literal, no `?ref=` empty).
- Grep `src/` for the literal string `?invite?ref` (any match is a
  HARD FAIL — that's the old double-question-mark bug).

**Failure mode to prevent:** prior bug — `FindFriendsScreen` built
`${origin}/?invite${ref}` which produced `?invite?ref=<uuid>`. The
double `?` made `URLSearchParams` drop the ref. Every click silently
lost attribution.

**Guard:** every share path imports from `lib/referral.buildInviteUrl`.
Hand-rolled URL strings in screens are banned.

---

## 6. GEO-FILTER is strict — no nationwide spillover

**Why:** showing a NY user a Miami provider as a "match" wastes
their time and erodes confidence in the matching engine. Empty is
better than wrong.

**Test (qa.mjs `geo_strict`):**
- Call `listServices({ lat: 40.7, lng: -74.0, radiusMiles: 25 })`.
  All seeded Miami services lie outside this radius.
- Result MUST be `data: []`. Any service in the response is a HARD
  FAIL.

**Failure mode to prevent:** prior commit added a "nationwide
fallback" when proximity returned zero. User rejected it explicitly:
"NY users can't book Miami services" is the correct behavior.

**Guard:** `listServices` proximity branch returns `data: []` when
the RPC returns zero — no fall-through to the plain branch.

---

## 7. NO "coming soon" placeholders on monetized or notification paths

**Why:** every dead button is a moment where the user thought
Cergio worked and it didn't. On surfaces that touch money or
notifications, a placeholder is worse than not shipping the feature.

**Test (qa.mjs `no_coming_soon_on_critical_paths`):**
- Grep these files for `coming soon`:
  - `src/screens/ResultsScreen.jsx`
  - `src/screens/InviteFriendPopupScreen.jsx`
  - `src/screens/EarningsScreen.jsx`
  - `src/screens/ConfirmSubmitScreen.jsx`
  - `src/screens/ServiceDetailProviderScreen.jsx`
- Any match in those files is a HARD FAIL. `coming soon` is fine
  on truly future-stage surfaces (Profile / About sections), but
  banned on monetization and notification paths.

**Failure mode to prevent:** prior bug — Results header share
button was a `showToast('Share coming soon!')` for weeks. Users
saw a share button, tapped it, nothing happened. Trust eroded.

**Guard:** real actions only on the listed files. Use Web Share
API + clipboard fallback for share, real DB writes for
delete/unlist/etc.

---

## 8. "Invite link copied" toasts MUST actually copy

**Why:** a toast that says "Copied!" without writing to the clipboard
is the loudest possible lie. Users tap, walk to a chat, and paste
nothing. Trust erodes instantly.

**Test (qa.mjs `copy-is-real`):**
- Scan every `showToast(...'copied'...)` call in `src/`.
- The 400 chars BEFORE the toast must contain one of:
  - `navigator.clipboard.writeText(...)`
  - `navigator.share(...)`
  - `navigate(...)` (routes to a screen that handles the copy itself)
  - `copyInvite()` / `copyLink()` (a helper that wraps writeText)
- Any toast without one of those backing actions is a HARD FAIL.

**Failure mode to prevent:** `RainmakersScreen` and `ServiceListVerify`
both said *"Invite link copied!"* with no clipboard write in the
handler. Users tapped, got a green checkmark, pasted nothing.

**Guard:** all copy actions funnel through `copyInvite()` /
`copyLink()` helpers that ALWAYS call `clipboard.writeText` first.
The toast fires AFTER the write resolves.

---

## 9. Every notifyUser() call MUST embed `data.deep_link`

**Why:** notifications without a tracked URL break the referral
economy silently. Friend gets an email, lands on Cergio with no
`?ref`, signs up, books — and the inviter earns nothing. They lose
trust in the $250 promise.

**Test (qa.mjs `notify-has-deeplink`):**
- Find every `notifyUser(` call site (excluding the function
  definition in `lib/api.js`).
- The 1000-char body following the open paren MUST contain the
  string `deep_link`.
- Any missing reference is a HARD FAIL.

**Failure mode to prevent:** `RecommendServiceFormScreen` was sending
notifications with `deep_link: window.location.origin` (no `?ref`),
which silently dropped every invitee's attribution.

**Guard:** `deep_link: buildInviteUrl(auth.user.id)` on every
notifyUser call. The helper produces `${origin}/?ref=<uuid>`.

---

## 10. SERVICE_MAP values are concrete services, not bundles

**Why:** the local parser fallback runs in the browser and feeds
chat state. If it maps a single-service request to a
"bundle"/"coordinator"/"package" phrase, the UI ends up echoing
that phrase back to the user as their "what". That bug shipped
once and was the genesis of the parser-drift guard work.

**Test (qa.mjs `service-map-no-bundles`):**
- Parse the `SERVICE_MAP` literal in `src/hooks/useChat.js`.
- Each `['phrase', 'Display']` pair must have a `Display` value
  that does NOT contain `bundle`, `coordinator`, or `package`
  (case insensitive). Any violation is a HARD FAIL.

**Failure mode to prevent:** prior bug — `['wedding', 'Wedding
Bundle']` echoed back as "Looking for Wedding Bundles" on Results.
Same family as the "Spanish-speaking babysitter → Bundle
coordinator" cloud-parser bug.

**Guard:** the test enforces clean display strings forever. Server
taxonomy can still ROUTE to a wedding-bundle offering ID internally
— the gate is on what the user SEES.

---

## 11. BOOKING confirmation never fabricates mock data

**Why:** a user paying real money for a Cleaning by provider X seeing a
post-booking screen that says "Deep Cleaning · Jamie Hall · Tuesday
2:00 PM · 123 Main St" is the same family of brand-killing lie as
the title/share-message divergence (#3). Worse — money already
moved, so trust is being destroyed at the exact moment Cergio's
promise was supposed to be cashed in.

**Test (qa.mjs `booking-no-mock-defaults`):**
- Read `src/screens/BookingScreen.jsx` (with comments stripped).
- Assert it contains NONE of the legacy mock literals: `Jamie Hall`,
  `Deep Cleaning`, `Tuesday 2:00 PM`, `123 Main St`.
- Assert the destructure from `booking` has NO string-literal
  defaults — `name = 'Jamie Hall'` would re-introduce the bug.

**Failure mode to prevent:** prior bug — `setBooking({ name, price })`
in App.handleBook only set two fields; BookingScreen filled the
rest with hard-coded mock strings. Any user without a chat-state
`what`/`when`/`where` (e.g. arrived via My Requests rebooking) saw
the mock data render as if it were their booking.

**Guard:** `App.handleBook` enriches `setBooking({ name, price,
service, when, where })` from the live chat state. BookingScreen
renders rows ONLY when their real value is present (`.filter(Boolean)`
drops empty rows). Empty card collapses entirely rather than
showing placeholder text.

---

## 12. NO mock-data imports leaking into signed-in render paths

**Why:** The "Friends recently booked" feed on ActivityScreen was
removed once (project task #9) and silently regressed back into the
file — real signed-in users saw "Stephanie K. booked Jamie Hall —
Deep Cleaning" as if it were their actual friends. Same family as
the BookingScreen mock-defaults bug (#11) and the title/share-message
divergence (#3). The user has said multiple times: "we can't blast
fake data or porno or non genuine content".

**Test (qa.mjs `no-mock-on-signed-in-paths`):**
- For each file in `src/screens/`, find imports of the form
  `import { … } from '../data/mock'`.
- For each imported symbol in `[FEED, NETWORK_EARNINGS, TRANSACTIONS,
  BREAKDOWN]`, assert one of:
  - The file is in `src/screens-legacy/` (allowed).
  - The symbol is referenced AND the file gates it behind
    `!auth?.isSignedIn`, `!isSignedIn`, `usingMock`, or `useMock`.
- Zombie imports (imported but never used) are also a HARD FAIL —
  they're re-grow risk.

**Failure mode to prevent:** anyone editing a screen and pasting an
import-of-convenience from `../data/mock` to flesh out a section,
then forgetting to remove it. Within weeks the section grows back
and real users see fake data.

**Guard:** sign-out preview mocks must use the established gating
variables (`usingMock` on CalendarScreen, `useMock` on
ManageServicesScreen). Any signed-in render path that needs feed
data fetches from the real API + ships a clean empty state.

---

## 13. SEARCH must be honest about WHY results are empty

The 2026-05-27 bug, plain text. `freeServices` defaults to `true` at
App level (Connector premise — every search filters to $0 offerings).
Seeded providers carry no $0 offerings, so `listServices({ freeOnly:
true })` returns `[]` for almost every category. The empty state
then lied: "No plumbers yet" while a Plumber sat 6 miles away.

Two days were spent chasing the wrong layer. The root cause was the
free-toggle default + a hard `freeOnly` filter, NOT the parser, NOT
the proximity RPC, NOT the strict taxonomy match. Free was a
preference being treated as inventory truth.

**Rules**

1. When `listServices` returns `[]` AND the call was made with
   `freeOnly: true`, ResultsScreen MUST re-query with `freeOnly:
   false` automatically. If THAT returns rows, render them with the
   soft banner:

   > "No free {plural} nearby right now — showing paid options.
   > Free offers come from Connectors. Ask a friend to join, or
   > pick a paid option below."

   No exceptions. The user is owed a real answer, not a dead-end.

2. Title MUST use the canonical provider_type (singular for
   "Showing 1 plumber", plural for "Looking for plumbers"). Never
   `${userNoun}s` when a provider_type resolved — that produces
   gibberish like "Showing 1 unclog my toilet".

3. ResultsScreen MUST `await import('../lib/api')` inside the search
   effect. The static `import { listServices } from '../lib/api'`
   binding survives Vite HMR; after any api.js edit, the running
   ResultsScreen keeps calling the OLD closure. This is the bug that
   makes a "fixed" api.js look broken in the UI for hours.

**Guards**

- qa.mjs #15 — re-query without freeOnly when first call returns 0
- qa.mjs #16 — title uses canonical type, not user verb-phrase
- qa.mjs #17 — dynamic-import api.js inside the search effect
- `Test Search.command` — runtime free-vs-paid coverage report per
  provider_type. Categories with `free=0 / total>0` rely on the
  paid-fallback. If you ever remove rule 1 above, those categories
  go silently empty.

---

## 14. ADDRESS persistence is bulletproof via `user_metadata` FIRST

The 2026-05-26 PERMANENT FIX (task #103). saveAddress was writing to
a `user_addresses` table that didn't always exist post-migration, and
addresses silently reverted across sessions. The only path that can't
fail is `supabase.auth.updateUser({ data: { default_address: ... }
})` — `user_metadata` always exists on `auth.users`. The table write
is best-effort thereafter.

**Rule:** `saveAddress` MUST update `user_metadata.default_address`
BEFORE attempting any table write. If the metadata write fails, log
and continue — the chip/localStorage path keeps the UI sane. If it
succeeds, the rest of the function is gravy.

**Guard:** qa.mjs #19.

---

## 15. SIGNUP never strands the user without a session OR a clear next step

The 2026-05-25 race (task #102). User filled the form, hit Sign Up,
supabase returned `data.user` but `data.session === null`. App
redirected. Next screen demanded sign-in. User was stuck.

**Rule:** `useSession.signUp` MUST, after `supabase.auth.signUp`
returns no session, immediately call `signInWithPassword` with the
same credentials. If that returns a session, we're done. If it
returns "Email not confirmed" (or similar), surface
`needsEmailConfirm: true` so the UI shows the right next step.

There is no third state. Either the user has a session, or they
have a clear "check your email" message.

**Guard:** qa.mjs #20.

---

## 16. ADDRESSES are Google-verified before save

Task #85. Free-typed strings without lat/lng silently saved and
produced zero-result searches because proximity needs coords. Every
saved address MUST be canonicalized through Google
(`verifyAddress(...)`) and carry `placeId` for cross-session dedup.

**Rule:** HomeScreen MUST call `verifyAddress` on any manually-typed
address before persisting it, and MUST pass `placeId` to
`saveAddress`. Autocomplete-selected places already include
`placeId` from the Google widget; manual typed strings must be
verified explicitly.

**Guard:** qa.mjs #21.

---

## 17. NO "Cergio Coin" / "Cergio Cash" in signed-in copy

Task #78. These terms were retired in favor of plain "$250", "free
services", and "Growth Income". They CAN still appear inside
`src/data/mock.js` (sign-out preview data, gated by `usingMock`) and
in `/* … */ // …` comments documenting the retirement. Anywhere
else is a regression.

**Rule:** No file under `src/` (except `src/data/mock.js`) may
include the substrings "Cergio Coin" or "Cergio Cash" outside of
code comments.

**Guard:** qa.mjs #22.

---

## 18. BUILD VERSION pill is always visible

Observability. Renders the current short git SHA in a low-contrast
badge at the bottom-left of every screen. Was the single missing
piece during the 2026-05-27 2-day debug — HMR mounted a stale
ResultsScreen for hours and there was no way to tell from the UI.

**Rule:** `App.jsx` MUST render `<BuildVersionPill />` everywhere,
and `vite.config.js` MUST inject `__CERGIO_BUILD_SHA__` via
`define{}` so the pill shows the real SHA.

**Guard:** qa.mjs #18.

---

## 19. PROFILE has no dead links

The Profile screen is the spine of the app — every signed-in user
ends up here. Broken navigations look amateur and erode trust. Every
`navigate('/...')` inside `ProfileScreen.jsx` must resolve to a path
that `App.jsx` registers as a Route.

**Rule:** before committing changes to either ProfileScreen.jsx or
App.jsx routes, qa.mjs #23 must pass. Adding a new Profile row?
Register the route first.

**Guard:** qa.mjs #23.

---

## 20. REWARD amounts read from REWARDS constants only

Bugs we've already hit: "$250" said one place, "$200" another;
"credit" some screens, "cash" elsewhere. Single source of truth is
`src/lib/rewards.js` → `REWARDS.perFriend` /
`REWARDS.perFriendUser` / `REWARDS.perFriendConnector` /
`REWARDS.milestoneBonus` / etc.

**Rule:** No user-facing string under `src/` (except
`src/lib/rewards.js` and `src/data/mock.js`) may hardcode "$200" or
"$2NN" within 40 characters of a reward-context word
(credit/cash/friend/connector/reward/earn/invite). Always import
from `lib/rewards`.

**Guard:** qa.mjs #24.

---

## 21. CONNECTOR apply page has the full conversion story

`RainmakerApplyScreen` is the conversion-driver. Strip any of the
three core sections and signups collapse:

1. Side-by-side User vs Connector benefits (grid-cols-2)
2. Compounding example ("50 friends → $12,500")
3. "I am a…" type selector (Influencer / Local biz / Super user)

Plus mention Growth Participation Income as part of the reward stack.

**Rule:** all four must remain on the screen.

**Guard:** qa.mjs #25.

---

## How to update this file

1. **Adding a new invariant.** Append it to the bottom. Update
   `scripts/qa.mjs` to add a test. The commit message must say
   `Added invariant #N: <name>`.

2. **Loosening an invariant.** Requires a written justification in
   the commit message — what trade-off and why. Update the test to
   match. Get a reviewer sub-agent sign-off (run
   `Spawn Reviewer.command`).

3. **Removing an invariant.** Don't. If you really mean it, archive
   it at the bottom of this file under `## Retired invariants` with
   the date and the reason. Keep the test active for one release
   before deleting.

4. **Rephrasing.** Free.

## Reviewer protocol

Before any commit that touches a file referenced by an invariant:

1. Run `Test Critical Flows.command`. All flows must be GREEN.
2. Spawn the reviewer sub-agent (`REVIEWER_PROMPT.md`) with the
   diff. Address every flagged concern OR document why the concern
   is wrong in the commit message.
3. Commit message format:
   ```
   <subject>
   
   <body>
   
   Verified: #N, #M (per CRITICAL_FLOWS.md)
   qa.mjs: pass (7/7)
   ```
