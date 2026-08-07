# SPEC-263 — FREE website contact harvest for IG rows (site-enrich)

## Founder order (2026-08-06, verbatim)
"figure out a solution to capture more contact details for IG... my search showed some
had websites with emails and or phones.. it may need a 3 step crawl or alternative
straetgy.. worst case we scale the numbers to 5000 to get 500 contactable ... per
city .. but creators always ahve an email somewhere as they want to attract partners
and advertising..."

## Measured facts (audit 2026-08-06T04:28Z — not re-derived)
- `ig_services`: 276 rows, **218 with external_url** (websites/linktrees), only
  **29 emails, 0 phones** — 10.5% contactable.
- The contact details sit ONE HOP away, on pages whose addresses are already in the
  rows we paid for. Reading them costs $0. The founder's "worst case" — scaling paid
  buys to 5,000/city to net 500 contactables — is 10x spend to compensate for pages
  we never fetched. This spec fetches them first.

## Changes
1. **NEW** `supabase/functions/site-enrich/index.ts` (Deno)
   - Auth mirrors creator-enrich: service-role bearer required; `const gdb =
     growthDb()` FAILS LOUD if the growth env is absent (gate #166 — growth work on
     the product client is the 2026-07-30 outage).
   - Candidates (batch ~12, oldest first by fetched_at): `leads_influencers` where
     `email` null AND `phone` null AND `external_url` not null AND
     `site_enriched_at` null; batch topped up from `leads_services` where
     `data_source='ig_services'` AND `phone` null AND `owner_email` null AND
     `website_url` not null AND `site_enriched_at` null. (Column names verified by
     grep against the growth schema reference + fulfill-crawl upserts:
     `owner_email` / `website_url`, not "website".)
   - 3-step crawl, ALL free plain fetch, 5s `AbortSignal.timeout` per request,
     ~45s run budget — candidate picking STOPS when the budget is spent:
     1. fetch external_url; link-in-bio hosts (linktr.ee, beacons.ai, bio.link,
        linkin.bio, lnk.bio, taplink) fan out to up to 3 non-social outbound sites.
     2. scan HTML: `mailto:` first then email regex; `tel:` first then US phone
        pattern. MANDATORY junk filter — asset-extension "emails" (.png/.jpg…),
        domains wixpress.com / sentry.io / example.com / sentry-next / godaddy /
        cloudflare, local-parts noreply / no-reply / donotreply. A junk email
        written to a lead row is worse than none: it poisons outreach.
     3. nothing found → up to 2 same-origin contact-shaped pages (/contact,
        /contact-us, /about, or a same-origin href whose text matches /contact/i).
   - Write-back FILL-ONLY: the UPDATE re-checks `.is('email', null).is('phone',
     null)` (`owner_email` on services) so a contact another path found between
     select and write is NEVER overwritten; `site_enriched_at` stamped on EVERY
     attempt (0-row fill-only match or write error stamps alone) so no site is
     retried in a loop. Returns `{ scanned, enriched_email, enriched_phone,
     skipped_junk, elapsed_ms }` so cron logs are diagnosable; best-effort
     agent_runs row, same shape as creator-enrich.
   - creator-enrich (PAID Apify against IG itself) untouched — different mechanism.
2. **Migration** `supabase/migrations/20260806050000_spec263_site_enrich.sql`
   - `site_enriched_at timestamptz` onto BOTH lead tables, `add column if not
     exists` (duplicate-safe, the repo's idempotency pattern).
   - Cron `cergio_site_enrich` `*/15 * * * *` via `public.cergio_call_edge
     ('site-enrich')` — unschedule-first exists-guard, same shape as
     20260803030000. Name checked against 20260802023933's retired list
     (`cergio_creator_enrich`, `cergio_enrich_influencers`) — no collision.
3. **`supabase/migrations/20260730190000_growth_schema_reference.sql`** — heal
   guards for `site_enriched_at` on both tables. apply-growth-schema.mjs applies
   ONLY this file to the live growth project, so without this the column exists on
   the product DB and NOT where the lead rows live — the worker would 42703 only
   in production (the exact SPEC-202/237 defect, which this repo has paid for
   twice).
4. **Gate #263** in scripts/qa.mjs (RAW-text scans; every assert names the
   outreach/money consequence): function exists + service-role auth; gdb-only
   growth access; fill-only pinned BOTH ways (candidate `.is(null)` chains AND the
   null-re-checking update + conditional patch building); junk filter pinned
   (wixpress + noreply minimum, isJunkEmail called on the accept path); 5s
   per-request timeout + 45s budget + the budget `break`; unconditional attempt
   stamp + the failure-path stamp on both tables; migration pins (both columns,
   the */15 cergio_call_edge schedule, the unschedule exists-guard); the growth
   schema reference heal (both tables). Mutation-tested per CLAUDE.md.
5. **Registries**: S-263 row (CODED, #263) in SPEC-REGISTRY.md + MASTER-SPEC.md.

## Merge note (not part of this feature)
origin/main's PR #288 shipped its own S-262/gate #262 (Profile IA v2) while the
unshipped creator-spend-gate work also used S-262/#262. Gate #209 (no shared gate
IDs) failed on the collision. Resolution that weakens nothing: the UNSHIPPED spend
gate was renumbered to **S-262b / #262b** (its asserts are byte-identical); the
shipped #262 keeps the number. Baseline after resolution: 247 flows pass; 248 with
this spec's #263.
