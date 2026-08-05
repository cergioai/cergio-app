# SPEC-258 — /ops/data: the primary view is a straight simple list of results

Founder, 2026-08-05, verbatim: "redesign the dashboard so it's very easy to view and
click.. straight simple list of results (that changes dynamicaly with filter)".

## The defect (given, not re-derived)
/ops/data fetches filtered `rows` on every filter change (SPEC-223/226/229 filters all
work) but shows them as dense 7–10-field CARD GRIDS below two diagnostic panels — the
SPEC-249 audit board and the by-source panel sit ABOVE the results. The founder's ask
is the inverse: results first, one legible tappable row per lead, diagnostics tucked
behind a toggle.

## Changes (src/screens/DataExportScreen.jsx only — leads-dashboard already returns rows)
1. PRIMARY view = a single-column zebra list, one `LeadRow` per row, rendered from
   `data.rows` (which already re-fetches on every filter: audience, DMA, source,
   location, service type, category, status, reachable-only, time, size 100…25000).
   Row content: name/handle · service type or creator category · city · ☎ phone ·
   ✉ email · source chip · relative fetched time. Large touch targets (py-3),
   `odd:bg-white even:bg-bg4` zebra (design-spec tokens via tailwind.config.js — no
   eyeballed colours), no dense table.
2. Click = open the row's best link in a new tab, chain
   `website_url → external_url → IG profile (instagram/ig_handle) → yelp_url →
   cl_post_url`, first available. A row with NO link renders as a <div> (not <a>) and
   shows no ↗ affordance — a dead-looking click is a broken-feeling dashboard.
   Both branches carry `data-lead-row` (the stable marker gate #258 pins).
3. The SPEC-249 audit board AND the by-source panel move behind ONE default-collapsed
   toggle ("Source status ▾", `const [showBoard, setShowBoard] = useState(false)`).
   Nothing inside them changes — gates #249/#251 keep their pins (data.board,
   downloadSource filters, FAILED, Math.min(b.fresh, b.fresh_target)).
4. Keep: filters bar, stat tiles, Download view / Download each source, the
   "x of y (capped)" honesty line, the verbatim error surface, "No rows for this
   filter." empty state, "Loading…" line. Render cap 1,000 rows with the honest
   "download has all N" note (25k DOM rows would freeze the phone this list is for).
5. Delete COLS/NOTE_COL card grid (display-only; CSV still exports every column).
   cost_usd stays visible on crawl rows (gate #205 pins it).

## Gate #258 (raw text, mutation-tested)
- LeadRow exists and the rows map renders it (pins `rows.slice(0, 1000).map` +
  `data-lead-row` on BOTH branches).
- The bestLink chain is exactly website_url → external_url → IG → yelp_url →
  cl_post_url; the linkless branch is a <div> with no `{link && …}` affordance.
- The board render sits INSIDE `{showBoard && (` and the list sits OUTSIDE/ABOVE it;
  showBoard defaults false.
- The size selector feeds the fetch (`limit: size,` + `setSize(Number(e.target.value))`).
- Empty state stays "No rows for this filter." and `{err}` renders verbatim.

## Files
src/screens/DataExportScreen.jsx · scripts/qa.mjs (#258) · SPEC-REGISTRY.md ·
MASTER-SPEC.md · this plan. leads-dashboard untouched.

## Verify
node scripts/qa.mjs (243, 0 fail) → mutation FAIL lines → tdz-guard → deno-guard →
npx vite build. No commit/push.
