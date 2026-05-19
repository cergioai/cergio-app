// Supabase client — single shared instance across the app.
// Uses the public-safe anon (publishable) key. Server-only operations
// (admin scripts, edge functions) use the SERVICE_ROLE key, never imported
// from this module.
import { createClient } from '@supabase/supabase-js';

const url     = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local. ' +
    'The app will fall back to mock data.'
  );
}

export const supabase = (url && anonKey)
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Convenience: is the client wired up at all?
export const supabaseReady = !!supabase;
