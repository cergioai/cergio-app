# SCOPE

Two founder items, shipped together. Gates #279.

FW-24 (live repro 2026-08-08): a confirmed booking time must READ as confirmed.
The requester's inbox never joined bookings, so a booked job still offered
"book a time" (a second tap minted a DUPLICATE booking), the only viewable
surface was the service profile, and the free-barter gate demanded an IG post
for a job that had not happened.

SPEC-279 / FW-25: THE OPEN BOARD. Open requests and barter opt-ins publish to
one browsable feed (requests.kind job|optin), filterable by type and scoped to
the viewer's location. ACCEPT writes an OFFER, never a booking — the founder
was explicit that the booking is not confirmed until the user actually books.

- `src/App.jsx`
- `src/screens/JobsInboxScreen.jsx`
- `src/screens/JobDetailsScreen.jsx`
- `src/screens/OpenBoardScreen.jsx`
- `src/screens/BarterJoinScreen.jsx`
- `src/screens/AuthScreen.jsx`
- `src/screens/HomeScreen.jsx`
- `supabase/migrations/20260808160000_open_board.sql`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — `src/lib/api.js`: FW-24 requires
listMyRequestsWithResponses to attach each response's live booking, which turns
its single `return` statement into a shaped local plus a bookings read before
returning. There is no additive form of "the existing reader now returns the
missing field" — a new parallel export would leave the OLD path (the one every
inbox already calls) still blind, which IS the defect. Everything else in this
change is additive: new exports (findActiveBookingFor, listOpenBoard,
postFlexibleOptIn, listOwnerServices, acceptOpenJob, suggestServiceOnOptIn,
milesBetween) and two new DEFAULTED params on createRequestAndFanOut (kind,
posterRole) whose defaults reproduce the exact row every existing caller wrote
before. No existing caller's contract changes.

qa.mjs change is purely additive (gates #279 appended before main()).
