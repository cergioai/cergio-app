# /ops/data — every dataset live + downloadable

**agent** `data-dashboard` · **priority** 6 · **NEEDS WORK** · 2026-08-21T13:38:33.127Z

> **Green when:** the screen total equals a direct count for the same filter

## Its gates

| gate | state |
|---|---|
| #203 | pass |
| #210 | pass |

Whole suite: 268 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 532 of 542 repo files.

## Open defects it is accountable for

- screen counts have never been reconciled against a direct REST count

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
