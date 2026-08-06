# SCOPE

Redesign handoff PR 2 — the UI kit (founder 2026-08-05, brief:
`design_handoff_profile_booking/KICKOFF.md` "PR 2", visual spec
`Cergio UI Kit.dc.html`, rules `STYLE_MIGRATION.md`). Ten new primitives in
`src/components/ui/` (the eleventh, `Avatar`, landed in PR 1). `TrustLine`
folds the existing `reputation.jsx` primitives (TrustStream, mutualNamesText)
rather than competing with them. **Components only — nothing imports them yet,
so after this PR nothing in the app looks different.** `RequestBox` does no
parsing and no network; chat-parse wiring is PR 5. One token added:
`gdis` (#C6D9B4, the kit's disabled-CTA fill) in `tailwind.config.js`.

- `src/components/ui/FacetBadge.jsx`
- `src/components/ui/TrustLine.jsx`
- `src/components/ui/SectionTitle.jsx`
- `src/components/ui/Card.jsx`
- `src/components/ui/QuoteBubble.jsx`
- `src/components/ui/PerkPanel.jsx`
- `src/components/ui/Button.jsx`
- `src/components/ui/Pill.jsx`
- `src/components/ui/SeeAllLink.jsx`
- `src/components/ui/RequestBox.jsx`
- `tailwind.config.js`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`
