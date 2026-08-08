# /ops/status — the founder's console

**agent** `ops-dashboard` · **priority** 6 · **NEEDS WORK** · 2026-08-08T18:24:36.160Z

> **Green when:** changing any filter changes the counts, and every facet list is derived from live rows

## Its gates

| gate | state |
|---|---|
| #227 | pass |
| #229 | pass |
| #231 | pass |
| #232 | pass |
| #233 | pass |

Whole suite: 268 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 510 of 520 repo files.

## Open defects it is accountable for

- every count and CSV must obey City (DMA), Location, Category, Time and Rows — the LIVE counts bypassed all of them and made working filters look broken
- DMAs and every facet must come FROM THE DATA, never a hardcoded list
- deleting an export from opsPayload crashed the whole console with 'SOURCES is not defined' — no count, no filter, no DMA
- exactly TWO creator sources; a list of six put four permanent zeros beside the real ones
- google_sponsored is folded into google_lsa, never shown as its own row

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
