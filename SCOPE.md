# SCOPE

FW-24 (founder live repro 2026-08-08): a confirmed booking time must READ as
confirmed. The requester's inbox never joined bookings, so a booked job still
offered "book a time" (a second tap minted a DUPLICATE booking), the only
viewable surface was the service profile, and the free-barter gate demanded an
IG post for a job that had not happened. Gate #278.

- `src/App.jsx`
- `src/screens/JobsInboxScreen.jsx`
- `src/screens/JobDetailsScreen.jsx`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — `src/lib/api.js`: listMyRequestsWithResponses must
attach each response's live booking, which means its single `return` statement
becomes a shaped local plus a bookings read before returning. There is no
additive form of "the existing reader now returns the missing field" — a new
parallel export would leave the OLD path (the one every inbox already calls)
still blind, which is the defect. The only other change is the NEW export
findActiveBookingFor. No existing caller's contract changes: responses gain a
`booking` key and lose nothing.

qa.mjs change is purely additive (gate #278 appended before main()).
