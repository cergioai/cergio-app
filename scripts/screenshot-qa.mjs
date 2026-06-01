// Phase 5 — Screenshot QA capture script (Node + Playwright).
//
// Driven by `Screenshot QA.command` (sibling of cergio-app). Loads
// every canonical screen of the app at a 390 × natural mobile
// viewport, captures a full-page screenshot, and writes an HTML
// gallery (design-qa/index.html) that Tarik can scan in one pass.
//
// Each entry in SCREENS maps to a § in DESIGN_AUDIT.md so the gallery
// reads like a side-by-side of the punch list. Reference mockups (when
// the PNG exists in Cergio Claude/) appear next to the live capture so
// any vertical-baseline delta > 2px is obvious.
//
// Usage (driven by Screenshot QA.command):
//   NODE_PATH=~/.cergio-playwright/node_modules node screenshot-qa.mjs \
//     --base http://localhost:5173 --out /abs/path/to/design-qa
//
// Each shot fires through the same auth gate (signed-in guest) so the
// home/results/PDP screens render in their canonical signed-in state.
// Routes that require real data are seeded via cookies / localStorage
// before the page loads.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// CERGIO-GUARD (2026-05-31): Node ESM doesn't honor NODE_PATH for
// module resolution, so `import 'playwright'` only works if playwright
// sits in this script's nearest node_modules — which it does NOT, per
// the "don't npm install in sandbox" rule. Workaround: the launcher
// (Screenshot QA.command) symlinks the cached install at
// ~/.cergio-playwright/node_modules/playwright into the script's CJS
// resolution path. We then use createRequire to import it as a CJS
// module — playwright ships CJS at index.js and supports the
// destructured `{ chromium }` shape under both module systems.
const PW_DIR = process.env.CERGIO_PW_DIR
  || path.join(process.env.HOME || '', '.cergio-playwright', 'node_modules', 'playwright');
const require = createRequire(import.meta.url);
const playwright = require(PW_DIR);
const { chromium } = playwright;

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => {
    if (v.startsWith('--') && a[i + 1]) acc.push([v.slice(2), a[i + 1]]);
    return acc;
  }, [])
);

const BASE = argv.base || 'http://localhost:5173';
const OUT  = argv.out  || path.resolve(process.cwd(), 'design-qa');
fs.mkdirSync(OUT, { recursive: true });

// 390 × natural mobile viewport. Per DESIGN_AUDIT § 5 Definition of
// Done: a screen passes when its 390 × natural-height screenshot
// matches the mockup within 2px on vertical baselines.
const VIEWPORT = { width: 390, height: 844 };

// Canonical screens — keyed by audit § so the gallery matches the
// punch-list order. Each row: { key, label, route, section, mockup,
// ready (CSS selector that proves the page rendered before capture) }.
//
// `mockup` is the relative path under the Cergio Claude folder (parent
// of cergio-app) for the canonical PNG, when one exists. Absent rows
// (Earnings / About / Contact / Terms) just render the live capture.
const SCREENS = [
  { key: 'splash',     label: 'Splash + Auth',           route: '/',                 section: '§ 5.1',
    mockup: null,                                    ready: 'h1, [class*="leaflog"], button' },
  { key: 'auth',       label: 'Auth (Sign in)',          route: '/auth',             section: '§ 5.1',
    mockup: null,                                    ready: 'input[type="email"], input[type="text"]' },
  { key: 'home',       label: 'Home — find',             route: '/home',             section: '§ 5.2',
    mockup: 'Trending Free and Discounted Home.png', ready: 'input, textarea' },
  { key: 'results',    label: 'Results / SRP',           route: '/results',          section: '§ 5.3',
    mockup: null,                                    ready: 'h2, [class*="LeafLogo"]' },
  { key: 'pdp',        label: 'Service detail (PDP)',    route: '/service/_seed',    section: '§ 5.4',
    mockup: null,                                    ready: 'main, [class*="Hero"]' },
  { key: 'profile',    label: 'Public profile (Jennifer)', route: '/u/_seed',         section: '§ 5.5',
    mockup: null,                                    ready: 'h1' },
  { key: 'earnings',   label: 'Earnings explainer',      route: '/earnings/learn',   section: '§ 5.6',
    mockup: null,                                    ready: 'h1, h2' },
  { key: 'about',      label: 'About',                   route: '/about',            section: '§ 5.7',
    mockup: null,                                    ready: 'h1' },
  { key: 'contact',    label: 'Contact',                 route: '/contact',          section: '§ 5.7',
    mockup: null,                                    ready: 'form, input' },
  { key: 'terms',      label: 'Terms',                   route: '/terms',            section: '§ 5.7',
    mockup: null,                                    ready: 'h1, h2' },
];

async function capture() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    userAgent: 'Cergio-DesignQA/1.0 (Playwright)',
  });
  const page = await ctx.newPage();

  // Seed sessionStorage so the Cergio app treats us as a signed-in
  // guest. Skip routes that hit the real Supabase guard — those will
  // render the auth shell, which is itself a valid Phase 5 capture.
  await page.addInitScript(() => {
    try { sessionStorage.setItem('cergio.guestPreview', '1'); } catch { /* private */ }
  });

  const results = [];
  for (const s of SCREENS) {
    const target = `${BASE}${s.route}`;
    console.log(`  → ${s.key.padEnd(10)} ${target}`);
    let ok = true, err = null;
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Wait for either the ready selector or 2s grace so the leaf
      // animation has time to settle without blocking on Supabase.
      try {
        await page.waitForSelector(s.ready, { timeout: 2500 });
      } catch { /* fall through — capture what we have */ }
      await page.waitForTimeout(900);
    } catch (e) {
      ok = false;
      err = String(e?.message || e);
    }
    const file = path.join(OUT, `${s.key}.png`);
    try {
      await page.screenshot({ path: file, fullPage: true });
    } catch (e) {
      ok = false; err = err || String(e?.message || e);
    }
    results.push({ ...s, ok, err, file: path.basename(file) });
  }

  await browser.close();
  return results;
}

function buildGallery(results) {
  const PARENT = path.resolve(OUT, '..', '..');   // Cergio Claude/
  const mockupSrc = (m) => {
    if (!m) return null;
    const abs = path.join(PARENT, m);
    return fs.existsSync(abs) ? abs : null;
  };
  const rows = results.map((r) => {
    const live   = r.file;
    const ref    = mockupSrc(r.mockup);
    const refTag = ref
      ? `<div class="col"><div class="cap">Mockup</div><img src="file://${ref}" alt="${r.label} mockup"/></div>`
      : `<div class="col ghost"><div class="cap">Mockup</div><div class="empty">— no canonical PNG —</div></div>`;
    const status = r.ok ? '✓ captured' : `✗ ${r.err}`;
    const statusCls = r.ok ? 'ok' : 'bad';
    return `
      <section class="row" data-key="${r.key}">
        <header>
          <span class="sec">${r.section}</span>
          <span class="lbl">${r.label}</span>
          <span class="route">${r.route}</span>
          <span class="status ${statusCls}">${status}</span>
        </header>
        <div class="grid">
          <div class="col"><div class="cap">Live (390 × natural)</div><img src="${live}" alt="${r.label} live"/></div>
          ${refTag}
        </div>
      </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Cergio Design QA · 390px gallery</title>
<style>
  * { box-sizing: border-box; }
  body { background: #FAF4EE; font-family: -apple-system, BlinkMacSystemFont, 'DM Sans', sans-serif; margin: 0; padding: 32px; color: #222; }
  h1 { font-weight: 800; margin: 0 0 6px; }
  p.sub { color: #6a6a6a; margin: 0 0 24px; font-size: 14px; }
  .row { background: #fff; border: 1px solid #EFE7D6; border-radius: 14px; padding: 16px; margin-bottom: 16px; }
  .row header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .row header .sec { font-weight: 800; color: #3FA821; font-size: 12px; letter-spacing: .04em; }
  .row header .lbl { font-weight: 800; font-size: 16px; }
  .row header .route { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #6a6a6a; }
  .row header .status { margin-left: auto; font-size: 12px; font-weight: 700; }
  .row header .status.ok  { color: #3FA821; }
  .row header .status.bad { color: #C04030; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .col { background: #FAF4EE; border-radius: 10px; padding: 8px; }
  .col .cap { font-size: 11px; color: #6a6a6a; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  .col img { width: 390px; max-width: 100%; display: block; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
  .col.ghost .empty { color: #b3b3b3; font-style: italic; font-size: 13px; padding: 32px; text-align: center; }
  footer { margin-top: 24px; color: #6a6a6a; font-size: 12px; }
</style>
</head>
<body>
  <h1>Cergio Design QA · 390px gallery</h1>
  <p class="sub">
    Captured ${new Date().toLocaleString()} · ${results.length} screens · double-click any image to open full-size.
    Vertical-baseline tolerance per § 7: <strong>2px</strong>. Anything beyond becomes a Phase 4/5 ticket.
  </p>
  ${rows}
  <footer>
    Generated by <code>scripts/screenshot-qa.mjs</code> · run via <code>Screenshot QA.command</code>.
  </footer>
</body>
</html>`;
}

(async () => {
  console.log(`Capturing ${SCREENS.length} screens at ${VIEWPORT.width}×natural from ${BASE}`);
  const results = await capture();
  const html = buildGallery(results);
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(`\n✓ Gallery: ${path.join(OUT, 'index.html')}`);
  const bad = results.filter(r => !r.ok);
  if (bad.length) {
    console.error(`\n⚠ ${bad.length} capture(s) had errors:`);
    for (const r of bad) console.error(`  · ${r.key}: ${r.err}`);
    process.exitCode = 1;
  }
})();
