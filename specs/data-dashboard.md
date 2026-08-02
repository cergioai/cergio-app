# /ops/data — every dataset live + downloadable

**CI subagent:** `data-dashboard` · **priority** 6

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

the screen total equals a direct count for the same filter

## Owned files

- `src/screens/DataExportScreen.jsx`\n- `supabase/functions/leads-dashboard/index.ts`

## Guards

- #203\n- #210

## Open defects

- [ ] screen counts have never been reconciled against a direct REST count

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_
