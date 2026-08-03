# SCOPE

Wave 2 of the founder-walk direct fixes (founder 2026-08-03: "I need to check NOW").
This merge also re-fires the whole 9-agent fleet immediately (push-to-main trigger).

1. **FW-11 fixed** — Reco tracking "Copy link" now shares the SERVICE's page, not the
   recommender's invite link (invite link only when the reco has no service listing).
2. **FW-6 annotated NEEDS-REPRO** — the default is already Paid in code (App.jsx
   useState(false)); the agent must find what actually flips it live before patching.

- `src/screens/RecoTrackingScreen.jsx`
- `agents/fleet.json`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
