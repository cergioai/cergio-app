# SCOPE

Founder decisions of 2026-08-02 ("1. ok — 2. desecuritize" on the night-fleet run-1
findings), shipped as two commits on one branch:

1. **De-securitise** `/rainmaker/apply` + `/about` (the r150 staged patch, founder-approved
   verbatim, plus the night-fleet legal-copy agent's /about APGI finding) and teach gate
   #170 the paraphrases so they can never silently return.
2. **SPEC-247** — harden `accept_request_with_time` server-side (self-accept block +
   server-side SPEC-128 idempotency) per the booking-loop agent's finding, with gate #246
   replaying migration history for the FINAL definition.

- `src/screens/RainmakerApplyScreen.jsx`
- `src/screens/AboutScreen.jsx`
- `src/lib/rewards.js`
- `scripts/qa.mjs`
- `supabase/migrations/20260803020000_harden_accept_request_with_time.sql`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

qa.mjs changes in this branch are PURELY ADDITIVE (31 insertions, 0 deletions — verified
with `git diff --numstat`): new banned regexes inside gate #170, a presence assertion
appended to #170, and the new #243 test appended before main(). No existing line modified.
