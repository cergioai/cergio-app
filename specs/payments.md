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
