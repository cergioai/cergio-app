// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 2 — the INSTANT vs SCHEDULED branch (SPEC-47.1 / the A1 launch gate).
//
// The rule: a job clearly far out (> ~32h) gets the honest "it can take up to 24
// hours to locate and negotiate the best offers." Everything near-term gets
// "Allow up to 15 minutes for nearby services to confirm and reply."
//
// This bug shipped TWICE, and both times the source looked right:
//   • "in two weeks" (a spelled-out number) fell through to the 15-minute copy.
//   • "august 5th"   (a calendar date)      fell through to the 15-minute copy.
//
// qa.mjs can prove `isScheduledWhen` is imported and that whenHorizon.js resolves
// dates. It cannot prove the SENTENCE the user reads. That is what this does: it
// reads the screen.
//
// The world is deliberately EMPTY: ResultsScreen shows this line only while no
// offer has landed, which is precisely when the promise is made.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { installWorld, assertNoEscapedRequests, searchFromHome } from './support/harness.js';
import { EMPTY_WORLD, SEARCH_ADDRESS, parseResultFor, calendarDateInDays } from './support/world.js';

const INSTANT_COPY   = /Allow up to 15 minutes for nearby services to confirm/i;
const SCHEDULED_COPY = /take up to 24 hours to locate and negotiate/i;

async function resultsFor(page, when) {
  const net = await installWorld(page, {
    world: EMPTY_WORLD,
    parse: parseResultFor({ what: 'plumber', when, where: SEARCH_ADDRESS }),
  });
  await searchFromHome(page, `plumber ${when} at ${SEARCH_ADDRESS}`);
  return net;
}

// Near-term phrasings → INSTANT.
for (const when of ['tomorrow', 'today', 'tonight']) {
  test(`"${when}" is INSTANT — the 15-minute copy, never the 24-hour copy`, async ({ page }) => {
    const net = await resultsFor(page, when);
    await expect(page.getByText(INSTANT_COPY).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SCHEDULED_COPY)).toHaveCount(0);
    assertNoEscapedRequests(net);
  });
}

// Far-out phrasings → SCHEDULED. These are the shapes that regressed live: a
// spelled-out number, and a calendar date (computed, so it can never age out).
const FAR_OUT = ['in two weeks', 'in 3 weeks', calendarDateInDays(30)];

for (const when of FAR_OUT) {
  test(`"${when}" is SCHEDULED — the 24-hour copy, never the 15-minute copy`, async ({ page }) => {
    const net = await resultsFor(page, when);
    await expect(page.getByText(SCHEDULED_COPY).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(INSTANT_COPY)).toHaveCount(0);
    assertNoEscapedRequests(net);
  });
}
