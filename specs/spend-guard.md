# No dollar without output

**CI subagent:** `spend-guard` · **priority** 5

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

ledger total matches the vendor account total within 5%

## Owned files

- `scripts/growth-controls.mjs`\n- `growth-controls.json`

## Guards

- #185\n- #189\n- #190\n- #207

## Open defects

- [ ] ledger was blind to 78% of spend once; reconciliation must keep proving itself

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_
