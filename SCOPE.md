# SCOPE

FW batch toward ALL GREEN (founder 2026-08-04: "need to see all green on all bugs to
recheck"). Three parallel investigations integrated + gated as one ship:

- FW-4 fixed (own-profile name from profiles.display_name)
- FW-7 fixed (reply context → 'Book · $X' CTA on the service page, SPEC-211 discipline)
- FW-1 fixed (Home 'Your requests & replies' entry + /inbox?tab=Requests deep-link)
- FW-10 fixed (Story-Highlight confirmation required when a post is submitted; SPEC-53 respected)
- FW-12 fixed ('reviewed' notify to the provider via notify-request; CI redeploys the fn)
- FW-6 resolved-as-design (SPEC-131 connector auto-flip + frozen 300-follower test threshold)
- FW-13 annotated: needs one founder sentence (3 readings documented)

- `src/screens/ProfileScreen.jsx`
- `src/screens/JobsInboxScreen.jsx`
- `src/screens/ResultsScreen.jsx`
- `src/screens/ServiceDetailScreen.jsx`
- `src/screens/HomeScreen.jsx`
- `src/components/ui/MarkBookingPostedModal.jsx`
- `src/lib/api.js`
- `supabase/functions/notify-request/index.ts`
- `agents/fleet.json`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — src/lib/api.js: exactly ONE existing line modified and it is a
JSDOC COMMENT (the fireBookingNotify action list gains 'reviewed'); every code change in
the shared file is a new export (notifyBookingReviewed). No caller behaviour changes.
