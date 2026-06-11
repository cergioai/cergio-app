// Bottom-sheet modal for connecting a TikTok account to a Cergio profile.
// Mirrors InstagramConnectModal in layout and behavior. Two paths:
//   (1) "Connect with TikTok" button — stubbed until we ship the TikTok
//       OAuth edge function (parallel to instagram-oauth). When VITE_TIKTOK_-
//       CLIENT_KEY is set, this opens a popup to TikTok's authorize URL;
//       until then, focuses the manual handle field with a friendly note.
//   (2) Manual handle + audience (follower count) entry — always available.
//
// Used by:
//   - RainmakerInstagramScreen (optional TikTok alongside required IG)
//   - ServiceListAboutScreen   (optional)
//   - ProfileScreen            (manage / re-connect later)
import { useEffect, useRef, useState } from 'react';

// TikTok OAuth config. Public client key + redirect URI come from build env.
// If VITE_TIKTOK_CLIENT_KEY is unset we silently fall back to manual entry.
const TIKTOK_CLIENT_KEY = import.meta.env.VITE_TIKTOK_CLIENT_KEY || '';
const TIKTOK_REDIRECT   = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tiktok-oauth/callback`;
// user.info.basic gives open_id + display_name + avatar. follower_count needs
// user.info.profile, which is only granted post-App-Review. Flip via env:
//   VITE_TIKTOK_SCOPES=user.info.basic,user.info.profile
// when the production TikTok app passes review.
const TIKTOK_SCOPES = import.meta.env.VITE_TIKTOK_SCOPES || 'user.info.basic';

function buildTikTokAuthUrl(state) {
  const params = new URLSearchParams({
    client_key:    TIKTOK_CLIENT_KEY,
    scope:         TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri:  TIKTOK_REDIRECT,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

function formatFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

export function TikTokConnectModal({
  initialHandle = '',
  initialFollowers = '',
  title = 'Connect your TikTok',
  subtitle = 'We pull your handle + audience size so providers know the reach you offer.',
  onSave,        // async ({ handle, followers, verified }) => void
  onClose,
}) {
  const [handle,    setHandle]    = useState(initialHandle.replace(/^@/, ''));
  const [followers, setFollowers] = useState(initialFollowers ? String(initialFollowers) : '');
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const popupRef = useRef(null);

  // Listen for postMessage from the future tiktok-oauth edge function's
  // callback page. Same shape as the IG flow but tagged 'cergio-tt-oauth'.
  useEffect(() => {
    function onMessage(ev) {
      const data = ev?.data;
      if (!data || data.source !== 'cergio-tt-oauth') return;
      setOauthBusy(false);
      try { popupRef.current?.close?.(); } catch {}
      if (!data.ok) {
        setErr(data.error || 'TikTok connect failed.');
        return;
      }
      if (data.handle) setHandle(String(data.handle).replace(/^@/, ''));
      if (Number.isFinite(+data.followers)) setFollowers(String(+data.followers));
      (async () => {
        setBusy(true);
        setErr(null);
        try {
          await onSave({
            handle:    String(data.handle || '').trim(),
            followers: Number.isFinite(+data.followers) ? +data.followers : null,
            verified:  true,
          });
        } catch (e) {
          setErr(e?.message || 'Saved on TikTok but could not write to your profile.');
          setBusy(false);
        }
      })();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSave]);

  const startTikTokOauth = () => {
    if (!TIKTOK_CLIENT_KEY) {
      // Not configured yet — fall back to manual entry.
      document.getElementById('tt-handle')?.focus();
      return;
    }
    setErr(null);
    setOauthBusy(true);
    const state = crypto.randomUUID();
    const w = 540, h = 720;
    const left = window.screenX + Math.max(0, (window.outerWidth  - w) / 2);
    const top  = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    popupRef.current = window.open(
      buildTikTokAuthUrl(state),
      'cergio-tt-oauth',
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`,
    );
    if (!popupRef.current) {
      setOauthBusy(false);
      setErr('Popup blocked. Allow popups for this site and try again.');
      return;
    }
    const poll = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(poll);
        setOauthBusy(false);
      }
    }, 600);
  };

  const followersOk = followers === '' || /^\d{1,9}$/.test(followers);
  const valid       = handle.trim().length >= 2 && followersOk;
  const previewFollowers = formatFollowers(parseInt(followers, 10));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        handle:    handle.trim(),
        followers: followers ? parseInt(followers, 10) : null,
      });
    } catch (e) {
      setErr(e?.message || 'Could not save. Try again?');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />

        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-[10px] bg-black flex items-center justify-center flex-shrink-0">
            {/* Stylized TikTok glyph (music note in a square) */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/>
            </svg>
          </div>
          <h2 className="text-heading-2 font-extrabold text-black">{title}</h2>
        </div>
        <p className="text-body-sm text-b3 mb-4 leading-relaxed">{subtitle}</p>

        {/* "Connect with TikTok" — opens TikTok OAuth popup when configured;
            falls back to focusing the manual field when VITE_TIKTOK_CLIENT_KEY isn't set. */}
        <button
          type="button"
          onClick={startTikTokOauth}
          disabled={oauthBusy || busy}
          className="w-full mb-3 bg-black text-white rounded-[24px] py-3 text-body font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all flex items-center justify-center gap-2
                     disabled:opacity-60 disabled:cursor-wait"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M16.6 5.82a4.28 4.28 0 0 1-2.6-1.82V14.5a3.5 3.5 0 1 1-3.5-3.5v2.06a1.44 1.44 0 1 0 1.44 1.44V2h2.06a4.27 4.27 0 0 0 4.27 4.27v2.06a6.34 6.34 0 0 1-1.67-.22v-2.29z"/>
          </svg>
          {oauthBusy ? 'Waiting for TikTok…' : 'Connect with TikTok'}
        </button>
        <p className="text-meta-sm text-b3 mb-4 leading-snug text-center">
          {TIKTOK_CLIENT_KEY
            ? 'Sign in to TikTok in the popup — we\'ll pull your handle + audience.'
            : 'One-tap TikTok login is rolling out — until then, fill the fields below.'}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-meta font-extrabold text-black mb-1">Handle</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-body text-b3">@</span>
              <input
                id="tt-handle"
                type="text"
                value={handle}
                onChange={e => setHandle(e.target.value.replace(/^@/, ''))}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full bg-bg5 rounded-[12px] pl-8 pr-4 py-3 text-body text-black
                           placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-meta font-extrabold text-black mb-1">Audience size (followers)</label>
            <input
              type="text"
              inputMode="numeric"
              value={followers}
              onChange={e => setFollowers(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 12500"
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
            {previewFollowers && (
              <p className="text-meta-sm text-b3 mt-1">≈ <strong className="text-black">{previewFollowers}</strong> followers</p>
            )}
            {!followersOk && (
              <p className="text-meta-sm text-danger mt-1">Numbers only, please.</p>
            )}
          </div>

          {err && <p className="text-meta text-danger font-extrabold">{err}</p>}

          <button
            type="submit"
            disabled={!valid || busy}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all mt-1
              ${valid && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Saving…' : 'Save TikTok'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-full text-body-sm font-extrabold text-b3 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
