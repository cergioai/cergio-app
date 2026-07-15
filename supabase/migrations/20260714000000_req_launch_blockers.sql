-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — LAUNCH-BLOCKER requirements (founder walk of the live product,
-- 2026-07-14, /inbound/448feb80-37d1-4365-812b-d182146aa7ef). SPEC-78.
--
-- Five defects Tarik hit in his own product. Each row below is locked by a
-- regression test in scripts/qa.mjs named `spec-<id>` — the prefix
-- auto-build.mjs reads to flip the row open → verified (cergio_verify_requirement)
-- once the test is green on main. A row here with no green test stays OPEN:
-- writing a requirement is not shipping it (SPEC-72 firing-honesty).
--
-- Status is seeded 'built' (code written + gate green offline), NOT 'verified' —
-- verification is earned by the test running green on main, not by this file.
--
-- Idempotent: cergio_open_requirement upserts by id; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

select public.cergio_open_requirement(
  'launch-02',
  'The post-request waiting state shows EXACTLY Tarik''s sentence: "This may take 15 minutes to a few hours to locate and get you a solid offer. We''ll notify you the moment we have a match." The old instant/scheduled copy fork ("Allow up to 15 minutes…" / "…up to 24 hours to locate and negotiate…") is retired from every surface. Locked by qa.mjs spec-launch-02 (byte-exact against the exported WAIT_COPY).',
  'SPEC-78 / launch-02',
  'results',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-03',
  'Best match in a covered area = HIGHEST RATING first, then CLOSEST distance (rating_count, then id as stable tie-breakers; an unrated provider is unknown, not 0.0, and sorts below any rated one). listServices'' proximity branch orders through the pure exported rankProviders() — the distance-only sort (a 3.1-star next door beating a 5.0-star two miles away) is retired. Locked by qa.mjs spec-launch-03 (executes rankProviders on three fixtures with known rating/distance).',
  'SPEC-78 / launch-03',
  'search',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-04',
  'On /inbound/:reqId the requester''s avatar AND name are clickable and open their profile (/u/:requesterId). The identity block renders whenever the requester is known — not only when they are a Connector / have an IG handle / have a bio (which left a plain requester with no route to their profile at all). Locked by qa.mjs spec-launch-04.',
  'SPEC-78 / launch-04 / SPEC-48',
  'responses',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-05',
  'SELF-NOTIFY IS IMPOSSIBLE: a user is NEVER notified as a provider for a request they created. Enforced server-side in notify-request/handleCreated against the request''s own requester_id (so no caller — present, future, retried or buggy — can dispatch to the requester), and on every client path that writes a kind=new_request row (createRequestAndFanOut, crossPostRequest, createRequestToProvider). Locked by qa.mjs spec-launch-05, which EXECUTES the shipped recipient filter against a list containing the requester.',
  'SPEC-78 / launch-05',
  'responses',
  'founder',
  'built'
);

select public.cergio_open_requirement(
  'launch-06',
  'A saved location survives the night: saveAddress persists to the durable user_metadata store (no migration required), NEVER reports success when nothing persisted, and is not masked as a failure when the optional user_addresses table errors; an address the geocoder cannot verify is still saved (as typed, null coords) instead of living in localStorage alone; getDefaultAddress reads the durable copy first and the session-start load re-hydrates it without clobbering it with a default. Locked by qa.mjs spec-launch-06.',
  'SPEC-78 / launch-06 / SPEC-2',
  'search',
  'founder',
  'built'
);
