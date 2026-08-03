# Profiles + service pages say WHO they are

**CI subagent:** `profile-ux` · split out of booking-loop 2026-08-03 (founder: "need to expedite my fixes... how can agents execute in parallel")

> This file is the SOURCE OF TRUTH for this area, not the code. Progress accumulates in
> FILES and git history, never in a model's context window.

## Green when

every profile surface names its owner correctly and a countered price follows the user onto the service page

## Owned files

- `src/screens/ProfileScreen.jsx`
- `src/screens/ServiceDetailScreen.jsx`

## Open defects

- [ ] FW-4: my own profile doesn't show my name; the provider's profile shows the REQUESTER's name (founder walk 2026-08-02; NOTE FW-3 turned out data-consistent — verify with the same DB-probe discipline before changing renders)
- [ ] FW-7: viewing a reply on the service profile must show a BOOK button carrying the COUNTER price — not the generic request CTA

## Founder decisions on record

- 2026-08-03: "need to expedite my fixes... how can agents execute in parallel" — this
  agent exists so the founder-walk items are worked in PARALLEL, not queued behind one agent.
- Discipline inherited from FW-3: PROBE THE DB before changing a render — FW-3 looked like
  a render bug and was consistent data (the founder's own account owned the listing).

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_
