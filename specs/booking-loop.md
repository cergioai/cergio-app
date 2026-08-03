# Request -> accept -> schedule -> complete

**CI subagent:** `booking-loop` · **priority** 2

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

a live walk completes the loop with two real accounts

## Owned files

- `src/screens/RequestScreen.jsx`\n- `src/screens/InboundRequestScreen.jsx`\n- `src/lib/api.js`

## Guards

- #154\n- #48\n- #47i

## Open defects

- [ ] core loop is auth-gated so it has only ever been verified in code, never walked live

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_

## Founder decisions on record — TESTING PLAN walk, 2026-08-02 (verbatim)

- "Add place to see existing requests and any replies..."
- "Says Tarik Accepted (but babysitter is Tom... tarik is the user who submitted..)"
- "Looking at your own profile doesn't show your name... looking at babysitter profile shows the name of the person who submitted the request"
- "don't remember this request that I'm seeing on tarik.sansal2 (from t@cergio) ... fired an old request by itself..."
- "1-The default search toggle needs to be Paid Services (not free) since I'm not a connector"
- "When viewing a reply to book, and seeing profile of the service, need to showcase the booking button with the price (from the counter).. not the generic request to book on profile.."
- "post story highlight should be mandatory not optional.... copy link should take to profile of the service not the recommender..."
- "tarik.sansal2@gmail.com didn't get notified that t@cergio submitted IG review and post.. need a notification to review and approve"
- "wrong form / screens here https://cergio.ai/services/manage"
- "duplicated notifications and jobs..." · "time stamp missing..."

## Run order (founder walk FW items — work worst-first)

1. **FW-3 wrong-party accept banner** — two-account repro FIRST: read the actual
   request_responses.responder_id + bookings.provider_id rows for the walked request
   before touching render code. If the DB rows are right, the bug is the join/render;
   if wrong, the bug is in an accept path writing the wrong responder.
2. **FW-14 duplicate inbox rows** — same booking as two 'pay to lock it in' items
   one minute apart; dedupe on booking id.
3. **FW-5 ghost re-fired request** — find every notify path that can re-announce an
   old request; each needs a sent-once guard.
4. **FW-7 counter price on service profile CTA** · **FW-15 timestamps** · **FW-4 profile
   names** · **FW-2 time-required intake** · **FW-6 default toggle** · **FW-1 requests
   surface** · **FW-13 /services/manage** · **FW-10/11/12 IG verify flow**.

Anything needing a founder value (copy, price display format) is REFUSED, not guessed.
