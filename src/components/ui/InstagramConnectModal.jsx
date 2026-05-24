// Bottom-sheet modal for connecting an Instagram account to a Cergio
// profile. Today: user enters handle + follower count manually. Tomorrow
// (when Meta/Instagram OAuth is wired): the "Connect with Instagram"
// button kicks off the real OAuth dance instead, and the manual fields
// are pre-filled / hidden.
//
// Used by:
//   - RainmakerInstagramScreen (required step of Rainmaker apply flow)
//   - ServiceListAboutScreen   (optional connect for providers)
//   - ProfileScreen            (manage / re-connect later)
import { useState } from 'react';

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

        {/* "Connect with Instagram" — placeholder for future OAuth. For now
            it just focuses the handle field with a friendly note. */}
        <button
          type="button"
          onClick={() => {
            document.getElementById('ig-handle')?.focus();
          }}
          className="w-full mb-3 bg-black text-white rounded-pill py-3 text-[14px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
          </svg>
          Connect with Instagram
        </button>
        <p className="text-[11px] text-b3 mb-4 leading-snug text-center">
          One-tap Instagram login is rolling out — until then, fill the fields below.
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
              <p className="text-[11px] text-[#A32D2D] mt-1">Numbers only, please.</p>
            )}
          </div>

          {err && <p className="text-[12px] text-[#A32D2D] font-bold">{err}</p>}

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
