# Redesign handoff PR 2 — the UI kit (components only)

Brief: `design_handoff_profile_booking/KICKOFF.md` "PR 2 — the UI kit" +
`STYLE_MIGRATION.md` + `Cergio UI Kit.dc.html` (visual spec).

## What lands

Ten new primitives in `src/components/ui/` (the eleventh, `Avatar`, landed in
PR 1). **Components only. No screen imports them yet — after this PR merges,
nothing in the app looks different.** That is the acceptance test.

| File | Spec (from the kit page, mapped to repo tokens) |
| --- | --- |
| `FacetBadge.jsx` | check icon = service facet, shield = Local Creator; label `text-meta font-semibold text-g` |
| `TrustLine.jsx` | FOLDS `reputation.jsx` — renders shared `TrustStream` (mutuals stripped) + the named green mutuals line via `mutualNamesText`. No competing wording. |
| `SectionTitle.jsx` | 18/700 profile, 20/600 pdp; optional sub in `b3` |
| `Card.jsx` | white, ring-1 `bdr`; radius 8 (row) / 12 (review) / 18 (media); `selected` = ring-2 `g` |
| `QuoteBubble.jsx` | `bg-soft` bubble, 30px `Avatar`, body text `b2`, date ALWAYS rendered |
| `PerkPanel.jsx` | the ONLY neutral use of `bg-gl`; perk icon; text `text-gd` bold 12 |
| `Button.jsx` | h-50 rounded-14; solid `bg-g`/700, outline ring `g` text `gd`/600, disabled `bg-gdis` |
| `Pill.jsx` | rounded-pill; solid `bg-g` white 800, quiet white ring `line` text `b2` 800 |
| `SeeAllLink.jsx` | label + (count) + chevron, `body` `b2`; never a green button |
| `RequestBox.jsx` | free-form textarea + green "Read as: …" echo panel; `onParse` callback stays a prop — chat-parse wiring is PR 5, no network code here |

Hex → token mapping (STYLE_MIGRATION rule "never raw hex"): #4AA901/#4BAB00/#49A800→`g`,
#3D8B00/#3E8D00→`gd`, #F3FFEA→`gl`, #828282/#A0A0A2→`b3`, #626A75/#343434→`b2`,
#F4F5F6→`soft`, #EBEBEB/#E0E0E0→`bdr`, #FCFCFC→`card`, #EFE7D6→`line`.
One color has no token: the disabled CTA `#C6D9B4` — added to
`tailwind.config.js` as `gdis` (sourced from the handoff kit; design-spec.md on
the design folder gets the matching row).

## Explicitly NOT in this PR

- No screen file changes. No query changes. No edge-function changes.
- No chat-parse invocation inside RequestBox (PR 5 wires it; the primitive
  only accepts an `onParse` prop and renders whatever echo string it returns).
- No new qa gate: pure-additive components with zero call sites (same
  precedent as PR 1's Avatar). Gates come with the screen migrations that
  consume them (PR 3+), where behaviour actually changes.

## Ship

`ship/pr2-ui-kit` → auto-ship PR → ci.yml (build + qa + e2e) → squash-merge.
SCOPE.md declares: the ten component files, tailwind.config.js, SCOPE.md.
