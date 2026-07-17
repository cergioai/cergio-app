// CERGIO-GUARD (2026-06-04 v4): exquisite simple sign-in.
// Tarik: "introduce an exquisite simple login page (current one is too
// busy)… let's fix all logins (google tiktok)… submit to instagram for
// review… enable going live to cergio.ai (even with IG not wired)."
//
// Design principles for this redesign:
//   • One column, lots of whitespace, brand mark up top.
//   • One headline ("Welcome to Cergio.") — no nested taglines, no
//     "Hi, I'm Cergio" prose. The brand voice is already in /about.
//   • ONE primary CTA on first paint: "Continue with Google".
//     It's the most-used path and Supabase has it wired natively.
//   • Email/password lives behind a quiet "Continue with email" link
//     so the calm path remains uncluttered for the 95% case.
//   • Instagram + TikTok hide behind "More sign-in options" until we
//     finish their reviews. IG sign-in stays gracefully soft-disabled
//     ("Coming soon") so we can ship cergio.ai before Meta finishes
//     review — TikTok stays live where keys are configured.
//   • Sign-in vs. sign-up is a tiny pivot at the foot, not a tab pill.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';
import { getActiveRef } from '../lib/referral';
import { REWARDS } from '../lib/rewards';

// TikTok OAuth sign-in config (separate from the link-only flow used in
// modals). Public client_key + redirect URI from build env.
const TIKTOK_CLIENT_KEY = import.meta.env.VITE_TIKTOK_CLIENT_KEY || '';
const TIKTOK_REDIRECT   = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tiktok-oauth/callback`;
const TIKTOK_SCOPES     = import.meta.env.VITE_TIKTOK_SCOPES || 'user.info.basic';
// CERGIO-GUARD (2026-06-04): when IG OAuth review is approved we'll
// flip VITE_INSTAGRAM_ENABLED to 'true' in the env. Until then the IG
// button renders with a soft-disabled "Coming soon" state so we can
// go-live on cergio.ai without IG ready (per Tarik).
const INSTAGRAM_ENABLED =
  String(import.meta.env.VITE_INSTAGRAM_ENABLED || '').toLowerCase() === 'true';

function buildTikTokSigninUrl(state) {
  const params = new URLSearchParams({
    client_key:    TIKTOK_CLIENT_KEY,
    scope:         TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri:  TIKTOK_REDIRECT,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

function phoneValid(s) {
  const digits = (s || '').replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function AuthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, showToast } = useOutletContext();

  const activeRef = getActiveRef();
  const isReset   = new URLSearchParams(location.search).get('reset') === 'true';
  // CERGIO-GUARD (2026-06-16, Tarik): when a logged-out user tries to book,
  // handleBook routes them here with ?returnTo=/service/<id> so we send them
  // right back to finish booking after sign-in (never a dead-end). Defaults
  // to /home. Only same-origin internal paths are honored.
  const returnToRaw = new URLSearchParams(location.search).get('returnTo') || '';
  const returnTo = /^\/[a-zA-Z0-9/_-]+$/.test(returnToRaw) ? returnToRaw : '/home';

  // 'choose'  → Google + Email + More options buttons (calm landing)
  // 'email'   → expanded email/password form
  const [stage, setStage] = useState('choose');
  const [mode,  setMode]  = useState(activeRef ? 'signup' : 'signin');
  const [moreOpen, setMoreOpen] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [socialBusy, setSocialBusy] = useState(null);
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
      if (data.signin_link) {
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
        const res = await auth.signUp(email.trim(), password, displayName.trim(), phone.trim(), smsConsent);
        if (res?.error) {
          const msg = res.error.message || '';
          if (/rate limit|too many|too frequent/i.test(msg)) {
            showToast(
              'Supabase signup email rate limit hit. Sign in if you already have an account, or wait ~15 minutes.',
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
          setMode('signin');
          setPassword('');
          return;
        }
        showToast('Welcome to Cergio ✓');
        navigate(returnTo);
      } else {
        const { error } = await auth.signIn(email.trim(), password);
        if (error) { showToast(error.message); return; }
        navigate(returnTo);
      }
    } finally {
      setBusy(false);
    }
  };

  const startSocial = async (provider) => {
    if (socialBusy) return;
    if (provider === 'instagram' && !INSTAGRAM_ENABLED) {
      showToast('Instagram sign-in is in review — use Google or email for now.');
      return;
    }
    setSocialBusy(provider);
    try {
      if (provider === 'google') {
        const { error } = await auth.signInWithOAuth?.('google') ?? { error: { message: 'OAuth not wired' } };
        if (error) showToast(error.message || 'Google sign-in failed');
      } else if (provider === 'tiktok') {
        if (!TIKTOK_CLIENT_KEY) {
          showToast('TikTok sign-in launching soon — use Google or email for now.');
          return;
        }
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const state = `${crypto.randomUUID()}.signin.${btoa(origin)}`;
        // Full-page redirect (NOT a popup). The popup callback returned an HTML
        // page whose script did the sign-in + window close, but the gateway
        // served that page as text/plain, so the script never ran and login
        // never completed. A top-level redirect is gateway-independent:
        // TikTok consent → our callback → 302 to the Supabase magic link → /home.
        window.location.href = buildTikTokSigninUrl(state);
        return;
      }
    } finally {
      setSocialBusy(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-cr overflow-y-auto">
      {/* ── Brand mark + headline ─────────────────────────────────────
          Single calm hero. Logo + one-line welcome. No tagline noise. */}
      <div className="flex flex-col items-center pt-20 pb-10 px-7 text-center">
        <LeafLogo variant="splash" size={84} />
        {/* CERGIO-GUARD (2026-06-05 v6): broken into separate lines
            per Tarik — "clean up copy look on initial sign in (too
            busy.. move to several lines)." Welcome is its own line;
            wordmark sits below with an elegant superscript BETA tag.
            Sub-line moves down a level so the eye lands cleanly. */}
        <p className="mt-7 text-body-lg text-b3 font-medium tracking-wide">
          Welcome to
        </p>
        <h1 className="mt-1.5 text-display-1 font-extrabold text-black leading-tight flex items-start justify-center gap-1">
          <span className="tracking-[0.18em] uppercase">Cergio</span>
          <span
            aria-label="beta"
            className="mt-0.5 inline-block bg-gl text-gd border border-g/30 rounded-[6px] px-1.5 py-px text-[8.5px] font-extrabold uppercase tracking-[0.18em]"
          >
            beta
          </span>
        </h1>
        {/* CERGIO-GUARD (2026-06-05): mirror the Book · Barter · Earn
            pillar line from SplashScreen onto AuthScreen too. Tarik:
            "add book barter earn on login too". Sits between the
            wordmark and the action prompt so the brand pillars are
            present at every entry point — not just the splash. */}
        <p className="mt-3 text-caps text-b3 font-extrabold tracking-[0.18em] uppercase">
          Book · Barter · Earn
        </p>
        <p className="mt-4 text-body-sm text-b2 leading-snug max-w-[260px]">
          {isSignup ? 'Create your account.' : 'Sign in to keep going.'}
        </p>
        <p className="mt-1 text-meta text-b3 leading-snug max-w-[260px]">
          {isSignup ? 'Takes seconds.' : 'One tap with Google.'}
        </p>

        {/* CERGIO-GUARD (2026-06-12): invited-by-a-friend ribbon fixes
            per Tarik:
            1. Only renders in SIGNUP mode — a stale captured ref was
               showing "Invited by a friend" to existing users signing
               in (t@cergio.ai, who was never invited). useSession.signIn
               also clears the stale ref on successful sign-in now.
            2. Copy said "$250 credit each" — WRONG: the credit goes to
               the INVITING party only (REWARDS.perFriendUser, paid when
               the invitee books). Copy now states exactly that. */}
        {activeRef && isSignup && (
          <div className="mt-5 bg-gl border border-g/25 rounded-pill px-3.5 py-1.5 inline-flex items-center gap-2">
            <span className="text-meta">🌱</span>
            <p className="text-meta-sm text-gd font-extrabold leading-snug">
              Invited by a friend · they earn ${REWARDS.perFriendUser} credit when you book
            </p>
          </div>
        )}
      </div>

      {/* ── Action stack ─────────────────────────────────────────────
          One column, generous spacing. Primary action always Google.
          Email is a quiet secondary. IG/TikTok behind "More options". */}
      <div className="px-7 pb-10 max-w-[420px] w-full self-center">
        {stage === 'choose' && !isReset && (
          <>
            {/* Primary — Google OAuth */}
            <button
              onClick={() => startSocial('google')}
              disabled={!!socialBusy}
              className="w-full flex items-center justify-center gap-2.5 bg-white border border-bdr rounded-[16px] py-4
                         text-body-lg font-extrabold text-black hover:bg-bg5/40 transition-colors
                         disabled:opacity-60 disabled:cursor-wait shadow-card"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853"/>
                <path d="M5.84 14.1A6.61 6.61 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335"/>
              </svg>
              {socialBusy === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </button>

            {/* Secondary — Email */}
            <button
              onClick={() => setStage('email')}
              className="w-full mt-3 flex items-center justify-center gap-2 bg-bg5/60 border border-bdr rounded-[16px] py-3.5
                         text-body font-extrabold text-b2 hover:bg-bg5 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
              Continue with email
            </button>

            {/* Tertiary — More options (IG + TikTok), quietly tucked away */}
            <button
              type="button"
              onClick={() => setMoreOpen(o => !o)}
              className="w-full mt-4 text-meta font-extrabold text-b3 hover:text-b2 transition-colors"
            >
              {moreOpen ? '— Hide more options —' : '— More sign-in options —'}
            </button>
            {moreOpen && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {/* TikTok */}
                <button
                  onClick={() => startSocial('tiktok')}
                  disabled={!!socialBusy}
                  className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-2.5
                             text-meta font-extrabold text-black hover:bg-bg5/40 transition-colors
                             disabled:opacity-60 disabled:cursor-wait"
                  title={TIKTOK_CLIENT_KEY ? 'Sign in with TikTok' : 'TikTok sign-in launching soon'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="black">
                    <path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/>
                  </svg>
                  {socialBusy === 'tiktok' ? '…' : 'TikTok'}
                </button>
                {/* Instagram — soft-disabled until app review approved */}
                <button
                  onClick={() => startSocial('instagram')}
                  disabled={!!socialBusy}
                  className={`flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-2.5
                              text-meta font-extrabold text-black hover:bg-bg5/40 transition-colors
                              disabled:cursor-wait
                              ${!INSTAGRAM_ENABLED ? 'opacity-55' : ''}`}
                  title={INSTAGRAM_ENABLED ? 'Sign in with Instagram' : 'Instagram sign-in: in review with Meta'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                       stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" />
                    <circle cx="12" cy="12" r="4.5" />
                    <circle cx="17.5" cy="6.5" r="1.2" fill="black" stroke="none" />
                  </svg>
                  {INSTAGRAM_ENABLED ? 'Instagram' : 'IG · soon'}
                </button>
              </div>
            )}

            {/* Guest path stays available for browsing */}
            <button
              onClick={() => navigate('/home')}
              className="w-full mt-6 text-body-sm font-extrabold text-b3 underline underline-offset-2"
            >
              Continue as guest
            </button>
          </>
        )}

        {/* ── Email/password form (expanded) ──────────────────────── */}
        {stage === 'email' && !isReset && (
          <>
            <button
              type="button"
              onClick={() => setStage('choose')}
              className="text-meta font-extrabold text-b3 hover:text-b2 mb-4"
            >
              ‹ Back to sign-in options
            </button>

            {/* Sign in / Sign up micro-toggle */}
            <div className="bg-bg5 rounded-pill p-1 flex mb-5">
              {['signin', 'signup'].map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-pill py-2 text-body-sm font-extrabold transition-all
                    ${mode === m ? 'bg-white text-black shadow-card' : 'text-black/60'}`}
                >
                  {m === 'signin' ? 'Sign in' : 'Sign up'}
                </button>
              ))}
            </div>

            {isSignup && (
              <div className="mb-3.5">
                <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b3 mb-1.5">Your name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Tarik"
                  className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                             placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
                />
              </div>
            )}

            <div className="mb-3.5">
              <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b3 mb-1.5">Email</label>
              <input
                type="email"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                           placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
              />
            </div>

            {isSignup && (
              <div className="mb-3.5">
                <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b3 mb-1.5">
                  Mobile <span className="text-danger ml-0.5">*</span>
                </label>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 555 555 5555"
                  className={`w-full bg-bg5 rounded-[14px] px-4 py-3.5 text-body text-black
                              placeholder-b3 outline-none focus:ring-2 focus:ring-g/30
                              ${phone && !phoneValid(phone) ? 'ring-2 ring-danger/40' : ''}`}
                />
                {phone && !phoneValid(phone) && (
                  <p className="text-meta-sm text-danger mt-1.5">Enter 7–15 digits (include country code).</p>
                )}
                {/* SMS opt-in (SPEC-83) — EXPLICIT, checkbox-driven consent captured
                    before any text, as A2P/TCPA require. Optional: unchecked = no SMS,
                    signup still works. This is the ONLY way a number becomes textable. */}
                <label className="flex items-start gap-2.5 mt-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={e => setSmsConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-g"
                  />
                  <span className="text-meta-sm text-b3 leading-snug">
                    Text me booking &amp; invite alerts from Cergio. Msg &amp; data rates may apply,
                    message frequency varies. Reply STOP to opt out, HELP for help. See our{' '}
                    <a href="/terms" className="underline">Terms</a> &amp;{' '}
                    <a href="/privacy" className="underline">Privacy</a>. (Optional.)
                  </span>
                </label>
              </div>
            )}

            <div className="mb-2">
              <label className="block text-meta-sm font-extrabold uppercase tracking-wide text-b3 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full bg-bg5 rounded-[14px] px-4 py-3.5 pr-14 text-body text-black
                             placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
                  onKeyDown={e => e.key === 'Enter' && submit()}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-meta-sm font-extrabold text-b3
                             px-2 py-1 rounded-[8px] hover:bg-bg5"
                >
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {!isSignup && (
              <div className="flex justify-end mb-4">
                <button
                  type="button"
                  onClick={() => { setForgotOpen(true); setForgotEmail(email); }}
                  className="text-meta font-extrabold text-g underline underline-offset-2"
                >
                  Forgot password?
                </button>
              </div>
            )}
            {isSignup && <div className="mb-4" />}

            <button
              onClick={submit}
              disabled={!valid || busy}
              className={`w-full rounded-[20px] py-4 text-body-lg font-extrabold cg-cta
                ${valid && !busy
                  ? 'bg-g text-white'
                  : 'bg-bg5 text-b3 cursor-not-allowed'}`}
            >
              {busy ? 'Please wait…' : (isSignup ? 'Create account' : 'Sign in')}
            </button>
            {isSignup && (
              <p className="text-meta-sm text-b3 mt-3 leading-snug text-center">
                By creating an account you agree to our{' '}
                <a href="/privacy" className="text-g font-extrabold underline underline-offset-2">privacy policy</a>.
              </p>
            )}
          </>
        )}

        {/* Footer — about/contact/terms always reachable */}
        <div className="mt-10 flex items-center justify-center gap-4 text-meta-sm font-medium text-b3">
          <Link to="/about"   className="hover:text-gd transition-colors">About</Link>
          <span>·</span>
          <Link to="/contact" className="hover:text-gd transition-colors">Contact</Link>
          <span>·</span>
          <Link to="/contact?subject=support" className="hover:text-gd transition-colors">Help</Link>
          <span>·</span>
          <Link to="/terms"   className="hover:text-gd transition-colors">Terms</Link>
        </div>
      </div>

      {/* ── Forgot-password bottom sheet ──────────────────────────── */}
      {forgotOpen && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
             onClick={() => setForgotOpen(false)}>
          <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-6"
               onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-heading-2 font-extrabold text-black leading-tight">Reset your password</h3>
              <button onClick={() => setForgotOpen(false)}
                className="text-heading-1 text-b3 font-extrabold px-2 -mt-1" aria-label="Close">×</button>
            </div>
            <p className="text-meta text-b3 leading-snug mb-3">
              We'll email you a link to set a new password.
            </p>
            <input
              type="email"
              value={forgotEmail}
              onChange={e => setForgotEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 mb-4"
              onKeyDown={e => e.key === 'Enter' && sendReset()}
            />
            <button
              onClick={sendReset}
              disabled={forgotBusy || !forgotEmail.includes('@')}
              className={`w-full rounded-[14px] py-3.5 text-body-lg font-extrabold transition-all
                ${!forgotBusy && forgotEmail.includes('@')
                  ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                  : 'bg-bg5 text-b3 cursor-not-allowed'}`}
            >
              {forgotBusy ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
        </div>
      )}

      {/* ── Reset-completion sheet ────────────────────────────────── */}
      {isReset && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center">
          <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-6">
            <h3 className="text-heading-2 font-extrabold text-black leading-tight mb-1">Set a new password</h3>
            <p className="text-meta text-b3 leading-snug mb-3">
              Choose a strong password (6+ characters). You'll stay signed in.
            </p>
            <input
              type={showPwd ? 'text' : 'password'}
              value={resetPwd}
              onChange={e => setResetPwd(e.target.value)}
              autoComplete="new-password"
              placeholder="New password"
              className="w-full bg-bg5 rounded-[14px] px-4 py-3 text-body text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 mb-2"
              onKeyDown={e => e.key === 'Enter' && completeReset()}
            />
            <button
              type="button"
              onClick={() => setShowPwd(v => !v)}
              className="text-meta font-extrabold text-b3 mb-3"
            >
              {showPwd ? 'Hide password' : 'Show password'}
            </button>
            <button
              onClick={completeReset}
              disabled={resetBusy || resetPwd.length < 6}
              className={`w-full rounded-[14px] py-3.5 text-body-lg font-extrabold transition-all
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
