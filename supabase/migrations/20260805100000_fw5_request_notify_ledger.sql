-- FW-5 · SERVER-SIDE SEND-ONCE GUARD for 'created' (new-request) fan-out.
--
-- FW-5 (founder verbatim, 2026-08-05): "don't remember this request that I'm
-- seeing on tarik.sansal2 ... fired an old request by itself" — an OLD request
-- re-announced itself as 'New request · House Cleaner · 28m' to a provider.
--
-- The exact re-trigger is unhuntable (logs unavailable), and the existing
-- fan-out telemetry (20260730200000_fanout_telemetry.sql / cergio_log_fanout)
-- records only an OUTCOME string into the QA ledger — it does NOT record
-- recipients, so it cannot answer "was this provider already notified?".
-- This ledger does: one row per (request_id, provider_id) pair that has been
-- notified about a 'created' event, written by the notify-request edge fn
-- (service role) BEFORE any email/SMS leaves the building.
--
-- Contract (see notify-request/handleCreated):
--   INSERT ... ON CONFLICT DO NOTHING with RETURNING — atomic claim, no race.
--   A pair that inserts → first notification → send. A pair that conflicts →
--   already notified → send is SKIPPED. Old requests can never re-announce,
--   no matter what re-triggers the fan-out (retry, replay, cron, buggy caller).
--   Fail-open ONLY on ledger errors that are not conflicts (guard must never
--   silence all notifications) — the edge fn logs loudly and sends unguarded.

create table if not exists public.request_notify_ledger (
  request_id  uuid        not null,
  provider_id uuid        not null,
  notified_at timestamptz not null default now(),
  -- The PK is the send-once unique index: one notification per pair, ever.
  primary key (request_id, provider_id)
);

comment on table public.request_notify_ledger is
  'FW-5: send-once ledger for new-request provider notifications. A (request_id, provider_id) row means that provider was already announced this request; notify-request skips any pair already present (insert-first, ON CONFLICT DO NOTHING).';

-- Service-role only: RLS on with NO policies. The notify-request edge fn runs
-- as service role (bypasses RLS); clients can neither read nor forge entries.
alter table public.request_notify_ledger enable row level security;

-- Backfill from the in-app notification rows notify-request already writes
-- (kind='new_request', data->>'request_id') so requests announced BEFORE this
-- migration are immediately covered — an old request cannot claim a "first"
-- send just because it predates the ledger. Guarded uuid cast; best-effort.
insert into public.request_notify_ledger (request_id, provider_id, notified_at)
select distinct on ((n.data->>'request_id')::uuid, n.profile_id)
       (n.data->>'request_id')::uuid,
       n.profile_id,
       n.created_at
from public.notifications n
where n.kind = 'new_request'
  and n.data->>'request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict (request_id, provider_id) do nothing;
