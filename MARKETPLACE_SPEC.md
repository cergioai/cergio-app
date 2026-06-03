# Cergio Marketplace Spec — Notify → Confirm → Show

Authoritative spec capturing Tarik's directive on 2026-06-02:

> "the spec is that services get notified and confirm ability to offer
> free services (which then has them show up in the results) … it's
> not like a search. All results need to have 'confirmed availability
> + confirmed ability to do service for free' (or added a price to
> counter). Same the other way around (services requesting free
> spotlights from Connectors). For testing, need to see the services
> being notified, accepting, then their profiles showing up. Same
> for Connectors."

---

## 1. The two flows

### A. Consumer requests a service (find side)

```
┌─────────────┐
│  Consumer   │ posts request: "I need a plumber, free if possible,
└──────┬──────┘                  Brickell, $80 budget"
       │
       ▼
┌─────────────────────────────────────────────┐
│  createRequestAndFanOut → notifications     │
│    every matching provider gets pinged      │
│    (filter: provider_type exact + radius)   │
└──────┬──────────────────────────────────────┘
       │
       ▼
┌────────────┐    ┌────────────┐    ┌────────────┐
│ Provider 1 │    │ Provider 2 │    │ Provider 3 │
│ ACCEPT     │    │ COUNTER    │    │ DECLINE    │
│ free       │    │ $40        │    │            │
└─────┬──────┘    └─────┬──────┘    └─────┬──────┘
      │                 │                 │
      ▼                 ▼                 ▼
      writes a request_response row (NEW table)
       status='offered', price_cents, message
       │
       ▼
┌─────────────────────────────────────────────┐
│  Consumer's Results screen shows ONLY       │
│  providers who responded with 'offered'.    │
│  Each card = a confirmed available slot.    │
└─────────────────────────────────────────────┘
```

### B. Service requests a free spotlight (provider side)

Mirror image. Same `request_response` mechanism, role-flipped:

```
Service "Carla Clean" → posts: "free spotlight in exchange for IG/TT mention"
  │
  ▼
fanout via spotlight_requests → notifications to in-range Connectors
  │
  ▼
Connectors ACCEPT / COUNTER (cash price) / DECLINE
  │
  ▼
Service's "browse Connectors" screen shows ONLY confirmed responders.
```

---

## 2. Schema additions (proposed)

### `request_responses` (new table)

```sql
CREATE TABLE request_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid REFERENCES requests(id) ON DELETE CASCADE,
  responder_id    uuid REFERENCES profiles(id),          -- the provider
  service_id      uuid REFERENCES services(id),
  status          text CHECK (status IN ('offered', 'declined', 'withdrawn')),
  offered_price_cents int,
  message         text,
  responded_at    timestamptz DEFAULT NOW(),
  -- enforced by trigger: one row per (request_id, responder_id, service_id)
  UNIQUE (request_id, responder_id, service_id)
);
```

Mirrors `spotlight_requests`' status flow; we can later add `paid_at`,
`posted_at` etc. when the service↔Connector exchange ships.

**RLS**:
- The consumer who owns the request can SELECT all responses on it.
- The responder can SELECT + INSERT their own row.
- No one else.

---

## 3. UI surfaces to build

### Provider's inbox (existing `JobsInboxScreen`)

A new tab or row treatment for incoming **Requests** (vs the existing
Bookings). Each row:

```
┌──────────────────────────────────────────┐
│ 🛡 New request · Plumber                 │
│ Tarik · Brickell · today · $80 budget    │
│ "leaky kitchen faucet, needs same-day"   │
│                                          │
│ [Accept for $0]  [Counter $X]  [Decline] │
└──────────────────────────────────────────┘
```

Accept writes `request_responses (status='offered', offered_price_cents=0)`.
Counter opens a tiny modal: price input → writes status='offered' with
the typed price. Decline writes status='declined'.

### Consumer's Results (existing `ResultsScreen`)

Today's `listServices` returns ALL matching services. After this spec
ships, the data source becomes:

  ```
  SELECT s.*, rr.offered_price_cents, rr.message
  FROM request_responses rr
  JOIN services s ON s.owner_id = rr.responder_id
  WHERE rr.request_id = $current_request
    AND rr.status = 'offered'
  ```

Cards then show:
- The confirmed price (might be different from listed)
- "Accept" / "Pick this one" CTA (which becomes the booking)
- No more "Book" race condition — the consumer is just picking among
  pre-confirmed offers.

### Connector's inbox (existing `ConnectorRequestsScreen`)

Already does the role-flipped version for paid spotlights. Extend to
free-spotlight requests using the same `request_responses` mechanism.

---

## 4. Ranking (SHIPPED 2026-06-02 in `src/lib/rankResults.js`)

Even before the responses table lands, the ranking is now live for the
existing `listServices` output. Six tiers (highest first):

  T1   friend_recos ≥ 1   AND  within_budget
  T2   friend_recos ≥ 1   AND  NOT within_budget
  T3   connector_recos ≥ 1 AND within_budget
  T4   connector_recos ≥ 1 AND NOT within_budget
  T5   no recos             AND within_budget
  T6   everything else

Within a tier:
  friend_count DESC > connector_count DESC > rating DESC > price ASC > distance ASC

When `wantFree=true`:
  • Free services come BEFORE paid ones, full stop.
  • Within free, the same T1..T6 ordering applies.
  • Paid options follow as a fallback band so the page is never empty,
    but they sit below all free ones regardless of recos.

First item gets the `pick = true` flag (Cergio's Pick badge).

### Worked example (Tarik's example)

Two services in the result set:
  - Service A: 1 friend reco, price $150 (over $100 budget)
  - Service B: 0 friend recos, price $80 (within $100 budget)

→ A ranks ABOVE B (friend reco overrides budget for the pick).

Now add a third:
  - Service C: 1 friend reco, price $90 (within budget)

→ Order becomes C > A > B (C is T1 because friend AND within budget;
   A is T2 because friend but over budget; B is T5).

This matches Tarik's literal example: "a service with ≥1 friend reco
+ within budget ranks HIGHER than a service with more friend recos but
over budget."

---

## 5. Testing the loop

Until the `request_responses` table lands, the "confirmed availability"
gate is bypassed and `listServices` results are ranked directly. The
ranking is unit-testable today via:

  ```
  import { rankResults, classifyTier } from './lib/rankResults';
  rankResults(services, { budgetCents: 10000, wantFree: false });
  ```

A future `E2E Request Confirm Flow.command` should:

  1. Seed a fresh consumer (`req-consumer@cergio.test`)
  2. Seed 3 providers with varying friend/connector reco counts + prices.
  3. POST a request → assert 3 notifications fan out.
  4. UPDATE 2 of the 3 notifications' responses (one accept, one counter,
     one untouched).
  5. SELECT request_responses for the consumer → assert 2 rows.
  6. Run ranking on the 2 → assert the friend-reco within-budget one is
     position 0 (Cergio's Pick).

---

## 6. Decisions — Tarik 2026-06-02

### Q1. Notification cadence — ROLLING (resolved YES)

Providers do NOT get a single one-shot ping. Cergio keeps the request
"open" and broadcasts in expanding waves until the stop condition
hits. Initial ping covers the warm tier (friend network + Connectors
+ in-network providers that match the request); subsequent waves pull
from progressively colder tiers.

### Q2. Counter loop — TWO-ROUND (resolved YES, mirror spotlight flow)

The consumer can counter the provider's counter, exactly the way the
existing spotlight flow lets the Connector counter back. Status
machine:

```
offered ──counter──> countered ──counter back──> countered'
                                  └─accept─> accepted
                                  └─decline─> declined
```

`last_counter_by` enum (`'provider' | 'consumer'`) stamps whose turn
it is so the UI never asks the wrong side to act.

### Q3. Time-decay — WEIGHT `responded_at` (resolved YES)

`time_to_offer = responded_at − created_at`. Faster offers rank
higher within their tier. Initial implementation: linear penalty —
each 10 minutes of latency knocks the row down ~1 slot within its
tier (only as a tiebreaker; tier still wins over time). Log the
metric in `request_responses.time_to_offer_seconds` for future ML
tuning.

### Q4. No-response handling — ROLLING BROADCAST through cold tiers (resolved: NO to listServices fallback)

The "unconfirmed listServices fallback" idea is REJECTED. Instead,
Cergio rolls outward through a large database of connected providers
(and Connectors / influencers on the spotlight side) at a steady
cadence until either:

  • 1 top pick + 2 alternatives are confirmed (3 confirmed offers
    total), or
  • the user accepts one of the already-confirmed offers.

#### Cadence (proposed default — tunable per category)

```
T+0      Wave 1: 10 warmest matches (friends, Connectors, in-network)
T+2 min  Wave 2: next 10 (extended-network + nearby high-rating)
T+4 min  Wave 3: next 10 (cold contacts within radius)
T+6 min  Wave 4: next 10 (cold contacts within wider radius)
…        keep going every 2 minutes until stop condition hits
```

Stop conditions (whichever fires first):

  S1. `≥1` confirmed top pick (T1 ranking) AND `≥2` confirmed
      alternatives → freeze the broadcast, surface the 3 on the
      consumer's Results page.
  S2. User accepts one of the confirmed offers → cancel any in-flight
      waves, write `accepted` on the chosen response, write `withdrawn`
      on the rest of THAT consumer's open responses.
  S3. Hard cap at 60 minutes — anything still open writes `expired`.

#### Provider database — "cold contact" tier (registered + CRAWLED)

Per Tarik (2026-06-02): "the app will be connected not only to
registered users but all users crawled from services side and
influencers (connectors from instagram) so we use new requests to
convert more."

A new column on `services` (or a sister table) tags each row with
`outreach_tier`:

  - `network`            — friend or Connector network of the consumer
  - `verified_local`     — registered, in radius, has bookings/reviews
  - `cold_local_user`    — registered, in radius, no bookings yet
  - `cold_crawled_local` — UNREGISTERED, scraped from services side
                           (Yelp / Google Maps / public directories),
                           has phone/email but no Cergio account
  - `cold_crawled_ig`    — UNREGISTERED Instagram influencer
                           (Connector candidate) — has handle +
                           follower count, no account
  - `cold_extended`      — anything (registered or crawled) outside
                           primary radius (next ring of waves)

Waves pull tiers in order:

```
network → verified_local → cold_local_user → cold_crawled_local
        → cold_crawled_ig → cold_extended
```

The crawled tiers are sourced from the existing crawler infrastructure
(see `Services Crawl/` and `Influence Crawler` outputs — the
`services_leads.db` + `influencers.db` SQLite stores Tarik built
earlier). A pre-publish job promotes rows from those stores into
`services` (or a `prospects` table) with `outreach_tier='cold_crawled_*'`
and the contact channel they were scraped with.

The rolling broadcast IS the first ping these prospects receive. The
request reach-out becomes the user-acquisition surface.

#### User acquisition via broadcast (NEW — converts cold → registered)

When a wave dispatcher writes a notification for a `cold_crawled_*`
prospect, the notification can't be in-app (they have no account).
Instead it's an outbound message — SMS or email, depending on which
channel was scraped — with shape:

```
Hi {first_name}, a Cergio customer just requested a {provider_type}
in {city}: "{short_request_text}". Budget: {budget}. Free if you can
offer it / paid otherwise.

Reply YES to claim this job →  https://cergio.ai/claim/{token}
(2-tap: opens the app, creates your account, surfaces the open
request, you accept/counter/decline.)
```

The `{token}` is a single-use signed link that:

  1. Lands on `/claim/:token` route (new screen).
  2. Pre-fills the signup form with the scraped name + contact.
  3. On completion, attaches the new account to the existing
     `request_responses` row (status flips to `offered` with the
     account now backing it).
  4. The user lands on their /inbox with the open request already
     visible — Accept / Counter / Decline.

Attribution: every successful conversion writes an `acquisitions` row
{ prospect_id, became_user_id, source_request_id, wave_n, accepted_at }
so we can measure the funnel — pings sent vs claimed vs converted vs
first-booked.

**Out of scope for this commit:** the separate "full outreach
program" Tarik referenced — that's a bigger UA pipeline (multi-touch
sequences, drip campaigns, paid amplification) that will roll out
after the rest of the marketplace UX is locked. The broadcast hook
above is the minimum viable acquisition surface; the full program
will plug into the same `acquisitions` ledger when it ships.

#### Cadence note (sensitive channels)

SMS / email to crawled prospects is rate-limited per phone/email
per 30-day window so a single prospect isn't pinged by every
plumber request in their city. Default: max 1 outbound per
prospect per 7 days, regardless of how many requests would
otherwise match.

#### Per-wave notifications

Each wave writes a `notifications` row with `kind='request_wave_N'`
so we can later audit "did wave N actually go out?" and time-decay
ranking can know which wave the response came from.

#### UI surface (consumer)

While broadcast is rolling, Results shows:

```
┌────────────────────────────────────────────┐
│ ⏳ Cergio is asking providers…             │
│ 18 pinged · 4 confirmed so far · 2:14 mins │
│                                            │
│ ★ Cergio's Pick (top-tier match confirmed) │
│   [provider card]                          │
│                                            │
│ Other confirmed options:                   │
│   [provider card]                          │
│   [provider card]                          │
│                                            │
│ Waiting on N more responses…               │
└────────────────────────────────────────────┘
```

Once S1 hits, the spinner stops, the "Waiting on N more responses…"
line disappears, and the 3 picks become tappable. Until then, the
consumer can accept early (skips remaining waves).

---

## 7. Implementation order (sequenced)

   Step 1: `request_responses` schema migration (table + RLS + indexes).
   Step 2: Provider's inbox Accept / Counter / Decline buttons writing
           to `request_responses`.
   Step 3: ResultsScreen reads from `request_responses` for the active
           request; applies the existing rankResults on top.
   Step 4: Wave dispatcher — a small Supabase edge function or cron
           that walks tier order and writes notifications + tracks
           wave counts on the requests row.
   Step 5: Counter loop UI (consumer counter button on Results card).
   Step 6: `outreach_tier` column on services + the cold-contact
           database seed (registered tiers only — cold_local_user
           + verified_local).
   Step 7: Time-decay weighting in rankResults (per S3 above).
   Step 8: Stop condition runner — a server side check that flips the
           request to `closed` when S1 / S2 / S3 fires.
   Step 9: `prospects` table + import pipeline from `services_leads.db`
           and `influencers.db`, populating `cold_crawled_local` and
           `cold_crawled_ig` tiers.
   Step 10: SMS/email outbound channel for crawled tiers — Twilio /
            Resend wiring, per-prospect rate limiter (1 per 7 days),
            template renderer using the existing reward / branding
            copy from REWARD_COPY.
   Step 11: `/claim/:token` signed-link landing screen — single-use
            signup with prefilled scraped fields, attaches the new
            account to the open `request_responses` row.
   Step 12: `acquisitions` ledger + a follow-up audit script
            (Audit Outreach Funnel.command) tracking pings sent /
            claimed / converted / first-booked.

Steps 1-8 ship the registered-user marketplace. Steps 9-12 layer
the user-acquisition-via-broadcast loop on top, on the same
`request_responses` substrate.

The separate full outreach program — multi-touch drip sequences,
paid amplification, broader UA campaigns — is acknowledged here as a
future workstream and will plug into the `acquisitions` ledger above
when it ships. No spec yet; that conversation comes after the rest of
the marketplace UX lands.

Each step ships its own commit + audit script update.
