# SPEC-259 — CREATOR_TARGET counts only NEW-SPEC creator rows

Founder, 2026-08-05, verbatim: "share 100 new resuls from the creator new spec run...
to complete the evaluation...."

## The defect (given, not re-derived)
fulfill-crawl's CREATOR_TARGET=100 self-stop counts `leads_influencers`
eq(discovered_via,'ig-scraper-user-search') — ALL of them. Since SPEC-257, NEW-spec IG
creator rows carry a CREATOR_CATEGORIES slug in `category`; the OLD deviation rows
carry services-rota terms ("junk removal"). ~67 old rows already count toward the 100,
so the crawl would stop ~67 short of the 100 NEW-SPEC rows the founder must evaluate.

## Changes
1. `supabase/functions/fulfill-crawl/index.ts` — the ONE ig creator-target count
   (the CREATOR_TARGET block, ~line 171) adds
   `.in('category', CREATOR_CATEGORIES.map((c) => c.slug))` chained after the eq().
   CREATOR_CATEGORIES is already imported (SPEC-257). This same count feeds the
   SPEC-256 need snapshot (_creatorFreshForNeed), so remainingNeed('ig_services') now
   sizes buys to the NEW-SPEC remainder too — intended: the founder is owed 100
   new-spec rows. The per-category 25-cap counts already filter eq(category, slug) —
   untouched. Old rows stay in the table untouched: data is data, they are kept but
   not counted.
2. creator-harvest is NOT touched: its own target counts
   like(discovered_via,'se:web-harvest%') — a different source with its own spec;
   gate #259 pins that its like() form is UNCHANGED and carries no category filter.
3. `growth-controls.json` — doc-only edit to `_CREATOR_TARGET`: ig_services counts
   new-spec rows only (eq discovered_via + in category CREATOR_CATEGORIES slugs),
   founder verbatim recorded, old deviation rows kept but not counted.

## Gate #259 (raw text, mutation-tested)
- The CREATOR_TARGET count region carries BOTH `.eq('discovered_via',
  'ig-scraper-user-search')` AND the chained `.in('category',
  CREATOR_CATEGORIES.map((c) => c.slug))`.
- `_CREATOR_TARGET` doc contains the founder verbatim and the kept-but-not-counted
  rule.
- creator-harvest's `like('discovered_via', 'se:web-harvest%')` count is UNCHANGED
  and its target region gained NO category filter.

## Files
supabase/functions/fulfill-crawl/index.ts · growth-controls.json (doc key only) ·
scripts/qa.mjs (#259) · SPEC-REGISTRY.md · MASTER-SPEC.md · this plan.

## Verify
node scripts/qa.mjs (243, 0 fail) → mutation FAIL lines → tdz-guard → deno-guard →
npx vite build. No commit/push.
