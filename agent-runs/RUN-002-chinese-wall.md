# RUN 002 · The Chinese wall (SPEC-195/196)

    branch    ship/chinese-wall-v2
    attempt   2 of 2   ← attempt 1 FAILED and is on the record below
    verdict   PASS (static). Live proof = the first PR this guard blocks.

## Criterion (founder, verbatim, 2026-08-01)
> "the only way to execute this is to GUARANTEE each part is COMPLETELY ISOLATED from
> the other... NOT JUST THEORY, ACTUALLY CHINESE WALLED"

## ATTEMPT 1 FAILED — and how
I made `deno check` a REQUIRED check across 42 edge functions that had never been
type-checked. Pre-existing errors then blocked every merge — including the wall's own
PR #218. The guard failed itself. That is a real mistake, not a technicality: a strict
new check on legacy code stops all work.

## ATTEMPT 2 — what changed
BASELINED. `deno-baseline.json` records every error that already exists; only a NEW one
fails the build. The baseline can only shrink — a fixed error is reported and removed.
This is the standard way to introduce a check to legacy code and it should have been
attempt 1.

## The two walls
1. `scripts/deno-guard.mjs` — type-checks all 42 edge functions. This is the ONLY thing
   that would have caught all SIX identifier-scope outages; every one passed
   `npm run build` because edge functions are Deno and Vite never sees them.
2. `scripts/scope-guard.mjs` — the diff must stay inside `SCOPE.md`. Shared files
   (`api.js`, `_shared/**`, `fulfill-crawl`) may only GROW; modifying an existing line
   needs `SHARED-CHANGE-APPROVED`, because it changes behaviour for every caller at once.

Both live in `build-and-qa`, the REQUIRED check. Advisory is how a 100%-red e2e suite
survived weeks of auto-shipping.

## Why CI and not an agent hook
Research finding: hooks DO NOT FIRE IN COWORK AT ALL (anthropics/claude-code#40495 —
three root causes prevent hooks loading in sandbox VMs), and subagent tool calls silently
drop hook blocks (#40580). An agent-side guard would have been theatre.

## Evidence
    node scripts/qa.mjs   196/196 pass, exit 0
    mutation #195         FAIL "the edge-function type-check is not in the REQUIRED job"
                          restored -> pass
