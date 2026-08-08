# Payment on accept — THE LAUNCH BLOCKER

**agent** `payments` · **priority** 1 · **NEEDS WORK** · 2026-08-08T18:24:41.276Z

> **Green when:** one real booking reaches paid_at with a Stripe charge id

## Its gates

| gate | state |
|---|---|
| #47g | pass |
| #155b | pass |

Whole suite: 268 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 510 of 520 repo files.

## Open defects it is accountable for

- bookings_paid has been 0 for the life of the project — no card has ever been charged end to end
- counter-offer price shown vs charged (SPEC-211/212 shipped; needs live proof)
- FW-8 (founder walk 2026-08-02): enable Stripe TEST mode / dummy-card path so the booking E2E can be walked without real money ('enable card payments to pay with stripe ... or enable testing with dummy card')
- FW-9 (founder verbatim 2026-08-02, sharpens defect #1): 'user needs to pay when accepting a counter offer ... so their card is charged automatically... to eliminate the additional pay step... (funds kept until job done.. per spec release)'

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
