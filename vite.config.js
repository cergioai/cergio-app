import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// CERGIO-GUARD: capture the current git short SHA + a build timestamp
// at server-start / build time so the running app can show a tiny
// build-version pill. Lets the user instantly tell whether HMR has
// kept a stale module mounted — the pill changes every commit. Was
// the single missing observability piece during the 2026-05-27
// 2-day debug. Falls back to 'dev' if git isn't present.
function gitShortSha() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'dev'; }
}
const BUILD_SHA  = process.env.VITE_BUILD_SHA  || gitShortSha();
const BUILD_TIME = process.env.VITE_BUILD_TIME || new Date().toISOString();

// CERGIO-GUARD: strictPort prevents Vite from drifting to 5174, 5175,
// 5202, … when 5173 is busy. Drift broke us once (2026-05-27) because
// the Google Maps API key referrer list pins specific ports; an
// unexpected drift to 5202 produced the "Setup needed" banner. We'd
// rather the dev server crash loudly than silently rebind. If 5173
// is taken, kill the stale process: `lsof -ti:5173 | xargs kill -9`.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, open: true },
  define: {
    __CERGIO_BUILD_SHA__:  JSON.stringify(BUILD_SHA),
    __CERGIO_BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
});
