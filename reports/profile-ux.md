# Profiles + service pages say WHO they are

**agent** `profile-ux` · **priority** 3 · **NEEDS WORK** · 2026-08-21T13:38:36.921Z

> **Green when:** every profile surface names its owner correctly and a countered price follows the user onto the service page

## Its gates

| gate | state |
|---|---|
| #211 | pass |

Whole suite: 268 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 532 of 542 repo files.

## Open defects it is accountable for

- FW-4 FIXED IN CODE 2026-08-04: own-profile name now sources profiles.display_name first (auth metadata / email local-part as fallbacks) — the screen read only auth user_metadata, which is unset for accounts whose name lives in the profiles row. The 'provider profile shows requester name' half was already proven DATA-CONSISTENT. Verify live, then close.
- FW-7 FIXED IN CODE 2026-08-04: reply/counter context now travels to the service page — CTA reads 'Book · $X' at the reply's exact price (SPEC-211 seen==charged) wired to the same preConfirmed booking action as the reply card; direct visits unchanged. Verify live, then close.

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
