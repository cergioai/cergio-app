// Live-site config (no local server, no mocks) — SPEC-96.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-live',
  timeout: 60000,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: 'live-ux-results.json' }]],
  use: { ...devices['iPhone 14'], baseURL: process.env.LIVE_BASE || 'https://cergio.ai', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
