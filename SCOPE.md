# SCOPE — counter-price + crossPostRequest scope fix

Branch task: two closely-related deviations, one shared file. No push.

## Files touched (exhaustive)

| File | Change |
|---|---|
| `src/screens/ResultsScreen.jsx` | SPEC-211 — `serviceToProvider` now returns the COUNTER price as the bookable `priceCents`; the counter guard no longer turns a missing price into $0. |
| `src/lib/api.js` | SPEC-212 — `crossPostRequest` read `request.city` / `request.state` with no `request` bound in scope. Two lines inside that one function now read the `where_text` param. |
| `scripts/qa.mjs` | Added gates `#211` and `#212`. Both mutation-tested. |
| `SCOPE.md` | This file. |

Nothing else was modified. `src/lib/api.js` gained a comment block and changed
two lines *inside `crossPostRequest` only* — no exported signature changed, no
other function touched, no caller updated (see report).

## Deliberately NOT touched
- `src/screens/ServiceDetailScreen.jsx` — its PDP CTA already reads
  `provider.priceCents`, so it inherits the correct counter price from the fix
  above without an edit.
- `src/App.jsx` — `proceedBooking` already writes `provider.priceCents` to
  `createBooking({ totalCents })`; it inherits the fix.
- `src/components/ui/RequestQuoteSheet.jsx` — the caller of
  `crossPostRequest` already passes `where_text`; no change needed.
- `FROZEN_SPEC.md` / `SPEC-REGISTRY.md` / `MASTER-SPEC.md` — out of the
  assigned blast radius; spec rows are NOT filed, so by the project's
  Definition of Done this is not "done", it is "fixed + gated".
