// ─────────────────────────────────────────────────────────────────────────────
// Cergio E2E — the backend the browser talks to.
//
// The app under test is the REAL built bundle. Only the network edge is faked:
// every Supabase call (auth / REST / RPC / edge function) and the Nominatim
// geocoder are served from the seeded world in e2e/support/world.js.
//
// STRICT BY DESIGN: any request to an origin we did not explicitly mock is
// ABORTED and recorded, and `assertNoEscapedRequests()` fails the test. A spec
// can therefore never silently reach the real Supabase project — nor silently
// pass because a call it thought it made never happened.
// ─────────────────────────────────────────────────────────────────────────────
import { expect } from '@playwright/test';
import {
  MIAMI, SEARCH_ADDRESS, CONSUMER, PROVIDER, PENDING_BOOKING, parseResultFor,
} from './world.js';

export const SUPA_ORIGIN = 'https://seedworld.supabase.test';
// supabase-js derives its storage key from the project ref (the first hostname
// label). Keep this in step with E2E_SUPABASE_URL in playwright.config.js.
const AUTH_STORAGE_KEY = 'sb-seedworld-auth-token';

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

/** PostgREST returns a bare object (not an array) when the caller used .single(). */
const wantsSingle = (req) =>
  String(req.headers()['accept'] || '').includes('vnd.pgrst.object');

const rowsOrOne = (route, rows) => {
  const req = route.request();
  if (wantsSingle(req)) return json(route, rows[0] ?? null, rows[0] ? 200 : 406);
  return json(route, rows);
};

function sessionFixture(user) {
  return {
    access_token: 'e2e-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    // Far future: the client must never try to refresh mid-test.
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: { provider: 'email' },
      user_metadata: { display_name: user.display_name },
      created_at: '2026-06-01T00:00:00.000Z',
    },
  };
}

function profileFixture(user) {
  return {
    id: user.id,
    display_name: user.display_name,
    email: user.email,
    avatar_url: null,
    instagram_handle: null,
    instagram_followers: null,
    cc_verified_at: '2026-07-01T10:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
  };
}

/**
 * Install the seeded world.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {object} opts.world      FREE_WORLD | PAID_WORLD (services + offerings)
 * @param {object} [opts.parse]    the chat-parse result (what/when/where/budget)
 * @param {object} [opts.user]     who is signed in (defaults to the consumer)
 * @param {object} [opts.booking]  the booking /request/:id serves
 * @returns {{escaped: string[], writes: object[]}} live record of what the app did
 */
export async function installWorld(page, {
  world,
  parse = parseResultFor({ when: 'tomorrow' }),
  user = CONSUMER,
  booking = PENDING_BOOKING,
} = {}) {
  const escaped = [];               // requests to origins we never mocked
  const writes = [];                // every mutation the app actually sent
  const state = { booking: { ...booking } };

  // A signed-in session, before any app code runs.
  await page.addInitScript(([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session));
    // Quiet the app's own console diagnostics so a failure trace is readable.
    window.__cergioDiag = false;
  }, [AUTH_STORAGE_KEY, sessionFixture(user)]);

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { origin, pathname } = url;
    const method = req.method();

    // The app itself + its assets.
    if (origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost')) {
      return route.continue();
    }

    // The geocoder. verifyAddress() has no Google key in CI, so it falls through
    // to Nominatim — which is exactly the tier the live app uses when GCP is
    // misconfigured. We answer with the address the user typed, unchanged.
    if (origin.includes('nominatim.openstreetmap.org')) {
      return json(route, [{
        lat: String(MIAMI.lat), lon: String(MIAMI.lng),
        display_name: SEARCH_ADDRESS, osm_type: 'node', osm_id: '1',
      }]);
    }

    if (origin !== SUPA_ORIGIN) {
      escaped.push(`${method} ${req.url()}`);
      return route.abort('blockedbyclient');
    }

    // CORS preflight.
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
        body: '',
      });
    }

    // ── auth ────────────────────────────────────────────────────────────────
    if (pathname.startsWith('/auth/v1/user'))   return json(route, sessionFixture(user).user);
    if (pathname.startsWith('/auth/v1/token'))  return json(route, sessionFixture(user));
    if (pathname.startsWith('/auth/v1/logout')) return json(route, {});
    if (pathname.startsWith('/auth/v1/'))       return json(route, {});

    // ── edge functions ──────────────────────────────────────────────────────
    if (pathname === '/functions/v1/chat-parse') {
      writes.push({ kind: 'chat-parse', body: req.postDataJSON?.() ?? null });
      return json(route, parse);
    }
    if (pathname.startsWith('/functions/v1/')) {
      writes.push({ kind: 'edge', fn: pathname.split('/').pop(), body: safeBody(req) });
      return json(route, { ok: true });
    }

    // ── RPC ─────────────────────────────────────────────────────────────────
    if (pathname === '/rest/v1/rpc/services_near') {
      // Proximity search: PostgREST returns only the proximity columns — api.js
      // then re-fetches the full rows by id. Mirror that contract exactly.
      return json(route, world.services.map(s => ({
        id: s.id, title: s.title, location_text: s.location_text, distance_miles: 1.4,
      })));
    }
    if (pathname.startsWith('/rest/v1/rpc/')) {
      writes.push({ kind: 'rpc', fn: pathname.split('/').pop(), body: safeBody(req) });
      return json(route, []);
    }

    // ── tables ──────────────────────────────────────────────────────────────
    if (pathname === '/rest/v1/services') {
      return json(route, world.services.map(({ offerings: _o, ...row }) => row));
    }
    if (pathname === '/rest/v1/offerings') {
      return json(route, world.services.flatMap(s => s.offerings));
    }
    if (pathname === '/rest/v1/profiles') {
      return rowsOrOne(route, [profileFixture(user), profileFixture(PROVIDER)]);
    }
    if (pathname === '/rest/v1/bookings') {
      if (method === 'PATCH') {
        const patch = safeBody(req) || {};
        // The REAL write the provider's Accept must produce. The spec asserts on
        // this — a screen that only repaints its own state cannot fake it.
        writes.push({ kind: 'booking.update', patch });
        state.booking = { ...state.booking, ...patch };
        return rowsOrOne(route, [state.booking]);
      }
      return rowsOrOne(route, [state.booking]);
    }
    if (pathname === '/rest/v1/requests' && method === 'POST') {
      writes.push({ kind: 'request.insert', body: safeBody(req) });
      // Deliberately NO id back: ResultsScreen suppresses the paid-fallback
      // banner whenever a requestId exists, so returning one would make the
      // banner assertions vacuous. This keeps the banner ELIGIBLE to render —
      // and the specs then prove when it does and does not.
      return json(route, []);
    }

    // Every other table read: empty. An empty table is a legitimate world state
    // (no recos, no notifications yet) — and it is never mistaken for success,
    // because each spec asserts on something it explicitly seeded.
    if (pathname.startsWith('/rest/v1/')) {
      if (method !== 'GET') writes.push({ kind: 'write', path: pathname, body: safeBody(req) });
      return rowsOrOne(route, []);
    }

    escaped.push(`${method} ${req.url()}`);
    return route.abort('blockedbyclient');
  });

  return {
    escaped,
    writes,
    /** The booking as the fake database now holds it (after any PATCH). */
    booking: () => state.booking,
  };
}

function safeBody(req) {
  try { return req.postDataJSON(); } catch { return req.postData?.() ?? null; }
}

/** No request may escape to an origin we did not mock. */
export function assertNoEscapedRequests(net) {
  expect(net.escaped, `the app reached an un-mocked origin: ${net.escaped.join(', ')}`).toEqual([]);
}

/** Type a query into Home and send it. */
export async function searchFromHome(page, query) {
  await page.goto('/home');
  const box = page.locator('textarea').first();
  await expect(box).toBeVisible();
  await box.fill(query);
  await page.getByRole('button', { name: 'Search' }).click();
  // Home runs its narration ticker, then routes to /results.
  await page.waitForURL('**/results', { timeout: 30_000 });
}
