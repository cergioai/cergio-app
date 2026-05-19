// Per design-spec.md — Sign in / Sign up screen wired to Supabase auth.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';

export function AuthScreen() {
  const navigate = useNavigate();
  const { auth, showToast } = useOutletContext();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);

  const valid = email.includes('@') && password.length >= 6 && (mode === 'signin' || displayName.trim().length > 0);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await auth.signUp(email.trim(), password, displayName.trim());
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

  return (
    <div className="flex-1 flex flex-col bg-cr pb-8">
      <div className="flex flex-col items-center pt-16 pb-8">
        <Logo size={64} />
        <h1 className="text-[28px] font-extrabold text-black tracking-widest uppercase mt-4">Cergio</h1>
      </div>

      <div className="px-7">
        {/* tabs */}
        <div className="bg-bg5 rounded-pill p-1 flex mb-6">
          {['signin', 'signup'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-pill py-3 text-[14px] font-extrabold transition-all
                ${mode === m ? 'bg-white text-black shadow-card' : 'text-black/70'}`}
            >
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        {mode === 'signup' && (
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
          {busy ? 'Please wait…' : (mode === 'signin' ? 'Sign in' : 'Create account')}
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
