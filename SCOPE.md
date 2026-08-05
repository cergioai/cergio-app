# SCOPE

FW final code batch (founder 2026-08-05: "need all bugs closed now to check"):

- FW-2 fixed — intake time-question enforced (asap/flexible valid; same copy re-asks)
- FW-5 fixed — server-side send-once notify ledger (new migration 20260805100000)
- FW-13 fixed — inline field editing replaces window.prompt per the founder's recorded
  no-browser-popup rule (CrossPostScreen popup noted as follow-up)

- `src/hooks/useChat.js`
- `src/screens/ServiceDetailProviderScreen.jsx`
- `supabase/functions/notify-request/index.ts`
- `supabase/migrations/20260805100000_fw5_request_notify_ledger.sql`
- `agents/fleet.json`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
