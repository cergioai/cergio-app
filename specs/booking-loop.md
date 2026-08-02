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
