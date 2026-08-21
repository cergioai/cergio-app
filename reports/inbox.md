# Jobs inbox — one truthful card per event

**agent** `inbox` · **priority** 3 · **NEEDS WORK** · 2026-08-21T13:38:35.624Z

> **Green when:** every inbox row maps 1:1 to a distinct live DB row, every row carries a timestamp, and the founder can find any request + its replies in one place

## Its gates

| gate | state |
|---|---|
| #154 | pass |

Whole suite: 268 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 533 of 542 repo files.

## Open defects it is accountable for

- FW-1 FIXED IN CODE 2026-08-04: Home now has a persistent 'Your requests & replies' entry (signed-in) straight to /inbox?tab=Requests, and the inbox honors the tab deep-link. Verify live, then close.
- FW-1 FIXED IN CODE 2026-08-04: Home now has a persistent 'Your requests & replies' entry (signed-in) straight to /inbox?tab=Requests, and the inbox honors the tab deep-link. Verify live, then close.
- FW-1 FIXED IN CODE 2026-08-04: Home now has a persistent 'Your requests & replies' entry (signed-in) straight to /inbox?tab=Requests, and the inbox honors the tab deep-link. Verify live, then close.
- FW-16 FIXED IN CODE 2026-08-05: inbox request-match now uses the fan-out's bridge UNION (both request columns vs taxonomy∪category expanded sets) — a notified provider can never have the request hidden from his inbox again. Verify live: pending Driver request must appear for the driver account.

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
