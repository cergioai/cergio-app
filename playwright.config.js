// ─────────────────────────────────────────────────────────────────────────────
// Cergio — BEHAVIOURAL E2E (Playwright).
//
// WHY THIS EXISTS. scripts/qa.mjs is a code-INVARIANT suite: it greps the source
// for the shape of a fix. That is a real gate (it has caught real regressions),
// but it has a known hole the builder flagged honestly: a well-shaped STUB passes
// a grep. `isScheduledWhen(when)` can be imported, referenced, and still render
// the wrong sentence; the paid-fallback banner can exist in the source and still
// show when free results are right there.
//
// These specs close that hole. They boot the REAL built app in a REAL headless
// browser, drive the REAL user journey, and assert on what the user actually SEES.
//
// THE BOUNDARY (stated plainly, because an honest test says what it does not test):
//   • Everything from the browser inwards is REAL: the built bundle, React Router,
//     useChat, ResultsScreen's free→paid fallback effect, whenHorizon, api.js's
//     client-side filters, the accept flow.
//   • Supabase is MOCKED at the network boundary (e2e/support/harness.js) and
//     serves the SEEDED WORLD (e2e/support/world.js) — the same cast as
//     scripts/seed-test-world.mjs. So these prove CLIENT behaviour against the
//     backend CONTRACT; they do not prove RLS, SQL, or the edge functions
//     (qa-live.mjs + the qa-suite edge fn own those, against the real DB).
//   • That boundary is deliberate: the suite is hermetic, needs no secrets, runs
//     on any PR (including forks), and can never mutate production data.
// ─────────────────────────────────────────────────────────────────────────────
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;

// The app is BUILT against a deliberately unroutable Supabase origin. Nothing can
// reach the real project even if a mock is missing: the harness aborts any request
// to an un-mocked origin and fails the test loudly.
export const E2E_SUPABASE_URL = 'https://seedworld.supabase.test';
export const E2E_SUPABASE_ANON_KEY = 'e2e-anon-key-not-a-secret';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'e2e-results.json' }]]
    : [['list']],
  use: {
    baseURL: BASE,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Vite gives env vars that already exist in the environment the highest
    // priority, so these override any .env.local on a developer's Mac — the e2e
    // build can never be pointed at the real project by accident.
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_SUPABASE_URL: E2E_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: E2E_SUPABASE_ANON_KEY,
      VITE_GOOGLE_MAPS_API_KEY: '',
    },
  },
});
