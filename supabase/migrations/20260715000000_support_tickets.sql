-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — HELP / SUPPORT module (increment 1).
--
-- Installs the two tables the in-app Help widget + AI triage ladder write to,
-- the founder-inbox read fn ops-metrics merges into the dashboard, and the
-- `crack-help-haiku` requirement-ledger row (flips open→verified when the
-- spec-crack-help-haiku regression test is green on main).
--
-- ADDITIVE · IDEMPOTENT · REVERSIBLE — never drops or rewrites a real row.
-- Safe to re-run. No secrets: RESEND / ANTHROPIC / service-role live in env.
--
-- Tables:
--   support_tickets  — one row per help request (logged-in OR logged-out).
--   support_messages — the back-and-forth thread (user / ai / founder).
--
-- Auth model (mirrors the app's admin-email gate, lib/api.js ADMIN_EMAILS):
--   • a user sees ONLY their own tickets (user_id = auth.uid())
--   • a founder/admin (email in the admin set) sees ALL tickets
--   • logged-out submits are allowed (user_id null) — the triage function
--     answers by email; the row is service-role owned thereafter.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 0. ADMIN PREDICATE ────────────────────────────────────────────────────────
-- The single source of truth for "is the caller a Cergio admin?", read from the
-- verified JWT email claim. Kept byte-identical to lib/api.js ADMIN_EMAILS and
-- the edge functions' DEFAULT_ADMINS. STABLE + SECURITY DEFINER so RLS can call
-- it cheaply. Adding an admin later = one CREATE OR REPLACE (reversible).
create or replace function public.cergio_is_admin()
returns boolean language sql stable security definer
set search_path = public as $fn$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
         in ('t@cergio.ai', 'info@cergio.ai');
$fn$;

grant execute on function public.cergio_is_admin() to anon, authenticated, service_role;

-- ── 1. SUPPORT TICKETS ────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,  -- null = logged-out submit
  email          text,                                                -- contact address (required for logged-out)
  subject        text not null default '',
  body           text not null default '',
  screenshot_url text,                                                -- nullable — optional upload
  status         text not null default 'new'
                 check (status in ('new', 'ai_resolved', 'escalated', 'human', 'closed')),
  ai_stage       text check (ai_stage in ('haiku', 'opus', 'human')), -- which brain last touched it
  ai_reply       text,                                                -- the AI's answer (also mirrored into support_messages)
  ai_reason      text,                                                -- why it escalated / needs a human
  handled_by     text,                                                -- 'ai' | founder email
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

-- Re-runnable column adds (in case an older shape pre-existed).
alter table public.support_tickets add column if not exists user_id        uuid;
alter table public.support_tickets add column if not exists email          text;
alter table public.support_tickets add column if not exists screenshot_url text;
alter table public.support_tickets add column if not exists ai_stage       text;
alter table public.support_tickets add column if not exists ai_reply       text;
alter table public.support_tickets add column if not exists ai_reason      text;
alter table public.support_tickets add column if not exists handled_by     text;
alter table public.support_tickets add column if not exists resolved_at    timestamptz;

create index if not exists support_tickets_user_idx    on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_idx  on public.support_tickets (status, created_at desc);
-- The founder's open queue: fast lookup of the human-needed pile.
create index if not exists support_tickets_human_idx   on public.support_tickets (created_at desc)
  where status in ('human', 'escalated', 'new');

-- ── 2. SUPPORT MESSAGES (thread) ──────────────────────────────────────────────
create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  sender     text not null check (sender in ('user', 'ai', 'founder')),
  body       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

-- Tickets: a user reads only their own; an admin reads all.
drop policy if exists "support_tickets self+admin read"   on public.support_tickets;
create policy "support_tickets self+admin read" on public.support_tickets
  for select using (auth.uid() = user_id or public.cergio_is_admin());

-- Insert: anyone may open a ticket, but may NOT forge a user_id that isn't
-- theirs. Logged-out (user_id null) is allowed; a signed-in user may only
-- stamp their own uid. (Anon submits land as service-role-owned rows.)
drop policy if exists "support_tickets insert" on public.support_tickets;
create policy "support_tickets insert" on public.support_tickets
  for insert with check (user_id is null or auth.uid() = user_id);

-- Update: ONLY an admin (founder inbox reply/close) via the anon/authenticated
-- key path. The triage function uses the service role and bypasses RLS. Users
-- can never mutate a ticket's status/AI fields from the client.
drop policy if exists "support_tickets admin update" on public.support_tickets;
create policy "support_tickets admin update" on public.support_tickets
  for update using (public.cergio_is_admin());

-- Messages: readable to the ticket owner or an admin.
drop policy if exists "support_messages read" on public.support_messages;
create policy "support_messages read" on public.support_messages
  for select using (
    public.cergio_is_admin()
    or exists (
      select 1 from public.support_tickets t
       where t.id = support_messages.ticket_id and t.user_id = auth.uid()
    )
  );

-- Message insert: a founder posts sender='founder' on any ticket; a signed-in
-- user may post sender='user' on their OWN ticket (a follow-up). The AI's rows
-- (sender='ai') are written by the service-role triage fn only — never a client.
drop policy if exists "support_messages insert" on public.support_messages;
create policy "support_messages insert" on public.support_messages
  for insert with check (
    (public.cergio_is_admin() and sender = 'founder')
    or (
      sender = 'user'
      and exists (
        select 1 from public.support_tickets t
         where t.id = support_messages.ticket_id and t.user_id = auth.uid()
      )
    )
  );

-- Grants (RLS still governs row visibility; these open the table to the API).
grant select, insert on public.support_tickets  to anon, authenticated;
grant update          on public.support_tickets  to authenticated;   -- admin-only via RLS
grant select, insert on public.support_messages to anon, authenticated;
grant all            on public.support_tickets  to service_role;
grant all            on public.support_messages to service_role;

-- ── 4. FOUNDER-INBOX READ FN (ops-metrics merges this into the dashboard) ─────
-- Counts by status + the open human-queue list (needs a human, newest first).
-- SECURITY DEFINER so the public ops-metrics fn (service-role) resolves it; it
-- returns aggregate counts + the queue the founder must action. No third-party
-- PII beyond the contact email the user themselves supplied.
create or replace function public.cergio_support_summary()
returns jsonb language plpgsql security definer
set search_path = public as $fn$
declare res jsonb;
begin
  select jsonb_build_object(
    'generated_at', now(),
    'counts', jsonb_build_object(
      'new',         (select count(*) from public.support_tickets where status = 'new'),
      'ai_resolved', (select count(*) from public.support_tickets where status = 'ai_resolved'),
      'escalated',   (select count(*) from public.support_tickets where status = 'escalated'),
      'human',       (select count(*) from public.support_tickets where status = 'human'),
      'closed',      (select count(*) from public.support_tickets where status = 'closed'),
      'open_total',  (select count(*) from public.support_tickets where status in ('new','escalated','human'))
    ),
    -- The founder's action list: tickets a human must handle, newest first.
    'human_queue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'subject', subject, 'email', email, 'status', status,
        'ai_stage', ai_stage, 'ai_reason', ai_reason, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from (
        select id, subject, email, status, ai_stage, ai_reason, created_at
          from public.support_tickets
         where status in ('human', 'escalated')
         order by created_at desc
         limit 25
      ) q
    )
  ) into res;
  return res;
end $fn$;

grant execute on function public.cergio_support_summary() to anon, authenticated, service_role;

-- ── 5. REQUIREMENT LEDGER — crack-help-haiku ──────────────────────────────────
-- Registered as 'built' now; the spec-crack-help-haiku regression test in
-- scripts/qa.mjs flips it to 'verified' once green on main (auto-build.mjs
-- reads the spec-<id> prefix). Guarded so this migration is safe even if the
-- requirements ledger migration hasn't been applied yet.
do $$
begin
  if exists (select 1 from information_schema.routines
              where routine_schema='public' and routine_name='cergio_open_requirement') then
    perform public.cergio_open_requirement(
      'crack-help-haiku',
      'In-app Help/support: a floating Help entry opens a ticket; support-triage runs the Haiku→Opus→human ladder; the AI is reply-only (never account/money/data actions); human-needed tickets notify the founder and surface on the dashboard.',
      'SPEC-72 / support', 'support', 'founder', 'built');
  end if;
end $$;

-- ── 5b. SUPPORT SCREENSHOT STORAGE BUCKET (optional attachments) ──────────────
-- Public-read bucket for the optional Help-widget screenshot. Guarded so this
-- migration is safe on any environment; if the storage extension isn't present
-- the whole block is skipped and screenshots simply degrade to a follow-up.
-- Reversible: drop the bucket + policies to remove.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='storage' and table_name='buckets') then
    insert into storage.buckets (id, name, public)
    values ('support-screenshots', 'support-screenshots', true)
    on conflict (id) do nothing;

    -- Anyone (incl. logged-out) may upload a support screenshot; public read.
    drop policy if exists "support screenshots insert" on storage.objects;
    create policy "support screenshots insert" on storage.objects
      for insert to anon, authenticated
      with check (bucket_id = 'support-screenshots');

    drop policy if exists "support screenshots read" on storage.objects;
    create policy "support screenshots read" on storage.objects
      for select using (bucket_id = 'support-screenshots');
  end if;
end $$;

-- ── 6. VERIFY (harmless SELECTs, safe to leave in) ────────────────────────────
select 'support module installed' as step,
       (select count(*) from public.support_tickets)  as tickets,
       (select count(*) from public.support_messages) as messages;

commit;
