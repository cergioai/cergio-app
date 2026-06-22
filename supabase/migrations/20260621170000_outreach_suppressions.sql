-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — SPEC-65: outreach suppression list (opt-out registry).
--
-- The single source of truth for "never contact this address again." Every
-- outreach send (email now; SMS/WhatsApp later) MUST check this table first.
-- The public outreach-optout endpoint writes here on one-click unsubscribe.
-- Honoring opt-outs is a CAN-SPAM requirement (email) and basic hygiene
-- everywhere. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.outreach_suppressions (
    id          uuid primary key default gen_random_uuid(),
    channel     text not null check (channel in ('email','sms','whatsapp')),
    -- normalized address: lowercased email, or E.164 phone.
    address     text not null,
    reason      text,                          -- 'optout' | 'bounce' | 'complaint' | 'manual'
    source      text,                          -- where it came from (lead id, etc.)
    created_at  timestamptz not null default now()
);

create unique index if not exists outreach_suppressions_unique
    on public.outreach_suppressions (channel, lower(address));

-- Service-role only (outreach workers + optout fn use service key; bypasses RLS).
alter table public.outreach_suppressions enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- After running: every outreach worker filters leads against this table by
-- channel+address before sending. The outreach-optout edge function inserts a
-- row (and flips the matching lead to outreach_status='do_not_contact') the
-- instant someone clicks unsubscribe.
-- ─────────────────────────────────────────────────────────────────────────────
