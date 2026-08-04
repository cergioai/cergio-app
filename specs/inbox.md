# Jobs inbox — one truthful card per event

**CI subagent:** `inbox` · split out of booking-loop 2026-08-03 (founder: "need to expedite my fixes... how can agents execute in parallel")

> This file is the SOURCE OF TRUTH for this area, not the code. Progress accumulates in
> FILES and git history, never in a model's context window.

## Green when

every inbox row maps 1:1 to a distinct live DB row, every row carries a timestamp, and the founder can find any request + its replies in one place

## Owned files

- `src/screens/JobsInboxScreen.jsx`

## Open defects

- [ ] FW-14 ROOT-CAUSED (2026-08-03, live DB probe): the x6 'pay to lock it in' rows were SIX REAL booking rows — incl. two exact double-tap duplicate pairs from the pre-SPEC-247 bug (server now blocks new ones; the two redundant twins 8dcb435f/b0e62600 were cancelled 2026-08-03). Residual: WATCH for new duplicate pairs (same consumer+service within 2 min, both unpaid) — any new pair means the server guard failed
- [ ] FW-15 FIXED IN CODE 2026-08-03 (response rows carry timeAgo) — verify live after deploy, then close
- [ ] FW-1: no clear place to see my existing requests and any replies (founder verbatim)

## Founder decisions on record

- 2026-08-03: "need to expedite my fixes... how can agents execute in parallel" — this
  agent exists so the founder-walk items are worked in PARALLEL, not queued behind one agent.
- Discipline inherited from FW-3: PROBE THE DB before changing a render — FW-3 looked like
  a render bug and was consistent data (the founder's own account owned the listing).

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_

- 2026-08-04 14:55Z — Anthropic credits RESTORED by founder; this commit exists to fire the fleet immediately (push trigger) instead of waiting for the hourly cron.

- 2026-08-04 15:20Z — CLAUDE_CODE_OAUTH_TOKEN secret ADDED by founder; this kick fires the first subscription-billed fleet run (SPEC-253).
