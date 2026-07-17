// Tracks the current Supabase auth session and keeps it in React state.
// Returns { session, user, loading, signIn, signUp, signOut }.
import { useEffect, useState, useCallback } from 'react';
import { supabase, supabaseReady } from '../lib/supabase';
import { recordInviteFromActiveRef, clearActiveRef } from '../lib/referral';

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
    const res = await supabase.auth.signInWithPassword({ email, password });
    // CERGIO-GUARD (2026-06-12): an EXISTING account signing in was never
    // "invited" — drop any stale ?ref/short-link capture so the
    // "Invited by a friend" ribbon and invite attribution can't misfire.
    // Tarik bug: t@cergio.ai saw the ribbon after testing his own invite
    // link in the same browser.
    if (!res.error) clearActiveRef();
    return res;
  }, []);

  const signUp = useCallback(async (email, password, displayName, phone, smsConsent = false) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    // Phone normalized to E.164-ish (just digits + leading +). Saved into
    // both Supabase auth.users.phone AND user_metadata so we have one
    // canonical copy whichever side reads it. profile_private gets a copy
    // when the profile row is first synced.
    const cleanPhone = (phone || '').replace(/[^\d+]/g, '').trim();
    // SMS opt-in (SPEC-83, 2026-07-16): A2P requires DOCUMENTED consent captured
    // BEFORE the first text. We record an explicit, checkbox-driven consent (never
    // implied) into user_metadata so the send path can gate on it. Twilio rejected
    // the prior campaign (30896) for lacking this; cold "tap = consent" is retired.
    const consented = !!smsConsent && !!cleanPhone;
    const result = await supabase.auth.signUp({
      email,
      password,
      phone: cleanPhone || undefined,
      options: {
        data: {
          display_name: displayName,
          phone: cleanPhone || null,
          sms_consent: consented,
          sms_consent_at: consented ? new Date().toISOString() : null,
          sms_consent_source: consented ? 'signup_checkbox_v1' : null,
        },
      },
    });
    if (result.error) return result;

    // CERGIO-GUARD: after a successful signup, attribute the invite chain
    // by writing an `invites` row linking inviter (from ?ref=… captured
    // in App.jsx) to this new invitee. Best-effort — does not block
    // signup success and silently no-ops when there's no active ref.
    const newUserId = result?.data?.user?.id;
    if (newUserId) {
      recordInviteFromActiveRef(newUserId).catch(() => { /* swallow */ });
    }

    // CERGIO-GUARD: when Supabase email-confirmation is DISABLED, signUp
    // returns a session and the user is signed in immediately. When it's
    // ENABLED, session is null and the user has to click an email link
    // first. The user was reporting "I sign up then it keeps prompting
    // me to sign in" — that's the no-session case. Defensive fix:
    //   • If a session came back → we're done.
    //   • Else try signInWithPassword immediately. If email confirmation
    //     IS off, this succeeds and creates the session. If it's ON,
    //     Supabase returns 'Email not confirmed'; we surface a clear
    //     needsEmailConfirm flag so the UI shows the right next step.
    if (!result?.data?.session) {
      const signInRes = await supabase.auth.signInWithPassword({ email, password });
      if (signInRes?.data?.session) {
        return { data: signInRes.data, error: null };
      }
      const msg = signInRes?.error?.message || '';
      const needsEmailConfirm = /confirm|verify/i.test(msg);
      if (needsEmailConfirm) {
        return {
          data: result.data,
          error: null,
          needsEmailConfirm: true,
          confirmMessage: 'Check your email to confirm your account, then sign in.',
        };
      }
      // signIn failed for another reason — surface it so the user knows.
      if (signInRes?.error) {
        return { data: result.data, error: signInRes.error };
      }
    }
    return result;
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

  /** Send a password-reset email via Supabase. The user clicks the link
   *  in the email, lands back on /auth?reset=true, and can set a new
   *  password. Best-effort — surfaces Supabase's error message to the
   *  caller. */
  const sendPasswordReset = useCallback(async (email) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/auth?reset=true`
      : undefined;
    return await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  }, []);

  /** Set a new password — used after a reset email click. */
  const updatePassword = useCallback(async (newPassword) => {
    if (!supabaseReady) return { error: { message: 'Supabase not configured' } };
    return await supabase.auth.updateUser({ password: newPassword });
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
    sendPasswordReset,
    updatePassword,
  };
}
