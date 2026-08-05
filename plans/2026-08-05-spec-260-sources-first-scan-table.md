# SPEC-260 — /ops/data v3: sources-first scan table, results on demand, compact filters, legacy creator rows out

Founder order (2026-08-05, verbatim): "creators have junk removal.. need to see a list of
results accross SOURCES like in the table shared above.. to quickly scan sources.. (ahead
of actual results.. i don't need to see results unless i download them or ask to load them
on the screen).. redesign the filters so they're far easier to view more intuitive less
bulky.."

## What changes (all in src/screens/DataExportScreen.jsx + scripts/qa.mjs + registries)

1. **Scan table primary.** The SPEC-249 board data (per-source fresh x/target, state,
   filtered rows, ☎/✉/both %, queue new/parked, errors) renders ALWAYS, first, as one
   compact `SourceRow` per source (`data-source-row` marker), with a per-source ⬇ CSV.
   SPEC-258's collapsed "Source status" toggle (`showBoard`) is superseded — the board
   data IS the primary table. #251 rule kept: fresh display is `Math.min(b.fresh,
   b.fresh_target)`; a failed count says FAILED, never 0.

2. **Results on demand — RENDER-deferred, not fetch-deferred.** The LeadRow list renders
   only after a "Load results (N)" click (`showResults`, default false). Fetch is
   unchanged (`limit: size`) because:
   - the server computes `limit = Math.min(Number(body.limit || 1000), 25000)` — a
     `limit: 0` is falsy and silently becomes 1000, so a "fetch nothing" request is not
     supported;
   - "⬇ CSV works WITHOUT loading the list" requires the rows client-side anyway;
   - gate #258's `limit: size,` pin stays valid untouched.

3. **Compact filters.** Segmented Services | Creators control (`data-class-toggle`),
   quiet pills for Crawl queue / Agent runs (#210 keeps them selectable). City pills
   All · NYC · Miami; locality select appears only after a city is picked. One compact
   row for source + type/category. Status, reachable-only, time, size, and the legacy
   checkbox live behind "More filters ▾" (`moreOpen`, default false). Active non-default
   filters render as removable chips. Tokens only (danger/warnText/g/gl/gd2/bg4/bg5/b2/b3).

4. **Legacy creator rows out of the default view.** `CREATOR_SLUGS` (12 slugs, welded by
   gate #260 to `CREATOR_CATEGORIES` in opsPayload.ts — the frontend cannot import a Deno
   module) → `isNewSpecCreator(r)`. `excludeLegacy = audience==='creators' && !showLegacy
   && !category` (an explicitly picked category is an explicit ask, and leads-dashboard
   only supports a single eq() category param — no server-side NOT-IN exists, so the
   exclusion is client-side on rows AND on every CSV path: download() consumes the
   visible `rows`; downloadSource/downloadEach filter their fetched `d2.rows` the same
   way). "Show legacy rows from the pre-category run" checkbox in More filters, default
   off. Rows stay in the DB — display only.

## Gates

- **Amend #258 in place**: the showBoard-default-false / board-inside-toggle /
  list-outside-toggle asserts are superseded (founder verbatim quoted in the comment) →
  replaced by: SourceRow + data-source-row primary and AHEAD of the results gate,
  `showResults` default false, LeadRow list only inside `{showResults && (`, "Load
  results" button exists. LeadRow/bestLink/limit/empty-state asserts kept verbatim.
- **New gate #260**: slug weld screen↔opsPayload, isNewSpecCreator + excludeLegacy
  expressions, allRows filter expression, showLegacy default-off + honest label,
  downloadSource CSV exclusion, download-view reads visible rows, segmented class toggle,
  More-filters disclosure default-collapsed and containing the bulky controls.
- Mutation-test every amended + new assert (break → FAIL → restore via cp).

## Suite: 243 → 244.
