// ─────────────────────────────────────────────────────────────────────────────
// Cergio E2E — THE SEEDED WORLD.
//
// The same cast as scripts/seed-test-world.mjs (consumer / provider / connector
// in Miami, real lat+lng so proximity search returns rows, a free offering and a
// paid one, a pending booking to accept). Held here as plain data so the browser
// specs are hermetic: no secrets, no network, no chance of touching prod.
//
// Two WORLDS, because the highest-value assertions need a control:
//   • FREE_WORLD  — a $0 offering exists nearby. The paid-fallback banner must
//                   NOT appear. (The regression: a false "no free X nearby".)
//   • PAID_WORLD  — no $0 offering exists. The banner MUST appear. (The control
//                   that proves the assertion above is not vacuous — a screen
//                   that never renders the banner would pass the first test and
//                   fail this one.)
// ─────────────────────────────────────────────────────────────────────────────

export const MIAMI = { lat: 25.7617, lng: -80.1918 };

// The address the user types. Every assertion about "the address persists" is
// about THIS string surviving the parse → request → results hop intact.
export const SEARCH_ADDRESS = '1200 Brickell Ave, Miami, FL 33131';
export const SEARCH_CITY = 'Miami';

export const CONSUMER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'seed.consumer@cergio.test',
  display_name: 'Seed Consumer',
};

export const PROVIDER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'seed.provider@cergio.test',
  display_name: 'Marisol the Plumber',
};

/** A listed Miami plumber. `offerings` decide free-vs-paid — the REAL client-side
 *  filter in src/lib/api.js (applyMatchingFilters) reads price_cents, so the app,
 *  not the fixture, decides what the user sees. */
function plumber(offerings) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    owner_id: PROVIDER.id,
    title: 'Marisol — Mobile Plumbing',
    category: 'Plumbing',
    description: 'Licensed mobile plumber. Leaks, clogs, water heaters.',
    location_text: 'Brickell, Miami, FL',
    photo_class: 'plumbing',
    cover_url: null,
    rating_avg: 4.9,
    rating_count: 32,
    bookings_count: 18,
    status: 'listed',
    created_at: '2026-06-01T12:00:00.000Z',
    taxonomy_category: 'Home Services',
    taxonomy_provider_type: 'Plumber',
    taxonomy_offering_id: 'plumbing.leak_repair',
    service_area_geojson: null,
    lat: MIAMI.lat,
    lng: MIAMI.lng,
    offerings,
  };
}

const FREE_OFFERING = {
  id: 'aaaaaaa1-0000-4000-8000-000000000001',
  service_id: '33333333-3333-4333-8333-333333333333',
  name: 'Leak check — free for friends of Connectors',
  kind: 'session',
  price_cents: 0,
  duration_minutes: 60,
  is_default: true,
  taxonomy_offering_id: 'plumbing.leak_repair',
};

const PAID_OFFERING = {
  id: 'aaaaaaa1-0000-4000-8000-000000000002',
  service_id: '33333333-3333-4333-8333-333333333333',
  name: 'Leak repair',
  kind: 'session',
  price_cents: 12000,
  duration_minutes: 90,
  is_default: false,
  taxonomy_offering_id: 'plumbing.leak_repair',
};

/** A $0 offering IS on the books nearby → the paid-fallback banner must not show. */
export const FREE_WORLD = {
  name: 'free-available',
  services: [plumber([FREE_OFFERING, PAID_OFFERING])],
};

/** No $0 offering anywhere → freeOnly returns zero, the app re-queries paid, and
 *  the honest "no free … showing paid options" banner MUST appear. */
export const PAID_WORLD = {
  name: 'paid-only',
  services: [plumber([PAID_OFFERING])],
};

/** Nobody nearby yet. This is the world the instant-vs-scheduled copy lives in:
 *  ResultsScreen only shows the "how long this will take" line while no offer has
 *  landed. An empty world keeps that line on screen and the assertion honest. */
export const EMPTY_WORLD = { name: 'no-matches', services: [] };

/**
 * A calendar date ~N days out, phrased the way a user types it ("august 5th").
 * COMPUTED, never hard-coded: a literal date would silently decay into a false
 * red once the clock passed it — the exact "a clock, not a regression" trap that
 * qa #47j was written to kill.
 */
export function calendarDateInDays(days = 30, now = new Date()) {
  const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const month = d.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const day = d.getDate();
  const th = (day % 10 === 1 && day !== 11) ? 'st'
    : (day % 10 === 2 && day !== 12) ? 'nd'
    : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  return `${month} ${day}${th}`;
}

/** The pending booking a provider accepts. Shaped exactly like getBooking()'s
 *  PostgREST embed (consumer / provider / service / offering). */
export const PENDING_BOOKING = {
  id: '44444444-4444-4444-8444-444444444444',
  consumer_id: CONSUMER.id,
  provider_id: PROVIDER.id,
  service_id: '33333333-3333-4333-8333-333333333333',
  offering_id: PAID_OFFERING.id,
  status: 'pending',
  price_cents: 12000,
  scheduled_at: '2026-08-05T15:00:00.000Z',
  schedule_confirmed_at: null,
  address_text: SEARCH_ADDRESS,
  notes: 'Kitchen sink is leaking under the cabinet.',
  created_at: '2026-07-13T10:00:00.000Z',
  updated_at: '2026-07-13T10:00:00.000Z',
  consumer: {
    id: CONSUMER.id,
    display_name: CONSUMER.display_name,
    instagram_handle: null,
    instagram_followers: null,
    cc_verified_at: '2026-07-01T10:00:00.000Z',
  },
  provider: { id: PROVIDER.id, display_name: PROVIDER.display_name },
  service: {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Marisol — Mobile Plumbing',
    category: 'Plumbing',
    description: 'Licensed mobile plumber.',
    photo_class: 'plumbing',
    location_text: 'Brickell, Miami, FL',
  },
  offering: {
    id: PAID_OFFERING.id,
    name: PAID_OFFERING.name,
    kind: 'session',
    price_cents: 12000,
    duration_minutes: 90,
  },
};

/** What the chat-parse edge function returns for a given `when` phrase. The
 *  journey is identical; only the time horizon changes — which is precisely the
 *  branch under test. */
export function parseResultFor({ what = 'plumber', when, where = SEARCH_ADDRESS, budget = '$200' }) {
  return {
    parsed: { what, when, where, budget },
    _resolver: {
      provider_type: 'Plumber',
      category: 'Home Services',
      offering_id: 'plumbing.leak_repair',
      source: 'e2e-mock',
    },
    quick_replies: [],
  };
}
