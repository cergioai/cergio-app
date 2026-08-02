# CI honesty

**CI subagent:** `ci-health` · **priority** 7

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

e2e is green and required, or deleted with the reason recorded — a permanently red advisory check is worse than no check

## Owned files

- `.github/workflows`

## Guards

- #209

## Open defects

- [ ] the e2e Playwright suite has been RED on main since roughly CI #11 and is advisory, so it never blocks a merge\n- [ ] 9 duplicate gate IDs baselined in qa-id-baseline.json

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_
