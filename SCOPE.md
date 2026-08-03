# SCOPE

Founder, 2026-08-03: "need to expedite my fixes... how can agents execute in parallel."
One branch, two commits:

1. **FW-15 fixed** — response rows in the Jobs inbox carry the compact timestamp.
2. **Fleet parallelized** — booking-loop's founder-walk load split across three NEW
   subagents (inbox / profile-ux / ig-verify), matrix 9 → 12, cadence 3h → HOURLY.
   FW-3 and FW-14 annotated with their live DB-probe verdicts so no agent chases a
   ghost (FW-3 = consistent data; FW-14 = real historical duplicate rows, twins
   cancelled, server guard live).

- `src/screens/JobsInboxScreen.jsx`
- `agents/fleet.json`
- `.github/workflows/night-fleet.yml`
- `specs/inbox.md`
- `specs/profile-ux.md`
- `specs/ig-verify.md`
- `specs/booking-loop.md`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
