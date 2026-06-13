-- 2026-06-13 — Fix RLS on requests + request_responses.
--
-- PROBLEM 1: request_responses had no policies so requesters
--   (t@cergio.ai) couldn't see responses from providers (info@cergio.ai)
--   when the join was done in listMyRequestsWithResponses().
--
-- PROBLEM 2: the 2026-05-28 requests migration dropped the provider-read
--   policy, so providers could not find inbound open requests via
--   listInboundRequests().
--
-- This migration is idempotent — safe to re-run.

begin;

-- ─── requests ─────────────────────────────────────────────────────────────

alter table requests enable row level security;

-- Requester reads + writes their own requests (already existed; re-create idempotently)
drop policy if exists "self read"  on requests;
drop policy if exists "self write" on requests;
drop policy if exists "self upd"   on requests;
create policy "self read"  on requests for select using (auth.uid() = requester_id);
create policy "self write" on requests for insert with check (auth.uid() = requester_id);
create policy "self upd"   on requests for update using (auth.uid() = requester_id);

-- Providers need to read open (pending) requests from OTHER users so
-- listInboundRequests() can surface marketplace requests to them.
drop policy if exists "providers read open" on requests;
create policy "providers read open"
  on requests for select
  using (
    status = 'pending'
    and auth.uid() != requester_id
    and auth.uid() is not null
  );

-- ─── request_responses ────────────────────────────────────────────────────

alter table request_responses enable row level security;

-- Responder writes + reads their own response rows
drop policy if exists "responder insert" on request_responses;
drop policy if exists "responder read"   on request_responses;
drop policy if exists "responder update" on request_responses;
create policy "responder insert"
  on request_responses for insert
  with check (auth.uid() = responder_id);
create policy "responder read"
  on request_responses for select
  using (auth.uid() = responder_id);
create policy "responder update"
  on request_responses for update
  using (auth.uid() = responder_id);

-- Requester can read responses to THEIR requests (so the Requests tab
-- can show "{provider} accepted your request").
drop policy if exists "requester reads responses" on request_responses;
create policy "requester reads responses"
  on request_responses for select
  using (
    exists (
      select 1 from requests r
      where r.id = request_responses.request_id
        and r.requester_id = auth.uid()
    )
  );

commit;
