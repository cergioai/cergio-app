// Bottom-sheet modal for connecting an Instagram account to a Cergio
// profile. Two paths:
//   (1) "Connect with Instagram" button — opens a popup to Meta OAuth.
//       When VITE_META_APP_ID is configured, this triggers the real OAuth
//       dance (popup → Meta authorize → our edge function callback →
//       postMessage back to this window). On success we auto-save and
//       close. Verified flag flips to true.
//   (2) Manual handle + follower count entry — always available as a
//       fallback (and the only path while Meta app credentials aren't set).
//
// Used by:
//   - RainmakerInstagramScreen (required step of Connector apply flow)
//   - ServiceListAboutScreen   (optional connect for providers)
//   - ProfileScreen            (manage / re-connect later)
import { useEffect, useRef, useState } from 'react';

// Meta OAuth config. Public client ID + redirect URI come from build env.
// If VITE_META_APP_ID is unset we silently fall back to manual entry.
const META_APP_ID   = import.meta.env.VITE_META_APP_ID || '';
const META_REDIRECT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-oauth/callback`;
// Scope: instagram_business_basic gives username + account_type. Adding
// instagram_business_manage_insights pulls followers_count in /me. Verified
// working end-to-end on 2026-05-24 against tarikromio (Creator account).
const META_SCOPES   = 'instagram_business_basic,instagram_business_manage_insights';

function buildInstagramAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:            META_APP_ID,
    redirect_uri:         META_REDIRECT,
    response_type:        'code',
    scope:                META_SCOPES,
    state,
    force_authentication: '1',
    enable_fb_login:      '0',
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

function formatFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

export function InstagramConnectModal({
  initialHandle = '',
  initialFollowers = '',
  title = 'Connect your Instagram',
  subtitle = 'We use this to verify the spotlights you post for providers.',
  onSave,        // async ({ handle, followers }) => void
  onClose,
}) {
  const [handle,    setHandle]    = useState(initialHandle.replace(/^@/, ''));
  const [followers, setFollowers] = useState(initialFollowers ? String(initialFollowers) : '');
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const popupRef = useRef(null);

  // Listen for the postMessage sent by the edge function's callback page.
  // We only react to messages tagged 'cergio-ig-oauth' so other origins
  // can't spoof a connect. We deliberately don't check ev.origin because
  // the popup lives on the Supabase functions domain while the app may run
  // on Vercel — the source tag + presence of an opener is our guard.
  useEffect(() => {
    function onMessage(ev) {
      const data = ev?.data;
      if (!data || data.source !== 'cergio-ig-oauth') return;
      setOauthBusy(false);
      try { popupRef.current?.close?.(); } catch {}
      if (!data.ok) {
        setErr(data.error || 'Instagram connect failed.');
        return;
      }
      // Pre-fill so the user sees what came back even if persistence fails.
      if (data.handle) setHandle(String(data.handle).replace(/^@/, ''));
      if (Number.isFinite(+data.followers)) setFollowers(String(+data.followers));
      // Auto-save — no need to make them press the button again.
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
          setErr(e?.message || 'Saved on Instagram but could not write to your profile.');
          setBusy(false);
        }
      })();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSave]);

  const startInstagramOauth = () => {
    if (!META_APP_ID) {
      // Not configured yet — fall back to manual entry, focus the handle field.
      document.getElementById('ig-handle')?.focus();
      return;
    }
    setErr(null);
    setOauthBusy(true);
    const state = crypto.randomUUID();
    const w = 540, h = 720;
    const left = window.screenX + Math.max(0, (window.outerWidth  - w) / 2);
    const top  = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    popupRef.current = window.open(
      buildInstagramAuthUrl(state),
      'cergio-ig-oauth',
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`,
    );
    if (!popupRef.current) {
      setOauthBusy(false);
      setErr('Popup blocked. Allow popups for this site and try again.');
      return;
    }
    // Clear the spinner if the user closes the popup without finishing.
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
            </svg>
          </div>
          <h2 className="text-[18px] font-extrabold text-black">{title}</h2>
        </div>
        <p className="text-[13px] text-b3 mb-4 leading-relaxed">{subtitle}</p>

        {/* "Connect with Instagram" — opens Meta OAuth popup when configured;
            falls back to focusing the manual field when VITE_META_APP_ID isn't set. */}
        <button
          type="button"
          onClick={startInstagramOauth}
          disabled={oauthBusy || busy}
          className="w-full mb-3 bg-black text-white rounded-[24px] py-3 text-[14px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all flex items-center justify-center gap-2
                     disabled:opacity-60 disabled:cursor-wait"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
          </svg>
          {oauthBusy ? 'Waiting for Instagram…' : 'Connect with Instagram'}
        </button>
        <p className="text-[11px] text-b3 mb-4 leading-snug text-center">
          {META_APP_ID
            ? 'Sign in to Instagram in the popup — we\'ll pull your handle + follower count.'
            : 'One-tap Instagram login is rolling out — until then, fill the fields below.'}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-[12px] font-extrabold text-black mb-1">Handle</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-b3">@</span>
              <input
                id="ig-handle"
                type="text"
                value={handle}
                onChange={e => setHandle(e.target.value.replace(/^@/, ''))}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full bg-bg5 rounded-[12px] pl-8 pr-4 py-3 text-[14px] text-black
                           placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-extrabold text-black mb-1">Follower count</label>
            <input
              type="text"
              inputMode="numeric"
              value={followers}
              onChange={e => setFollowers(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 6974"
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-[14px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
            {previewFollowers && (
              <p className="text-[11px] text-b3 mt-1">≈ <strong className="text-black">{previewFollowers}</strong> followers</p>
            )}
            {!followersOk && (
              <p className="text-[11px] text-danger mt-1">Numbers only, please.</p>
            )}
          </div>

          {err && <p className="text-[12px] text-danger font-bold">{err}</p>}

          <button
            type="submit"
            disabled={!valid || busy}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all mt-1
              ${valid && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Saving…' : 'Save Instagram'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-full text-[13px] font-extrabold text-b3 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
