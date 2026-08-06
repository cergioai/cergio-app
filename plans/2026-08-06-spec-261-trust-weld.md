# SPEC-261 — the dashboard number and the CSV are the SAME query (trust weld)

## Founder defect report (2026-08-05, verbatim)
"IG scraper download had 1 record.. shoed 100 in download with 10% phone.. how can we
trust the dashboard"

## Measured root cause (do not re-derive)
In `supabase/functions/leads-dashboard/index.ts` the board/filteredTotal are SERVER-side
counts over the full filtered set, while the CSV path is `rows` = a ROW_CAP-limited page
(newest-first by tsCol, `.order(tsCol,{ascending:false})` — NULL timestamps sort FIRST
in Postgres desc, so null-ts rows hijack the page) that the screen then filters
CLIENT-side (legacy exclusion in downloadSource/downloadEach/download-view,
`src/screens/DataExportScreen.jsx`). Count-population ≠ rows-population → board said
100, CSV had 1. Also the creators BOARD row counts (audience==='creators', `keys=[src]`)
count ALL rows for the source including legacy pre-category rows, while SPEC-259 defined
the creator hundred as NEW-SPEC (category ∈ the 12 CREATOR_CATEGORIES slugs) only.

## Build
1. `leads-dashboard/index.ts`
   - New body param `categoriesIn: string[] | null` — applied `.in('category', …)` to
     BOTH the rows query (rq) AND the count query (cq). `categoryFilter` (single eq)
     wins if both are sent — more specific.
   - `.order(tsCol, { ascending: false, nullsFirst: false })` — null timestamps can
     never hijack the ROW_CAP page.
   - Creators board: when audience==='creators' and src==='ig-scraper-user-search',
     srcMatch adds `.in('category', CREATOR_CATEGORIES.map(c=>c.slug))` (imported from
     `../_shared/opsPayload.ts` by extending the existing import line — no gate pins
     leads-dashboard's import verbatim; #243 pins fulfill-crawl's). fresh/filtered and
     the ☎/✉/both % all flow through srcMatch, so they compute over the SAME
     population. `se:web-harvest` unchanged (its rows are category-driven by
     construction).
   - Response adds `rowsMatchCount: rows.length >= Math.min(filteredTotal ?? 0,
     ROW_CAP)` — the honesty bit. Inserted BEFORE `board` so gate #249's
     `board, rows: rows` pin stands untouched.
2. `src/screens/DataExportScreen.jsx` (+ `src/lib/api.js` forwards `categoriesIn`)
   - load()/downloadSource/downloadEach pass `categoriesIn: CREATOR_SLUGS` when
     (creators && !showLegacy && !category). The client-side `.filter(isNewSpecCreator)`
     stays as a belt-and-braces no-op (gate #260 pins it; guards a stale slug copy).
     load() states the condition inline and adds `showLegacy` to its deps (TDZ:
     `excludeLegacy` is declared below the callback).
   - `csvMismatch(got,total,cap)` — every CSV path compares delivered rows against
     min(filteredTotal, rowCap) and shows "CSV has N rows; the count says M — mismatch,
     do not trust this export" instead of silently saving fewer. The visible list gets
     the same honesty via `data.rowsMatchCount === false`.
   - Every CSV filename appends ` (N rows).csv`.
3. `scripts/qa.mjs` gate #261 — RAW-text scans (terms live in template literals),
   every assert naming the trust consequence. Mutation-tested. No #249/#251/#253–#260
   pin is touched.
4. Registries: S-261 CODED rows in SPEC-REGISTRY.md + MASTER-SPEC.md.

## Verify
`node scripts/qa.mjs` (245, 0 fail) → mutation FAIL lines → tdz-guard → deno-guard →
`npx vite build`.
