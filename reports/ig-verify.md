# IG post verify + listing management

**agent** `ig-verify` · **priority** 4 · **NEEDS WORK** · 2026-08-21T13:38:34.991Z

> **Green when:** the IG verify flow enforces the highlight, links to the service, notifies the provider for approval, and /services/manage shows the intended form

## Its gates

| gate | state |
|---|---|
| #48 | pass |

Whole suite: 268 pass · 0 fail. Build: clean. Wall: HIDDEN FROM THIS AGENT: 531 of 542 repo files.

## Open defects it is accountable for

- FW-10 FIXED IN CODE 2026-08-04: the Story-Highlight step is now a REQUIRED confirmation whenever a post is part of the submission (free barter always; paid once a link is pasted) — submit stays disabled until confirmed. Paid-no-post stays allowed per FROZEN SPEC-53; if the founder meant the post itself must be mandatory even when paid, that needs his one-line unfreeze. Verify live, then close.
- FW-11 FIXED IN CODE 2026-08-03 (Copy link now shares the SERVICE page when the reco has a service; recommender invite link only when no listing exists) — verify live after deploy, then close
- FW-12 FIXED IN CODE 2026-08-04: submitting an IG review/post now notifies the provider ('X posted an IG review of your service — review and approve') via the notify-request edge fn 'reviewed' action, incl. the previously-silent held-review and paid-no-link paths; also documented the broken bare-id notifyUser call. Edge fn redeploys via CI. Verify live, then close.
- FW-13 FIXED IN CODE 2026-08-05 (reading 3, backed by the founder's recorded no-popup rule 'cancel request should be in line (not a pop up from browser)'): ServiceDetailProviderScreen field edits are now INLINE (input + Save/Cancel), window.prompt removed. NOTE: CrossPostScreen.jsx:68 still has a live window.prompt — separate follow-up. Verify live, then close.

## What this report does NOT prove

The suite is a STATIC gate — it reads source, it makes no network calls. It cannot
see production. So a green report here means "the code says the right thing and the
guards are in place", never "this works live". Anything requiring live proof is named
above as an open defect and stays open until an artifact exists.
