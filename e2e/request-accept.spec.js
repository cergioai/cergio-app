// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 3 — request → provider accepts → CONFIRMED booking.
//
// The money-adjacent journey. A code-invariant grep can prove that
// `updateBookingStatus(id, 'confirmed')` appears in RequestDetailScreen.jsx. It
// cannot prove that clicking Accept actually SENDS that write, that the screen
// then reflects a confirmed booking, or that Accept is not offered twice on an
// already-resolved booking.
//
// So this spec asserts on BOTH sides of the glass:
//   • what the user sees   — the pending booking, the Accept CTA, then Confirmed
//   • what the app SENT    — a real PATCH of status='confirmed' on that booking
//
// A screen that merely repaints its own local state passes the first and fails
// the second. That is the shape-satisfying-stub gap, closed.
//
// (This is the /request/:id path — a DIRECT booking on the `bookings` table, not
// the /inbound/:reqId Connector-request path. They are different screens on
// different tables and must not be conflated.)
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { installWorld, assertNoEscapedRequests } from './support/harness.js';
import { FREE_WORLD, PENDING_BOOKING, PROVIDER } from './support/world.js';

test('request → provider accepts → the booking is CONFIRMED (and the write really happened)', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD,
    user: PROVIDER,           // the provider is the one who accepts
    booking: PENDING_BOOKING, // status: 'pending'
  });

  await page.goto(`/request/${PENDING_BOOKING.id}`);

  // The pending request is on screen, with the job the consumer asked for.
  await expect(page.getByText(/Kitchen sink is leaking/i).first()).toBeVisible({ timeout: 30_000 });

  // Accept.
  const accept = page.getByRole('button', { name: /^Accept/i }).first();
  await expect(accept).toBeVisible();
  await accept.click();

  // ── (a) THE WRITE. The app must have PATCHed the booking to 'confirmed'.
  await expect
    .poll(() => net.writes.filter(w => w.kind === 'booking.update').length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const update = net.writes.find(w => w.kind === 'booking.update');
  expect(update.patch.status, 'Accept must write status="confirmed" on the booking').toBe('confirmed');
  expect(net.booking().status).toBe('confirmed');

  // ── (b) THE SCREEN. The user must SEE the confirmation, not just trust it.
  await expect(page.getByText(/Confirmed/i).first()).toBeVisible({ timeout: 15_000 });

  // ── (c) NO DEAD END / NO DOUBLE-ACCEPT. Once resolved, the Accept CTA is gone.
  await expect(page.getByRole('button', { name: /^Accept/i })).toHaveCount(0);

  assertNoEscapedRequests(net);
});

test('an already-confirmed booking never offers Accept again', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD,
    user: PROVIDER,
    booking: { ...PENDING_BOOKING, status: 'confirmed' },
  });

  await page.goto(`/request/${PENDING_BOOKING.id}`);

  await expect(page.getByText(/Confirmed/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Accept/i })).toHaveCount(0);
  // …and nothing was written just by LOOKING at it.
  expect(net.writes.filter(w => w.kind === 'booking.update')).toEqual([]);

  assertNoEscapedRequests(net);
});
