-- 2026-05-28 — Money-flow schema fix
--
-- The 2026-05-27 audit (TEST_PLAN_MONEY_FLOWS.md §0) found:
--   • notifications table missing → every notifyUser() silently no-ops
--   • connector_applications table missing → Become-Connector submit is theatre
--   • recommendations.inviter_id column missing → reco attribution broken
--   • profiles.tiktok_handle/_followers/_verified_at missing → ProfileScreen blank
--
-- This migration fixes all four in one shot. Each statement is
-- IDEMPOTENT (IF NOT EXISTS) so re-running is safe. RLS policies
-- intentionally generous on read where the row owner needs to see
-- it; strict on write (only the owner can insert their own rows).

begin;

-- ─── notifications ─────────────────────────────────────────────────────────
-- Every fan-out write goes here. profile_id is the recipient. kind is one of:
--   'new_request'    — a consumer's search is open + matches this provider
--   'bid'            — a provider replied/quoted on an open request
--   'spotlight'      — a Connector got a spotlight ask
--   'reco'           — a friend recommended a service for you
--   'invite_credit'  — your invitee booked; here's the credit
--
-- data MUST include 'deep_link' (qa #9 enforces in code). Schema doesn't
-- enforce so we don't break the insert path when migrations roll forward
-- ahead of code — only the code-side guard does.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_profile_created_idx
  on notifications (profile_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications (profile_id) where read_at is null;

alter table notifications enable row level security;

drop policy if exists "self read"  on notifications;
drop policy if exists "self mark"  on notifications;
drop policy if exists "self write" on notifications;
create policy "self read"  on notifications for select using (auth.uid() = profile_id);
create policy "self mark"  on notifications for update using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
-- Inserts come from server-side helpers (notifyUser). Anon clients
-- cannot insert into other people's inboxes. RLS lets the OWNER
-- write only to their own row — useful for read-receipts and local
-- self-toasts; the real fan-out happens via service_role from
-- supabase/functions/notify-user (if/when wired).
create policy "self write" on notifications for insert with check (auth.uid() = profile_id);

-- ─── connector_applications ────────────────────────────────────────────────
-- Submitting "Become a Connector" creates a row here. Status flips
-- pending → verified when admin (or auto in dev) approves the IG/TT
-- + rate card. Unique on profile_id so re-submitting updates the
-- pending row instead of creating dupes.
create table if not exists connector_applications (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null unique references auth.users(id) on delete cascade,
  type            text not null,  -- 'influencer' | 'local-business' | 'super-user'
  instagram_handle text,
  tiktok_handle    text,
  audience_size    integer,
  rate_card_cents  integer,
  status           text not null default 'pending',
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

alter table connector_applications enable row level security;

drop policy if exists "self read"  on connector_applications;
drop policy if exists "self write" on connector_applications;
create policy "self read"  on connector_applications for select using (auth.uid() = profile_id);
create policy "self write" on connector_applications for insert with check (auth.uid() = profile_id);
create policy "self upd"   on connector_applications for update using (auth.uid() = profile_id);

-- ─── recommendations.inviter_id ────────────────────────────────────────────
-- Used to attribute reco-driven earnings back to the person who
-- made the recommendation. Nullable + ON DELETE SET NULL so we
-- never lose the reco itself if the inviter's profile is wiped.
alter table recommendations
  add column if not exists inviter_id uuid references auth.users(id) on delete set null;

-- ─── profiles.tiktok_* + role ──────────────────────────────────────────────
-- ProfileScreen reads these columns directly. Without them the
-- "Connect TikTok" row 500s with `column does not exist`.
alter table profiles
  add column if not exists tiktok_handle      text,
  add column if not exists tiktok_followers   integer,
  add column if not exists tiktok_verified_at timestamptz,
  add column if not exists role               text;

-- Sanity diagnostic — counts of rows in each new/updated table.
-- Helpful sanity readback in the Dashboard SQL editor output.
select 'notifications'             as t, count(*) from notifications
union all select 'connector_applications', count(*) from connector_applications;

commit;
