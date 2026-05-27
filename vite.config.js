import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CERGIO-GUARD: strictPort prevents Vite from drifting to 5174, 5175,
// 5202, … when 5173 is busy. Drift broke us once (2026-05-27) because
// the Google Maps API key referrer list pins specific ports; an
// unexpected drift to 5202 produced the "Setup needed" banner. We'd
// rather the dev server crash loudly than silently rebind. If 5173
// is taken, kill the stale process: `lsof -ti:5173 | xargs kill -9`.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, open: true },
});
