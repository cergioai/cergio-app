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

  const signUp = useCallback(async (email, password, displayName) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    return await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
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
    signOut,
  };
}
