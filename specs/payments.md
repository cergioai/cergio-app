# Payment on accept — THE LAUNCH BLOCKER

**CI subagent:** `payments` · **priority** 1

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

one real booking reaches paid_at with a Stripe charge id

## Owned files

- `src/screens/PayScreen.jsx`\n- `src/lib/payments.js`\n- `supabase/functions/create-payment-intent`\n- `supabase/functions/stripe-webhook`

## Guards

- #47g\n- #155b

## Open defects

- [ ] bookings_paid has been 0 for the life of the project — no card has ever been charged end to end\n- [ ] counter-offer price shown vs charged (SPEC-211/212 shipped; needs live proof)

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_

## Founder decisions on record — TESTING PLAN walk, 2026-08-02 (verbatim)

- "enable card payments to pay with stripe ... or enable testing with dummy card with stripe... need to test book ..."
- "user needs to pay when accepting a counter offer ... so their card is charged automatically... to eliminate the additional 'pay step'... (funds kept until job done.. per spec release)"

FW-8 unblocks the walk (test-mode/dummy card); FW-9 IS this agent's green_when — the
pay-fix cell (11 files, 377 hidden) is the prepared workspace for it.
