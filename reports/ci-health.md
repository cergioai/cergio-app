# CI honesty

**agent** `ci-health` · **priority** 7 · **NEEDS WORK** · 2026-08-02T04:13:02.725Z

> **Green when:** e2e is green and required, or deleted with the reason recorded — a permanently red advisory check is worse than no check

## Its gates

| gate | state |
|---|---|
| #209 | pass |

Whole suite: 207 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 405 of 421 repo files.

## Open defects it is accountable for

- the e2e Playwright suite has been RED on main since roughly CI #11 and is advisory, so it never blocks a merge
- 9 duplicate gate IDs baselined in qa-id-baseline.json

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
