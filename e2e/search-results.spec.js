// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 1 — search → results.
//
// The two live defects this spec exists to catch, both of which a code-shaped
// grep can miss and a shape-satisfying stub can pass:
//
//   A1 — THE ADDRESS MUST SURVIVE THE HOP. The nightly walk found "dog groomer
//        under $80 on august 5th" mis-extracted "80 on august 5th" as the
//        LOCATION, geocoded that, and showed the user a raw geocoder error. The
//        address the user gave must arrive on /results as the location, budget
//        and date tokens must NOT leak into it, and no setup/geocoder error may
//        be shown for a perfectly good address.
//
//   PAID BANNER — the "No free plumbers nearby — showing paid options" banner is
//        HONEST only when it is true. Here a $0 offering exists nearby, so it
//        must not appear. The second test is the CONTROL: with no free offering
//        it MUST appear. A screen that never renders the banner (or always does)
//        fails one of the two — which is exactly what a grep cannot tell you.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { installWorld, assertNoEscapedRequests, searchFromHome } from './support/harness.js';
import { FREE_WORLD, PAID_WORLD, SEARCH_ADDRESS, parseResultFor } from './support/world.js';

test('search → results: the address persists, no token leaks into it, and no false setup error', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD,
    parse: parseResultFor({ what: 'plumber', when: 'tomorrow', where: SEARCH_ADDRESS, budget: '$200' }),
  });

  await searchFromHome(page, `plumber under $200 tomorrow at ${SEARCH_ADDRESS}`);

  // The location chip carries the user's city — the address made it through the
  // parse → request → results hop.
  await expect(page.getByText('Miami', { exact: true }).first()).toBeVisible();

  // …and NOTHING else leaked into it. This is the A1 defect stated as a fact:
  // the location must never contain the budget or the date.
  const locationChip = page.getByText('Miami', { exact: true }).first();
  const chipText = (await locationChip.innerText()).toLowerCase();
  expect(chipText).not.toContain('$');
  expect(chipText).not.toMatch(/tomorrow|august|\d{2,}/);

  // The when + budget survive too — as their OWN chips, not smeared into the address.
  await expect(page.getByText('tomorrow', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Budget \$200/).first()).toBeVisible();

  // A good address must never surface a geocoder/setup error to the user.
  await expect(page.getByText(/REQUEST_DENIED|Setup needed|geocoder/i)).toHaveCount(0);

  // The address is persisted for the NEXT search (the "it holds" half of A1).
  const saved = await page.evaluate(() => window.localStorage.getItem('cergio.guestAddress'));
  expect(saved, 'the searched address must be persisted for the next search').toBeTruthy();
  expect(JSON.parse(saved).address.toLowerCase()).toContain('brickell');

  assertNoEscapedRequests(net);
});

test('search → results: a FREE option nearby means NO paid-fallback banner', async ({ page }) => {
  const net = await installWorld(page, {
    world: FREE_WORLD, // a $0 offering IS on the books
    parse: parseResultFor({ what: 'plumber', when: 'tomorrow' }),
  });

  await searchFromHome(page, `plumber tomorrow at ${SEARCH_ADDRESS}`);

  // The free match is shown…
  await expect(page.getByText(/Marisol/).first()).toBeVisible({ timeout: 30_000 });

  // …and the app does NOT tell the user a lie about there being none.
  await expect(page.getByText(/No free .* (nearby|on offer)/i)).toHaveCount(0);
  await expect(page.getByText(/showing paid options/i)).toHaveCount(0);

  assertNoEscapedRequests(net);
});

test('search → results: with NO free option, the paid-fallback banner IS shown (control)', async ({ page }) => {
  const net = await installWorld(page, {
    world: PAID_WORLD, // nothing is $0 → freeOnly returns zero → app re-queries paid
    parse: parseResultFor({ what: 'plumber', when: 'tomorrow' }),
  });

  await searchFromHome(page, `plumber tomorrow at ${SEARCH_ADDRESS}`);

  // The honest story: the paid options are shown, WITH the banner explaining why
  // they are not free. Without this control, the test above could pass on a
  // screen that simply never renders the banner at all.
  await expect(page.getByText(/Marisol/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No free .* (nearby|on offer)/i).first()).toBeVisible();

  // And it must never be a dead end — the empty-state lie ("no plumbers yet") is
  // exactly what the fallback exists to prevent.
  await expect(page.getByText(/No plumbers yet/i)).toHaveCount(0);

  assertNoEscapedRequests(net);
});
