# Cergio Roadmap — Real Product Gaps

This file tracks **real product gaps** — features that are intentionally not
shipped yet. The point of having it is that we'd rather remove a button
that doesn't work than ship a "coming soon" toast. Anything listed here
should NOT exist as a placeholder in the UI; the UI should either omit
the affordance or do a real-but-narrower action (mailto, navigate to
inbox, etc.) until the full feature lands.

Each entry has the same shape:

- **What:** the feature
- **Why it's gated:** why we haven't shipped it yet
- **Current UX:** what the user sees today instead
- **Ship criteria:** what needs to be true to call it done
- **Owner:** who's driving it (default: Tarik)

---

## 1. Provider payouts via Stripe Connect

- **What:** "Cash out" button on EarningsScreen actually transfers the
  cleared balance to the user's verified Stripe Connect account.
- **Why it's gated:** Connect account onboarding (KYC, 1099 reporting,
  tax form collection) needs Stripe live keys and a tested
  end-to-end flow. Live keys aren't enabled yet.
- **Current UX:** When `balanceCents ≥ $250`, the Cash out button is a
  `mailto:support@cergio.ai` with a pre-filled subject + body
  containing the user's balance, email, and UUID. We process the
  request manually until Connect ships. No "coming soon" toast.
- **Ship criteria:**
  - Stripe live keys enabled in production env.
  - Connect onboarding screen for providers (handles platform fee +
    tax info).
  - Webhook for `payout.paid` updates ledger `kind:'payout'` row.
  - qa.mjs test: balance reduces by payout amount after webhook.
  - Replace the mailto with a real "Initiate payout" call.
- **Owner:** Tarik

---

## 2. Google People API contacts import

- **What:** "Sync Google contacts" affordance on FindFriendsScreen
  that pulls in the user's Google contacts (with consent) for
  per-contact invite suggestions.
- **Why it's gated:** Requires OAuth scope `contacts.readonly`,
  publishing-status review by Google, and a hosted token-exchange
  endpoint. The Web Contact Picker API (already wired in
  `syncPhoneContacts`) covers most users on supported browsers
  without OAuth, so this isn't the critical path.
- **Current UX:** The "Sync Google contacts" row has been removed.
  Users can use "Sync phone contacts" (Web Contact Picker) or the
  manual "Find by handle" search. Share-to-IG / Share-to-TikTok
  remain available with real `navigator.clipboard.writeText`.
- **Ship criteria:**
  - Google Cloud OAuth client with `contacts.readonly` scope
    approved.
  - Token exchange route on Supabase Edge Function.
  - Restore the row + handler that calls the People API.
  - qa.mjs test: contacts handler doesn't toast "coming soon"; it
    either renders contact list or surfaces a real error.
- **Owner:** Tarik

---

## 3. Inbox filters

- **What:** Filter chips (Status, All / Unread, etc.) on the
  RecoNotificationScreen / Connector requests inbox.
- **Why it's gated:** Inbox volume is too low pre-launch to design
  meaningful filters. Premature filtering would just compound the
  empty-state problem.
- **Current UX:** Filter chips removed. The page now points users
  directly at `/inbox` (Jobs Inbox) which already has a working
  search filter.
- **Ship criteria:**
  - Inbox volume per-user routinely exceeds ~20 items so filtering
    saves time.
  - Filter chips read from a real predicate on the query, not a
    `showToast`.
- **Owner:** Tarik

---

## 4. Booking-time availability gate

- **What:** When a customer attempts to book a provider, the booking
  endpoint reads the provider's `auth.user.user_metadata.availability`
  map for that date and blocks the booking if `status !== 'available'`.
- **Why it's gated:** Real persistence ships in this commit
  (AvailabilityScreen now writes to user_metadata + localStorage
  fallback), but no booking path currently READS that data.
- **Current UX:** Provider's choice IS saved to their account.
  The save button no longer lies ("Saved — full scheduling lands
  soon"). A subline under the button explains they still need to
  manually decline requests on blocked dates until the booking
  gate ships.
- **Ship criteria:**
  - Booking creation path (handleBook on ResultsScreen + any
    Spotlight payment path) reads provider availability before
    confirming.
  - "Provider is unavailable on that date" surfaced as a real
    error blocking the booking.
  - qa.mjs invariant: booking flow must consult availability
    map before charging.
- **Owner:** Tarik

---

## 5. Per-invite tracker view (`/earnings/track`)

- **What:** A dedicated screen showing each invited friend / reco'd
  service as a row, with their booking status and the resulting
  earnings credit. Friends-on / Services-on toggles to focus the
  feed. Pre-existing UI shell is in `TrackInvitesScreen.jsx`.
- **Why it's gated:** Existing screen reads from `NETWORK_EARNINGS`
  mock + `BREAKDOWN` hard-coded numbers. Shipping it would show
  fake "+$141.52" rows to a real user with $0 earned.
- **Current UX:** `/earnings/track` redirects to `/earnings`,
  which already lists real invite-kind earnings rows. The
  EarningsBreakdownScreen link is relabeled "See invite earnings ›"
  to match the destination.
- **Ship criteria:**
  - Add `listMyInvites()` to `lib/api.js` joining `invites` →
    `bookings` → `earnings` for the inviter view.
  - Rewrite TrackInvitesScreen to consume the real data, with a
    proper empty state when count = 0.
  - Restore the route to point at the screen (remove the redirect).
  - qa.mjs: assert NETWORK_EARNINGS / BREAKDOWN imports are gone
    from TrackInvitesScreen.jsx.
- **Owner:** Tarik

---

## 6. Account-delete edge function

- **What:** "Delete my Cergio account" button on DataDeletionScreen
  fires an edge function that hard-deletes `auth.users` and
  cascades to `profiles`, `services`, `bookings`, etc. Signs the
  user out. Required for Meta App Review (Instagram OAuth).
- **Why it's gated:** edge function not built yet.
- **Current UX:** Button opens a pre-filled `mailto:privacy@cergio.ai`
  with the user's email + user ID. Privacy email is also copied to
  the clipboard as a backup. Body of OVERNIGHT_STATUS / docs says
  we process deletions manually within 30 days, which is true.
- **Ship criteria:**
  - Supabase Edge Function: `delete-account` with service-role key.
  - Cascades on `profiles`, `services`, `bookings`, `network`,
    `invites`, `earnings`, `messages`, `notifications`, `auth.users`.
  - Replace mailto with `await deleteMyAccount()` + redirect to
    SplashScreen.
  - qa.mjs: assert DataDeletionScreen doesn't render a stub toast
    without a real edge-function call.
- **Owner:** Tarik

---

## 7. Instagram OAuth sign-in

- **What:** "Continue with Instagram" on AuthScreen — full OAuth
  via Meta for Developers.
- **Why it's gated:** Meta app review process; Instagram Tester
  role still needs to be added for the `tarikromio` account on the
  Cergio app.
- **Current UX:** AuthScreen renders the Instagram button but the
  handler toasts a clear next step: "Instagram sign-in is coming
  soon — use email or Google for now." This one is honest about
  the gap and gives the user an immediate path; we keep it as the
  single allowlisted "coming soon" outside the critical-paths
  invariant.
- **Ship criteria:**
  - Meta app in Live mode (post-review).
  - Supabase Instagram provider configured with client id/secret.
  - Replace the toast with a real `supabase.auth.signInWithOAuth({
    provider: 'instagram' })`.
- **Owner:** Tarik

---

## How to update this file

When you ship one of the gaps:

1. Remove the section from this file.
2. Wire the real action in the UI.
3. Update the corresponding qa.mjs invariant if needed.
4. Commit message: `Shipped roadmap item: <title>` plus the usual
   `Verified: #N` line.

When you discover a new gap during a sweep:

1. Add a new section here with all five fields.
2. Either remove the placeholder UI or replace it with a real
   narrower action.
3. Reference this file from the code with a `CERGIO-GUARD` comment.
