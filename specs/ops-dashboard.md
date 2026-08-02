# /ops/status — the founder's console

**CI subagent:** `ops-dashboard`

> This file is the SOURCE OF TRUTH for this screen, not the code. If the code and this file
> disagree, the code is wrong.

## Green when

Changing any filter changes the counts, and every facet list is derived from live rows.

## The filter contract — ALL of it applies to EVERY count and EVERY CSV

| filter | column | notes |
|---|---|---|
| **City** | `state` | a **DMA** — NYC, Miami. Derived from data; a new DMA appears as soon as it has rows |
| **Location** | `city` | sub-filter of City. Normalised (Astoria / ASTORIA / "Astoria " are ONE entry) |
| **Category** | `service_type` | personal trainer, dog trainer, … |
| **Time** | `fetched_at` | All · 6h · 12h · 24h · 2d · 3d · 7d · 2w · 4w |
| **Rows** | limit | 100 · 500 · 1000 · 5000 · 10000 · 25000 |

The column NAMED `city` holds LOCATIONS. `state` holds the DMA. This mismatch is the single
biggest source of confusion on this screen and must be mapped in the query, never papered
over in the UI.

## Tab names

`Services` (not "LIVE counts") · `Creator sources` · `QA & Bugs` · `Agents` · `Crawls` ·
`Product data`. The headline count carries the class name — a generic label means the
biggest number on the page never says what it counts.

## Three defects that must never return

1. **The LIVE counts bypassed every filter.** Four hardcoded queries built straight off the
   table. Every control looked broken while the data behind it was fine — which destroys
   trust in a working system. They go through one shared helper now.
2. **Hardcoded facet lists.** DMAs were fixed at two, so a third would be crawled and never
   appear. Every list comes from the data.
3. **A deleted export crashed the whole console.** A regex meant to remove one entry from
   `SOURCES` deleted the entire declaration, and the page died with `SOURCES is not
   defined` — no counts, no filters, no DMAs. A regex that matches a LINE is not a regex
   that matches an ITEM.

## Founder decisions on record

- 2026-08-02: "cities are DMA's only ..what you have under cities is locations ... which
  should be a sub filter of city.. alongside service type or category"
- 2026-08-02: "time filter (last 6 hours, 12 hours, 24 hours, 2 days, 3 days, 7 days,
  2 weeks, 4 weeks) alongside last 100, 500, 1000, then increments up to 25000 or all"
- 2026-08-02: "No services tab (relabel live counts)"
- 2026-08-02: "force this report onto one CI subagent.. so they don't regress"

## Progress log

- 2026-08-02 — subagent created; owns OpsStatusScreen.jsx + opsPayload.ts, guards #227 #229 #231 #232.

## Run order for the ops-dashboard subagent

Founder, 2026-08-02: "allocate the dashboard to CI subagent.. and let him immediately fix
the issues". Credit added, so the thinking half can run.

Work these in order. Each must pass the gate suite, the production build AND the scope
guard after the edit, or be reverted and reported as an attempt.

1. **Rows-per-download control on /ops/status.** 100 / 500 / 1000 / 5000 / 10000 / 25000.
   The founder asked twice and it is still missing from the deployed screen.
2. **Service type facet must render.** It exists in the payload; confirm the control is
   present and populated, and that choosing one narrows every count and CSV.
3. **Verify the DMA list shows exactly NYC and Miami** with off-target states reported
   beneath, and that selecting a DMA does not drop the count (all spellings matched).
4. **Reconcile the headline totals.** "Services total" must equal a direct count for the
   same filter. If a count query fails, its error must be on screen in red.
5. **yellowpages source-name mismatch** — the exporter reads `yellowpages_apify` while the
   crawler writes `yellowpages`, so 859 real rows export as zero. Pick ONE name and make
   both sides use it. This is a two-sources-of-truth defect, the third mechanism.

Anything requiring a founder decision is REFUSED, not guessed.
