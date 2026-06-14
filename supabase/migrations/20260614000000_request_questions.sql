-- 2026-06-14 — pre-booking Q&A on an open request.
-- Lets a provider ask the requester (Connector) follow-up questions BEFORE
-- accepting (e.g. "who buys the ingredients?", "pay food costs upfront?").
-- One row per question; `reply` is filled by the request owner.
--
-- Idempotent: IF NOT EXISTS everywhere. Safe to re-run.

begin;

create table if not exists request_questions (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  asker_id    uuid not null,           -- provider asking (auth.uid)
  body        text not null,
  reply       text,
  created_at  timestamptz not null default now(),
  replied_at  timestamptz
);

create index if not exists request_questions_request_idx
  on request_questions (request_id, created_at);
create index if not exists request_questions_asker_idx
  on request_questions (asker_id, created_at desc);

alter table request_questions enable row level security;

-- Read: the asker (provider) OR the owner of the request (requester).
drop policy if exists "rq read" on request_questions;
create policy "rq read" on request_questions for select using (
  auth.uid() = asker_id
  or auth.uid() = (select requester_id from requests where id = request_id)
);

-- Insert: only as yourself, and only on a request you don't own (a provider
-- asking the requester — not the requester asking themselves).
drop policy if exists "rq insert" on request_questions;
create policy "rq insert" on request_questions for insert with check (
  auth.uid() = asker_id
  and auth.uid() <> (select requester_id from requests where id = request_id)
);

-- Update (reply): only the request owner can fill the reply.
drop policy if exists "rq reply" on request_questions;
create policy "rq reply" on request_questions for update using (
  auth.uid() = (select requester_id from requests where id = request_id)
);

select 'request_questions' as t, count(*) as c from request_questions;

commit;
