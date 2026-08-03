# IG post verify + listing management

**CI subagent:** `ig-verify` · split out of booking-loop 2026-08-03 (founder: "need to expedite my fixes... how can agents execute in parallel")

> This file is the SOURCE OF TRUTH for this area, not the code. Progress accumulates in
> FILES and git history, never in a model's context window.

## Green when

the IG verify flow enforces the highlight, links to the service, notifies the provider for approval, and /services/manage shows the intended form

## Owned files

- `src/screens/ServiceListVerifyScreen.jsx`
- `src/screens/RecoTrackingScreen.jsx`
- `src/screens/ManageServicesScreen.jsx`

## Open defects

- [ ] FW-10 (founder decision verbatim 2026-08-02): IG post story highlight 'should be mandatory not optional'
- [ ] FW-11: 'Copy link' must take to the SERVICE's profile, not the recommender's
- [ ] FW-12: provider is never notified when someone submits an IG review/post about them — needs notify + review/approve step
- [ ] FW-13: /services/manage renders the wrong form/screens (founder verbatim + URL)

## Founder decisions on record

- 2026-08-03: "need to expedite my fixes... how can agents execute in parallel" — this
  agent exists so the founder-walk items are worked in PARALLEL, not queued behind one agent.
- Discipline inherited from FW-3: PROBE THE DB before changing a render — FW-3 looked like
  a render bug and was consistent data (the founder's own account owned the listing).

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_
