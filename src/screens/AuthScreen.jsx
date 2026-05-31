// Per design-spec.md — Sign in / Sign up screen wired to Supabase auth.
// Sign up requires: display name + email + phone + password (≥6).
// Sign in: email + password.
// Social: Google (Supabase native), Instagram + TikTok (stubbed until we
// ship dedicated edge functions that create Supabase users from those
// OAuth identities — for now they route to the existing connect modals
// inside Profile after sign-in).
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';
import { getActiveRef } from '../lib/referral';
import { REWARDS } from '../lib/rewards';

// TikTok OAuth sign-in config (separate from the link-only flow used in
// modals). Public client_key + redirect URI from build env.
const TIKTOK_CLIENT_KEY = import.meta.env.VITE_TIKTOK_CLIENT_KEY || '';
const TIKTOK_REDIRECT   = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tiktok-oauth/callback`;
// Sandbox / unreviewed apps only get user.info.basic. After TikTok App
// Review approves `user.info.profile`, set VITE_TIKTOK_SCOPES in env to
// "user.info.basic,user.info.profile" — no code change needed.
const TIKTOK_SCOPES = import.meta.env.VITE_TIKTOK_SCOPES || 'user.info.basic';

function buildTikTokSigninUrl(state) {
  const params = new URLSearchParams({
    client_key:    TIKTOK_CLIENT_KEY,
    scope:         TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri:  TIKTOK_REDIRECT,
    state,    // suffix '.signin' tells the edge function this is the sign-in flow
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

// Very loose phone validation — 7+ digits, optional + and spaces. We're not
// SMS-verifying it in the auth flow today; this just blocks obvious typos.
function phoneValid(s) {
  const digits = (s || '').replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function AuthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, showToast } = useOutletContext();
  // CERGIO-GUARD: when the user lands here from an invite link, the
  // referral capture in App.jsx has already stamped localStorage. We
  // surface a small "invited by a friend" banner so they see WHY they're
  // here and that the reward attribution will fire on first booking.
  // Also drives signup-default — if they came via invite, default to
  // signup mode.
  const activeRef = getActiveRef();
  // Reset-flow: when Supabase redirects back from a password-reset
  // email, the URL has ?reset=true. We show a Set-new-password mini
  // form instead of the usual sign-in.
  const isReset = new URLSearchParams(location.search).get('reset') === 'true';

  const [mode, setMode] = useState(activeRef ? 'signup' : 'signin'); // 'signin' | 'signup'
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [socialBusy, setSocialBusy] = useState(null); // 'google'|'instagram'|'tiktok'|null
  // Forgot-password / new-password state.
  const [forgotOpen, setForgotOpen]   = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy]   = useState(false);
  const [resetPwd, setResetPwd]       = useState('');
  const [resetBusy, setResetBusy]     = useState(false);
  const ttPopupRef = useRef(null);

  const sendReset = async () => {
    const e = (forgotEmail || email).trim();
    if (!e || !e.includes('@') || forgotBusy) return;
    setForgotBusy(true);
    const { error } = await auth.sendPasswordReset(e);
    setForgotBusy(false);
    if (error) { showToast(error.message || 'Could not send reset'); return; }
    showToast('Reset link sent — check your email.');
    setForgotOpen(false);
    setForgotEmail('');
  };

  const completeReset = async () => {
    if (resetPwd.length < 6 || resetBusy) return;
    setResetBusy(true);
    const { error } = await auth.updatePassword(resetPwd);
    setResetBusy(false);
    if (error) { showToast(error.message || 'Could not update password'); return; }
    showToast('Password updated ✓');
    navigate('/home');
  };

  // Listen for postMessage from the TikTok signin popup.
  useEffect(() => {
    function onMessage(ev) {
      const data = ev?.data;
      if (!data || data.source !== 'cergio-tt-signin') return;
      setSocialBusy(null);
      try { ttPopupRef.current?.close?.(); } catch {}
      if (!data.ok) {
        showToast(data.error || 'TikTok sign-in failed');
        return;
      }
      // Edge function generated a magic link — opener navigates to complete session.
      if (data.signin_link) {
        // Magic link includes the session token; navigating completes auth
        // and Supabase auth state listener routes us to /home automatically.
        window.location.href = data.signin_link;
      } else {
        showToast('TikTok connected — refreshing…');
        setTimeout(() => window.location.reload(), 700);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [showToast]);

  const isSignup = mode === 'signup';
  const valid =
    email.includes('@') &&
    password.length >= 6 &&
    (!isSignup || (displayName.trim().length > 0 && phoneValid(phone)));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (isSignup) {
        // CERGIO-GUARD: signUp may return needsEmailConfirm=true when
        // Supabase email-confirmation is enabled — in that case there's
        // no session yet, so we MUST keep the user on the auth screen
        // (or they'll bounce around trying to submit things while not
        // signed in). Sticky toast explains the next step.
        const res = await auth.signUp(email.trim(), password, displayName.trim(), phone.trim());
        if (res?.error) {
          const msg = res.error.message || '';
          // Rate-limit messaging is cryptic by default — translate it
          // into actionable copy. Free-tier limit is ~4 confirmation
          // emails/hour; sign-in is unaffected (no email).
          if (/rate limit|too many|too frequent/i.test(msg)) {
            showToast(
              'Supabase signup email rate limit hit. Sign in if you already have an account, or wait ~15 minutes. ' +
              'To remove this for development, run Disable Email Confirmation.command.',
              { sticky: true },
            );
            setMode('signin');
          } else if (/already registered|already.*exist/i.test(msg)) {
            showToast('That email is already registered. Try signing in instead.', { sticky: true });
            setMode('signin');
          } else {
            showToast(msg);
          }
          return;
        }
        if (res?.needsEmailConfirm) {
          showToast(res.confirmMessage || 'Check your email to confirm your account, then sign in.', { sticky: true });
          setMode('signin');     // flip the tab so they're ready to sign in after confirming
          setPassword('');       // clear so they have to re-enter on next attempt
          return;
        }
        // Real session exists (or auto-signIn worked) → straight to home.
        showToast('Welcome to Cergio ✓');
        navigate('/home');
      } else {
        const { error } = await auth.signIn(email.trim(), password);
        if (error) { showToast(error.message); return; }
        navigate('/home');
      }
    } finally {
      setBusy(false);
    }
  };

  const startSocial = async (provider) => {
    if (socialBusy) return;
    setSocialBusy(provider);
    try {
      if (provider === 'google') {
        // Native Supabase OAuth. Requires Google enabled in Supabase
        // Dashboard → Authentication → Providers, plus a Google Cloud
        // OAuth client. If not configured, surfaces the underlying error.
        const { error } = await auth.signInWithOAuth?.('google') ?? { error: { message: 'OAuth not wired' } };
        if (error) {
          showToast(error.message || 'Google sign-in failed');
        }
        // On success, Supabase redirects the page — no further action here.
      } else if (provider === 'instagram') {
        // Instagram sign-in (not just account-linking) needs a separate
        // edge function that creates a Supabase user from the IG identity.
        // Not built yet — keep the entry point visible so users know it's
        // coming, but route to email signup for now.
        showToast('Instagram sign-in is coming soon — use email or Google for now.');
      } else if (provider === 'tiktok') {
        if (!TIKTOK_CLIENT_KEY) {
          showToast('TikTok sign-in launching soon — use email or Google for now.');
          return;
        }
        // state format: {uuid}.{mode}.{base64(origin)}
        // The edge function decodes origin and uses it as the magic-link
        // redirectTo, so dev (any port) + prod (vercel/cergio.ai) work
        // without depending on Supabase's hard-coded Site URL setting.
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const state = `${crypto.randomUUID()}.signin.${btoa(origin)}`;
        const w = 540, h = 720;
        const left = window.screenX + Math.max(0, (window.outerWidth  - w) / 2);
        const top  = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
        ttPopupRef.current = window.open(
          buildTikTokSigninUrl(state),
          'cergio-tt-signin',
          `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`,
        );
        if (!ttPopupRef.current) {
          showToast('Popup blocked. Allow popups for this site and try again.');
          return;
        }
        // Clear the spinner if the user closes the popup without finishing.
        const poll = setInterval(() => {
          if (ttPopupRef.current?.closed) {
            clearInterval(poll);
            setSocialBusy(null);
          }
        }, 600);
      }
    } finally {
      setSocialBusy(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-cr pb-8 overflow-y-auto">
      <div className="flex flex-col items-center pt-14 pb-6 px-7 text-center">
        {/* CERGIO-GUARD (2026-05-30 v3): logo leads, single brand
            anchor. Matches Splash treatment. */}
        <LeafLogo variant="splash" size={96} />
        <div className="flex flex-col items-center gap-1.5 max-w-[300px] mt-5">
          <p className="text-[14px] text-b2 leading-snug font-medium text-center">
            Hi, I&apos;m{' '}
            <span className="font-extrabold tracking-[0.18em] uppercase text-black">
              Cergio
            </span>
            . I&apos;ll negotiate and book services your friends actually trust.
          </p>
          <p className="text-[11px] text-gd font-extrabold tracking-[0.18em] uppercase mt-1">
            Book · Barter · Earn
          </p>
        </div>
        {/* Invited-by-a-friend banner — pops only when an active ?ref was
            captured on app boot. Makes the attribution visible + warmer
            welcome than a cold sign-up screen. */}
        {activeRef && (
          <div className="mt-4 bg-gl border border-g/25 rounded-pill px-3.5 py-2 flex items-center gap-2">
            <span className="text-[13px]">🌱</span>
            <p className="text-[12px] text-gd font-bold leading-snug">
              Invited by a friend — ${REWARDS.perFriendUser} credit each when you book.
            </p>
          </div>
        )}
      </div>

      <div className="px-7">
        {/* tabs */}
        <div className="bg-bg5 rounded-pill p-1 flex mb-5">
          {['signin', 'signup'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-pill py-2.5 text-[14px] font-extrabold transition-all
                ${mode === m ? 'bg-white text-black shadow-card' : 'text-black/70'}`}
            >
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        {/* ── Social buttons row ──────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {/* Google */}
          <button
            onClick={() => startSocial('google')}
            disabled={!!socialBusy}
            className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-2.5
                       text-[12px] font-bold text-black hover:bg-bg5/40 transition-colors
                       disabled:opacity-60 disabled:cursor-wait"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853"/>
              <path d="M5.84 14.1A6.61 6.61 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335"/>
            </svg>
            {socialBusy === 'google' ? '…' : 'Google'}
          </button>

          {/* Instagram */}
          <button
            onClick={() => startSocial('instagram')}
            disabled={!!socialBusy}
            className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-2.5
                       text-[12px] font-bold text-black hover:bg-bg5/40 transition-colors
                       disabled:opacity-60 disabled:cursor-wait"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="black" stroke="none" />
            </svg>
            {socialBusy === 'instagram' ? '…' : 'IG'}
          </button>

          {/* TikTok */}
          <button
            onClick={() => startSocial('tiktok')}
            disabled={!!socialBusy}
            className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-2.5
                       text-[12px] font-bold text-black hover:bg-bg5/40 transition-colors
                       disabled:opacity-60 disabled:cursor-wait"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="black">
              <path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/>
            </svg>
            {socialBusy === 'tiktok' ? '…' : 'TikTok'}
          </button>
        </div>

        {/* divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-bdr" />
          <span className="text-[11px] font-extrabold text-b3 uppercase tracking-wide">or with email</span>
          <div className="flex-1 h-px bg-bdr" />
        </div>

        {isSignup && (
          <div className="mb-4">
            <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b3 mb-1.5">Your name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Tarik"
              className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b3 mb-1.5">Email</label>
          <input
            type="email"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
          />
        </div>

        {/* Mobile — required on signup. We don't SMS-verify yet; just
            collected so providers can reach you on bookings + future 2FA. */}
        {isSignup && (
          <div className="mb-4">
            <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b3 mb-1.5">
              Mobile <span className="text-danger ml-0.5">*</span>
            </label>
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 555 555 5555"
              className={`w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                          placeholder-b3 outline-none focus:ring-2 focus:ring-g/30
                          ${phone && !phoneValid(phone) ? 'ring-2 ring-danger/40' : ''}`}
            />
            {phone && !phoneValid(phone) ? (
              <p className="text-[11px] text-danger mt-1.5">Enter 7–15 digits (include country code).</p>
            ) : (
              <p className="text-[11px] text-b3 mt-1.5 leading-snug">
                We text only booking + invite alerts — never marketing.
              </p>
            )}
          </div>
        )}

        <div className="mb-2">
          <label className="block text-[11px] font-extrabold uppercase tracking-wide text-b3 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 pr-14 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              aria-label={showPwd ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-extrabold text-b3
                         px-2 py-1 rounded-[8px] hover:bg-bg5"
            >
              {showPwd ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {/* Forgot-password link — only on sign-in (sign-up doesn't need it). */}
        {!isSignup && (
          <div className="flex justify-end mb-5">
            <button
              type="button"
              onClick={() => { setForgotOpen(true); setForgotEmail(email); }}
              className="text-[12px] font-extrabold text-g underline underline-offset-2"
            >
              Forgot password?
            </button>
          </div>
        )}
        {isSignup && <div className="mb-5" />}

        <button
          onClick={submit}
          disabled={!valid || busy}
          className={`w-full rounded-[24px] py-4 text-[17px] font-extrabold transition-all
            ${valid && !busy
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {busy ? 'Please wait…' : (isSignup ? 'Create account' : 'Sign in')}
        </button>
        {isSignup && (
          <p className="text-[11px] text-b3 mt-3 leading-snug text-center">
            By creating an account you agree to our{' '}
            <a href="/privacy" className="text-g font-bold underline underline-offset-2">privacy policy</a>.
          </p>
        )}

        <button
          onClick={() => navigate('/home')}
          className="w-full mt-4 text-[14px] font-extrabold text-b3 underline underline-offset-2"
        >
          Continue as guest
        </button>
      </div>

      {/* Forgot-password bottom sheet — send a Supabase reset link. */}
      {forgotOpen && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
             onClick={() => setForgotOpen(false)}>
          <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-6"
               onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-[18px] font-extrabold text-black leading-tight">Reset your password</h3>
              <button onClick={() => setForgotOpen(false)}
                className="text-[20px] text-b3 font-bold px-2 -mt-1" aria-label="Close">×</button>
            </div>
            <p className="text-[12px] text-b3 leading-snug mb-3">
              We'll email you a link to set a new password.
            </p>
            <input
              type="email"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 mb-4"
              onKeyDown={e => e.key === 'Enter' && sendReset()}
            />
            <button
              onClick={sendReset}
              disabled={forgotBusy || !forgotEmail.includes('@')}
              className={`w-full rounded-[14px] py-3.5 text-[15px] font-extrabold transition-all
                ${!forgotBusy && forgotEmail.includes('@')
                  ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                  : 'bg-bg5 text-b3 cursor-not-allowed'}`}
            >
              {forgotBusy ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
        </div>
      )}

      {/* Reset-completion sheet — opens when redirected back with ?reset=true.
          The user landed here from the email link with an active session;
          we just need to set the new password. */}
      {isReset && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center">
          <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-6">
            <h3 className="text-[18px] font-extrabold text-black leading-tight mb-1">Set a new password</h3>
            <p className="text-[12px] text-b3 leading-snug mb-3">
              Choose a strong password (6+ characters). You'll stay signed in.
            </p>
            <input
              type={showPwd ? 'text' : 'password'}
              value={resetPwd}
              onChange={e => setResetPwd(e.target.value)}
              autoComplete="new-password"
              placeholder="New password"
              className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 mb-2"
              onKeyDown={e => e.key === 'Enter' && completeReset()}
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              className="text-[12px] font-bold text-b3 mb-3"
            >
              {showPwd ? 'Hide password' : 'Show password'}
            </button>
            <button
              onClick={completeReset}
              disabled={resetBusy || resetPwd.length < 6}
              className={`w-full rounded-[14px] py-3.5 text-[15px] font-extrabold transition-all
                ${!resetBusy && resetPwd.length >= 6
                  ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                  : 'bg-bg5 text-b3 cursor-not-allowed'}`}
            >
              {resetBusy ? 'Saving…' : 'Save and continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
