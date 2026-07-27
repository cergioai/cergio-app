// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 4 — the INBOUND Connector-request loop (the Miami founding-cohort loop).
//
// request-accept.spec.js proves the DIRECT-booking path (/request/:id on the
// `bookings` table). This spec proves the OTHER, higher-stakes screen: a
// Connector sends a free request to a provider, who accepts it at
// /inbound/:reqId (RequestFromConnectorScreen). Until now that path had NO e2e —
// a well-shaped STUB could satisfy every qa.mjs grep while the Accept button
// sent nothing at all. (Forensic auditor, 2026-07-27 — closes ISSUE6.)
//
// It asserts on BOTH sides of the glass, exactly like its sibling:
//   • what the provider SEES — the request, the CTA, then the flow completes
//   • what the app actually SENT — the real backend write, which differs by path:
//       – FREE Connector request + a concrete time → "Accept & confirm" →
//         accept_request_with_time RPC (a CONFIRMED booking).
//       – PAID request → "Place a bid" → request_responses status='offered'
//         (the SPEC-47 barter/offer table, NOT a booking).
//   • NO double-accept — an already-resolved request never offers a CTA.
//
// A screen that merely repaints local state passes the "sees" half and fails the
// "sent" half. That is the shape-satisfying-stub gap, closed for the inbound loop.
//
// Hermetic: Supabase is served from the seeded world (e2e/support/), no secrets,
// no chance of touching prod.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { installWorld, assertNoEscapedRequests } from './support/harness.js';
import {
  FREE_WORLD, PROVIDER,
  INBOUND_REQUEST, INBOUND_PAID_REQUEST, INBOUND_RESOLVED_REQUEST,
} from './support/world.js';

// The provider's own listed service — the Inbox passes this via ?myServiceId=,
// so Accept works from anywhere (a direct /inbound link would otherwise resolve
// it from listMyServices; we pass it to keep the assertion deterministic).
const MY_SERVICE_ID = FREE_WORLD.services[0].id;

test('inbound FREE Connector request → provider Accepts → a CONFIRMED booking is really written', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD,
    user: PROVIDER,            // the provider is the one accepting
    request: INBOUND_REQUEST,  // free, Connector requester, concrete time
  });

  await page.goto(`/inbound/${INBOUND_REQUEST.id}?myServiceId=${MY_SERVICE_ID}`);

  // The request hydrated (not a "not found") — the job the Connector asked for.
  await expect(page.getByText(/Kitchen sink is leaking/i).first()).toBeVisible({ timeout: 30_000 });

  // The free-accept CTA (concrete time → "Accept & confirm", no bid).
  const accept = page.getByRole('button', { name: /Accept & confirm/i }).first();
  await expect(accept).toBeVisible();
  await accept.click();

  // ── (a) THE WRITE. Accept must invoke accept_request_with_time for THIS
  //     request + the provider's service — a confirmed booking, not a no-op.
  await expect
    .poll(() => net.writes.filter(w => w.kind === 'accept.rpc').length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const rpc = net.writes.find(w => w.kind === 'accept.rpc');
  expect(rpc.body.p_request_id, 'Accept must confirm THIS request').toBe(INBOUND_REQUEST.id);
  expect(rpc.body.p_service_id, 'against the provider\'s listed service').toBe(MY_SERVICE_ID);
  expect(rpc.body.p_scheduled_at, 'at a concrete time (confirmed booking)').toBeTruthy();

  // ── (b) THE SCREEN. The linear flow completes — the provider lands back in
  //     their inbox. (On error the screen stays put and toasts "Could not
  //     confirm"; reaching /inbox proves the accept succeeded.)
  await page.waitForURL('**/inbox', { timeout: 15_000 });

  assertNoEscapedRequests(net);
});

test('inbound PAID request → provider places a bid → request_responses status="offered" is really written', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD,
    user: PROVIDER,
    request: INBOUND_PAID_REQUEST,  // consumer (not a Connector), a budget set
  });

  await page.goto(`/inbound/${INBOUND_PAID_REQUEST.id}?myServiceId=${MY_SERVICE_ID}`);

  await expect(page.getByText(/Kitchen sink is leaking/i).first()).toBeVisible({ timeout: 30_000 });

  // Paid path → "Place a bid" opens the price composer.
  await page.getByRole('button', { name: /Place a bid/i }).first().click();
  await page.getByPlaceholder('Your bid price').fill('120');
  await page.getByRole('button', { name: /Send bid/i }).click();

  // THE WRITE — a request_responses upsert, status 'offered', on THIS request,
  // carrying the provider's service + the bid price. NOT a bookings write.
  await expect
    .poll(() => net.writes.filter(w => w.kind === 'response.upsert').length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const resp = net.writes.find(w => w.kind === 'response.upsert');
  expect(resp.body.status, 'a bid is an OFFER on request_responses').toBe('offered');
  expect(resp.body.request_id).toBe(INBOUND_PAID_REQUEST.id);
  expect(resp.body.service_id).toBe(MY_SERVICE_ID);
  expect(resp.body.offered_price_cents, '$120 → 12000 cents').toBe(12000);

  assertNoEscapedRequests(net);
});

test('an already-accepted inbound request never offers a respond CTA (no double-accept)', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD,
    user: PROVIDER,
    request: INBOUND_RESOLVED_REQUEST,  // status: 'accepted'
  });

  await page.goto(`/inbound/${INBOUND_RESOLVED_REQUEST.id}?myServiceId=${MY_SERVICE_ID}`);

  // The request hydrated…
  await expect(page.getByText(/Kitchen sink is leaking/i).first()).toBeVisible({ timeout: 30_000 });

  // …but every respond CTA is gone, so it cannot be accepted a second time.
  await expect(page.getByRole('button', { name: /Accept & confirm/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Place a bid/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Pick a time & accept/i })).toHaveCount(0);

  assertNoEscapedRequests(net);
});
