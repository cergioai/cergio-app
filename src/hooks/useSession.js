// Tracks the current Supabase auth session and keeps it in React state.
// Returns { session, user, loading, signIn, signUp, signOut }.
import { useEffect, useState, useCallback } from 'react';
import { supabase, supabaseReady } from '../lib/supabase';

export function useSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(supabaseReady); // true while we're checking on first mount

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }

    let mounted = true;

    // Initial check — is there a persisted session?
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data?.session ?? null);
        setLoading(false);
      }
    });

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) setSession(newSession);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    return await supabase.auth.signInWithPassword({ email, password });
  }, []);

  const signUp = useCallback(async (email, password, displayName, phone) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    // Phone normalized to E.164-ish (just digits + leading +). Saved into
    // both Supabase auth.users.phone AND user_metadata so we have one
    // canonical copy whichever side reads it. profile_private gets a copy
    // when the profile row is first synced.
    const cleanPhone = (phone || '').replace(/[^\d+]/g, '').trim();
    return await supabase.auth.signUp({
      email,
      password,
      phone: cleanPhone || undefined,
      options: {
        data: { display_name: displayName, phone: cleanPhone || null },
      },
    });
  }, []);

  // Generic OAuth sign-in (Google, Facebook, etc — anything Supabase Auth
  // natively supports). Redirects the whole page through the provider; on
  // return Supabase persists the session and the auth state listener above
  // pushes the user into /home.
  const signInWithOAuth = useCallback(async (provider) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/home`
      : undefined;
    return await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabaseReady) return;
    await supabase.auth.signOut();
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    isSignedIn: !!session,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
  };
}
