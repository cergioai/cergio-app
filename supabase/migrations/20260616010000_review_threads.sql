-- Below-4★ private review dispute thread (Tarik 2026-06-15). When a Connector
-- rates a barter below 4★, the review is shared with the provider, who can
-- REPLY (sent back to the Connector to reply to) or ESCALATE to Cergio/support.
-- review_threads holds the back-and-forth; dispute_escalated_at flags a booking
-- raised to support (admin module manual now; AI resolution phase 2).
alter table public.bookings
  add column if not exists dispute_escalated_at timestamptz;

create table if not exists public.review_threads (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings(id) on delete cascade,
  sender_id     uuid not null,
  body          text not null,
  is_escalation boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists review_threads_booking_idx on public.review_threads(booking_id);

alter table public.review_threads enable row level security;

-- Either party to the booking can read the thread.
drop policy if exists review_threads_party_select on public.review_threads;
create policy review_threads_party_select on public.review_threads
  for select using (
    exists (select 1 from public.bookings b
            where b.id = booking_id
              and (b.consumer_id = auth.uid() or b.provider_id = auth.uid()))
  );

-- A party can post as themselves.
drop policy if exists review_threads_party_insert on public.review_threads;
create policy review_threads_party_insert on public.review_threads
  for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from public.bookings b
                where b.id = booking_id
                  and (b.consumer_id = auth.uid() or b.provider_id = auth.uid()))
  );
