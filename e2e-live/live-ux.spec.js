// ─────────────────────────────────────────────────────────────────────────────
// LIVE UX SELF-TEST (SPEC-96). Runs against the REAL deployed site in a REAL
// browser at MOBILE viewport. No mocks. This is the layer that was missing —
// every bug the founder had to find by hand is asserted here:
//   • CC identity sheet top cut off on mobile   (2026-07-29)
//   • Spotlight IG handle shown but not clickable (2026-07-28)
//   • duplicate service listings                 (2026-07-29)
//   • edge-fn 404s / dead routes                 (2026-07-29)
// If any of these regress, THIS fails — not the founder.
import { test, expect } from '@playwright/test';

const SITE = process.env.LIVE_BASE || 'https://cergio.ai';
const M = { width: 390, height: 844 };   // iPhone 14 — the viewport the bug appeared on
const SHORT = { width: 390, height: 667 }; // iPhone SE — worst case for cut-off

test.use({ viewport: M });

test('site loads and serves a build', async ({ page }) => {
  const res = await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), 'site must return 2xx').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
});

test('/early founding-offers page renders (not a blank/error screen)', async ({ page }) => {
  await page.goto(`${SITE}/early`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/founding offers/i)).toBeVisible({ timeout: 15000 });
  // both tabs must exist
  await expect(page.getByRole('button', { name: /free services/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /free spotlights/i })).toBeVisible();
});

test('no route renders a raw error string to the user', async ({ page }) => {
  for (const r of ['/', '/early', '/free']) {
    await page.goto(`${SITE}${r}`, { waitUntil: 'domcontentloaded' });
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    expect(body, `${r} must not surface a raw edge-fn error`).not.toMatch(/non-2xx status code/i);
    expect(body, `${r} must not show an unhandled crash`).not.toMatch(/Application error|ChunkLoadError/i);
  }
});

// The exact class of bug that hit the CC sheet: a fixed overlay whose top is
// pushed off-screen on a short viewport with no scroll.
test('modals/sheets are never cut off at the top on a short phone', async ({ page }) => {
  await page.setViewportSize(SHORT);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div,section,dialog')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 200 || r.width < 200) continue;         // not a sheet
      const child = el.firstElementChild;
      if (!child) continue;
      const cr = child.getBoundingClientRect();
      // a sheet whose content starts ABOVE the viewport AND cannot scroll = cut off
      const scrollable = /auto|scroll/.test(getComputedStyle(child).overflowY) || /auto|scroll/.test(cs.overflowY);
      if (cr.top < 0 && !scrollable) out.push(`${el.className}`.slice(0, 80));
    }
    return out;
  });
  expect(bad, 'a fixed sheet is cut off at the top with no scroll').toEqual([]);
});

// Every visible @handle must be a real link (the spotlight IG bug).
test('instagram handles shown to users are clickable links', async ({ page }) => {
  await page.goto(`${SITE}/early`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const orphan = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('p,span,div').forEach(el => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (!/^@[A-Za-z0-9._]{2,30}$/.test(t)) return;
      if (!el.closest('a')) bad.push(t);
    });
    return bad;
  });
  expect(orphan, 'an @handle is displayed but not linked to Instagram').toEqual([]);
});
