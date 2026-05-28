# Cergio Money-Flow Test Plan

This is the rigorous E2E test plan for everything that touches money,
attribution, and notifications. The community money flows are the
spine of Cergio's value prop — they MUST be observable, traceable,
and provable end-to-end.

Written 2026-05-28 after a sweep that uncovered four missing tables /
columns + two dead application flows in production.

---

## 0. Findings from the initial audit (Chrome MCP + RLS-read probe as Tarik)

🔴 **Schema gaps** (code references that don't exist in the DB):

| What code expects | What DB has |
|---|---|
| `notifications` table | MISSING — every `notifyUser()` call silently fails |
| `rainmaker_applications` (or `connector_applications`) | MISSING — Become-Connector submit is theatre |
| `recommendations.inviter_id` column | MISSING — Recommend flow can't attribute |
| `profiles.tiktok_handle` + `tiktok_followers` | MISSING — Profile UI tries to read it |
| `profiles.role` | MISSING — minor |

🔴 **Data drift** (rows present but unusable):

- Tarik's two own services: `taxonomy_provider_type = NULL`. Both
  identical title "plumber in 10 jane street", same create timestamp
  — duplicate rows from a previous test. Neither can be searched or
  notified.
- `bookings`: 10 rows, all `status='pending'`, all same consumer
  (Tarik) → same provider (one Plumber). No completion flow has
  ever run end-to-end.
- `invites` table: 0 rows. Referral chain has never completed.
- `earnings` table: 0 rows. Money flow has never fired.

🟢 **What works:**

- `?ref=<uuid>` captured to `localStorage` correctly
- `buildInviteUrl()` produces canonical format (qa #5)
- `services_near` PostGIS RPC + strict provider_type filter (qa #6, #14)
- `getProvidersForNotify` correctly enforces `notify_safe` + verified
  provider_type (qa #4) — but it never runs because `notifications`
  insert fails before reach
- Static-import HMR-stale-closure bug closed (qa #17)

---

## 1. Schema fix — single migration

**File:** `supabase/migrations/20260528000000_money_flow_schema_fix.sql`

Creates:

```sql
-- notifications: every fan-out write goes here
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references auth.users(id) on delete cascade,
  kind         text not null,  -- 'new_request' | 'bid' | 'spotlight' | 'reco' | 'invite_credit'
  body         text not null,
  data         jsonb not null default '{}'::jsonb,  -- MUST include deep_link
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_profile_idx on notifications (profile_id, created_at desc);

-- connector_applications (alias for rainmaker_applications — name aligned to UI)
create table if not exists connector_applications (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null unique references auth.users(id) on delete cascade,
  type            text not null,  -- 'influencer' | 'local-business' | 'super-user'
  instagram_handle text,
  tiktok_handle    text,
  audience_size    integer,
  rate_card_cents  integer,
  status          text not null default 'pending', -- 'pending' | 'verified' | 'rejected'
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);

-- recommendations.inviter_id (used to attribute reco-driven earnings)
alter table recommendations
  add column if not exists inviter_id uuid references auth.users(id) on delete set null;

-- profiles.tiktok_* + role columns the UI expects
alter table profiles
  add column if not exists tiktok_handle    text,
  add column if not exists tiktok_followers integer,
  add column if not exists tiktok_verified_at timestamptz,
  add column if not exists role             text;
```

RLS policies, indexes, and triggers are in the migration file.

---

## 2. Seed graph

**File:** `Seed Money Flow Test Data.command`

Creates a small but complete social graph so flows can fire:

| Persona | Role | Why |
|---|---|---|
| **Alex** (consumer) | signed up via `?ref=Tarik` | tests F1: invite chain |
| **Connie** (connector) | Has IG @connie_fits, 8K followers, `cc_verified_at` set | tests F4, F5 |
| **Penny** (provider) | Plumber, listed, `notify_safe=true`, verified `taxonomy_provider_type='Plumber'` | tests F2 (notify fan-out) |
| **Sam** (friend) | Plain user, follows Alex | tests F3 (reco) |
| **Tarik** | existing | inviter for F1, F6 |

Each persona's UUID is captured to a local file `.test-personas.json`
that subsequent tests read. Idempotent: re-running rotates the suffix
on emails so seed never collides.

---

## 3. Seven flows + assertions

### F1 — Signup with `?ref=` writes invites row
1. Open `/?ref=<Tarik-id>` in MCP tab → assert `localStorage.cergio.ref` set
2. Sign up Alex → assert `auth.users` row created
3. Assert `invites` row: `inviter_id=Tarik, invitee_id=Alex, joined_at != null`
4. Assert `localStorage.cergio.ref` cleared (one-shot semantics)

### F2 — Search submit → notify_user fan-out → deep_link present
1. As Alex, submit "unclog my toilet" with Miami Beach address
2. Assert `ResultsScreen` renders Penny's card (paid fallback OK)
3. Probe `notifications`: rows with `kind='new_request'`,
   `profile_id=Penny.id`, `data.deep_link` not null, `data.deep_link`
   contains `?ref=Alex` (so when Penny taps through, attribution carries)
4. Assert that EVERY notified profile satisfies `notify_safe=true` AND
   has a verified `taxonomy_provider_type` matching the request

### F3 — Provider bids back, consumer sees bid notification
1. As Penny, look at her inbox (`JobsInboxScreen`) → see the new_request
2. Submit a bid (price + ETA)
3. Probe `bids` table OR `notifications` with `kind='bid'` for Alex
4. As Alex, refresh `/results` → bid appears inline in card OR in inbox

### F4 — Connector apply persists
1. As Connie, tap Become a Connector → fill type/IG/rate card → submit
2. Probe `connector_applications`: one row for Connie, status='pending'
3. Admin (or auto-verify in dev) flips status='verified'
4. ProfileScreen for Connie shows "Connector ✓" pill

### F5 — Spotlight request (IG/TT free service barter)
1. As Penny (provider), open Connie's connector profile → tap
   "Offer free service for spotlight"
2. Probe `spotlight_requests`: row with `provider_id=Penny`,
   `connector_id=Connie`, status='pending'
3. Notification fired to Connie with deep_link
4. Connie accepts → status='accepted' + notification back to Penny

### F6 — First booking after referral credits inviter
1. As Alex (the referred user), complete a booking with Penny
2. Stamp the booking with status='completed' (or whatever the flow uses)
3. Call `creditInviterOnFirstBooking(Alex.id, booking.id)` explicitly
   from the same effect that completes the booking
4. Probe `invites`: Alex's row has `first_booking_at != null`,
   `reward_cents=25000`
5. Probe `earnings`: row with `profile_id=Tarik`, `kind='invite'`,
   `amount_cents=25000`, `status='pending'`
6. Probe `notifications`: row to Tarik with `kind='invite_credit'`
7. EarningsScreen for Tarik shows $250 balance

### F7 — Recommend chain
1. As Sam (Alex's friend), receive Alex's reco share message
2. Sign up via the included `?ref=Alex` link
3. Book Penny
4. Probe `invites` + `earnings` for both Sam→Alex (level 1) and
   Sam→Tarik (level 2 if Cergio supports level-2 chain)

---

## 4. New invariants

| # | Locks |
|---|---|
| 26 | `notifications` schema present (probed via API contract test) |
| 27 | `getProvidersForNotify` query never returns rows with null `taxonomy_provider_type` |
| 28 | `services` insert path enforces non-null `taxonomy_provider_type` before status='listed' |
| 29 | `creditInviterOnFirstBooking` is called from the booking-completion path |
| 30 | `spotlight_requests` has fan-out notifications to both sides |

---

## 5. UX changes (after the money flows are green)

| Item | Plan |
|---|---|
| **Leaf logo** | Replace SVG with an organic "leaf-plus-stem" that grows/shrinks based on app activity (active fetches). Re-use the `working={true}` prop everywhere. |
| **Home copy consistency** | Sweep every "$250 / free services / Growth" string against `REWARDS` constants (#24 already locks this) |
| **Login elegance** | Trim the AuthScreen to leaf + email + password + "I'll do this later" — kill anything else above the fold |
| **House ads less intrusive** | Soften background to `bg-cr2`, drop sprout icon size, halve vertical padding |
| **SRP slow-load tied to real actions** | Status ticker reads `notifications` count + `bids` count for the open request; the "Searching → Pinging network → Negotiating → 3 bids received" line advances ONLY when new rows land. No more hardwired timing. |
| **Notification count** | Same — pulled from `notifications` table polling (or realtime channel) |
| **Profile font sizes** | Drop row title from `text-[15px]` → `text-[14px]`, subtitle from `text-[12px]` → `text-[11px]`, increase row vertical padding so it doesn't feel cramped |

---

## 6. Order of execution

1. **Migration** → user applies via existing `Apply Migrations via PAT.command`
2. **Seed** → user double-clicks `Seed Money Flow Test Data.command`
3. **Run F1–F7** via Chrome MCP + Supabase RLS reads; report per-flow PASS/FAIL
4. **Fix** every FAIL inline (notify silent-fail, services-publish gate, etc.)
5. **Lock** with invariants #26–#30
6. **UX work** (leaf / SRP / copy / login / ads / fonts)
7. **Push** → Vercel auto-deploys
8. **Re-run** F1–F7 against deployed copy to prove the chain end-to-end

Order is rigid because flows depend on earlier flows: F6 needs F1's
invite row, which needs F2's notify chain working so providers
actually see new requests.
