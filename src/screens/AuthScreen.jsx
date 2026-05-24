// Per design-spec.md — Sign in / Sign up screen wired to Supabase auth.
// Sign up requires: display name + email + phone + password (≥6).
// Sign in: email + password.
// Social: Google (Supabase native), Instagram + TikTok (stubbed until we
// ship dedicated edge functions that create Supabase users from those
// OAuth identities — for now they route to the existing connect modals
// inside Profile after sign-in).
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';

// Very loose phone validation — 7+ digits, optional + and spaces. We're not
// SMS-verifying it in the auth flow today; this just blocks obvious typos.
function phoneValid(s) {
  const digits = (s || '').replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function AuthScreen() {
  const navigate = useNavigate();
  const { auth, showToast } = useOutletContext();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [socialBusy, setSocialBusy] = useState(null); // 'google'|'instagram'|'tiktok'|null

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
        const { error } = await auth.signUp(email.trim(), password, displayName.trim(), phone.trim());
        if (error) { showToast(error.message); return; }
        showToast('Account created — check your email if confirmation is on');
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
        showToast('TikTok sign-in is coming soon — use email or Google for now.');
      }
    } finally {
      setSocialBusy(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-cr pb-8 overflow-y-auto">
      <div className="flex flex-col items-center pt-14 pb-6">
        <Logo size={64} />
        <h1 className="text-[28px] font-extrabold text-black tracking-wide mt-4">Cergio</h1>
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
            className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-3
                       text-[13px] font-extrabold text-black hover:bg-bg5/40 transition-colors
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
            className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-3
                       text-[13px] font-extrabold text-black hover:bg-bg5/40 transition-colors
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
            className="flex items-center justify-center gap-1.5 bg-white border border-bdr rounded-[12px] py-3
                       text-[13px] font-extrabold text-black hover:bg-bg5/40 transition-colors
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
            <label className="block text-[14px] font-extrabold text-black mb-2">Your name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Tarik"
              className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-[14px] font-extrabold text-black mb-2">Email</label>
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
            <label className="block text-[14px] font-extrabold text-black mb-2">
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
            {phone && !phoneValid(phone) && (
              <p className="text-[11px] text-danger mt-1.5">Enter 7–15 digits (include country code).</p>
            )}
          </div>
        )}

        <div className="mb-6">
          <label className="block text-[14px] font-extrabold text-black mb-2">Password</label>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 6 characters"
            className="w-full bg-bg5 rounded-[14px] px-4 py-4 text-[14px] text-black
                       placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        <button
          onClick={submit}
          disabled={!valid || busy}
          className={`w-full rounded-[24px] py-4 text-[15px] font-extrabold transition-all
            ${valid && !busy
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {busy ? 'Please wait…' : (isSignup ? 'Create account' : 'Sign in')}
        </button>

        <button
          onClick={() => navigate('/home')}
          className="w-full mt-4 text-[14px] font-extrabold text-b3 underline underline-offset-2"
        >
          Continue as guest
        </button>
      </div>
    </div>
  );
}
