-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — LAUNCH-BLOCKER requirements ROUND 2 (founder live walk, 2026-07-16).
-- SPEC-79. Four defects Tarik hit testing the live product; 12 + 13 are a
-- privacy leak and a dead core loop.
--
-- Each row is locked by a regression test in scripts/qa.mjs named `spec-<id>` —
-- the prefix auto-build.mjs reads to flip the row open → verified
-- (cergio_verify_requirement) once the test is green on main. A row here with no
-- green test stays OPEN: writing a requirement is not shipping it (SPEC-72
-- firing-honesty). Status is seeded 'built' (code written + gate green offline),
-- NOT 'verified' — verification is earned by the test running green on main.
--
-- Idempotent: cergio_open_requirement upserts by id; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

select public.cergio_open_requirement(
  'launch-12-address-isolation',
  'A saved address is isolated PER USER — no cross-account bleed. The address localStorage cache is namespaced by the signed-in user''s auth id (addrCacheKey(uid) → cergio.addr.<uid>; guests use cergio.guestAddress). A single shared key leaked one account''s saved address to the next account on the same browser (signed in as info@, the founder saw t@''s "134 Henry Street"). Every cache read/write in HomeScreen + InlineLocationEditor routes through the uid-scoped key; the durable truth is per-user user_metadata. Locked by qa.mjs spec-launch-12-address-isolation (executes addrCacheKey — two users get different keys).',
  'SPEC-79 / launch-12',
  'search',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-13-match-notify',
  'A distinct provider with a matching LISTED service is notified + can see the request. The listing side (ServiceListAboutScreen) resolves a free-text service type through the SAME resolveProviderTypeLocal the request side uses (resolvedProviderType = parserPT || canonicalMatch || localPT), so a phrase like "french tutor" locks to "Tutor" and never saves taxonomy_provider_type=NULL (which was invisible to getProvidersForNotify + listServices while the SEARCH resolved to "Tutor"). The self-notify guard excludes ONLY the requester, never a different matching provider. Locked by qa.mjs spec-launch-13-match-notify (executes the shipped fan-out filter + the ownerIds exclusion + the shared resolver).',
  'SPEC-79 / launch-13 / SPEC-55 / SPEC-67c',
  'requests',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-14-list-route',
  'List-a-service CTAs open the list flow, not the manage screen. ClaimProfileScreen''s "List your service" button navigated to /services/manage (the MANAGE screen) instead of /list-service (the list-a-service welcome flow); fixed. /list-service (ServiceListWelcomeScreen) and /services/manage (ManageServicesScreen) stay distinct. Locked by qa.mjs spec-launch-14-list-route.',
  'SPEC-79 / launch-14',
  'listings',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-15-wait-copy-v2',
  'The post-request waiting state shows the founder''s heading + body + action: heading "We''ll notify you when Connectors accept"; body "Your request is out to matching Connectors. Once one accepts, they show up here — free swaps first. Counter-offers land in Spotlight requests > Sent for you to accept or counter back."; action "Cancel request"; the pulsing live/working LeafLogo is kept. Exported as WAIT_HEADING + WAIT_COPY (one source of truth). SUPERSEDES launch-02 (the old single sentence is retired). Locked by qa.mjs spec-launch-15-wait-copy-v2 (byte-exact against the exported constants).',
  'SPEC-79 / launch-15 / SPEC-78',
  'results',
  'founder',
  'built'
);

-- launch-02 (v1) is SUPERSEDED by launch-15. Re-describe it as the retirement
-- guard so the ledger tells the truth about what its test now enforces.
select public.cergio_open_requirement(
  'launch-02',
  'RETIRED wait-copy variants are gone from every surface (the original instant/scheduled fork AND the launch-02-v1 single sentence "This may take 15 minutes to a few hours…"). The live wait copy is now WAIT_HEADING + WAIT_COPY (launch-15-wait-copy-v2). Locked by qa.mjs spec-launch-02 as the retirement guard.',
  'SPEC-78 / launch-02 (superseded by launch-15)',
  'results',
  'founder',
  'built'
);
