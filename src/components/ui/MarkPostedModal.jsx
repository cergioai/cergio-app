// Connector marks a spotlight as posted. Captures the public IG/TT URL
// so the Provider can verify + dispute if needed. Fires markSpotlightPosted
// which kicks off the "please confirm" email to the Provider.
import { useState } from 'react';
import { markSpotlightPosted } from '../../lib/api';

export function MarkPostedModal({ request, onClose, onPosted }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const platformLabel = request.platform === 'instagram' ? 'Instagram' : 'TikTok';
  const placeholder = request.platform === 'instagram'
    ? 'https://www.instagram.com/p/...'
    : 'https://www.tiktok.com/@you/video/...';

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await markSpotlightPosted(request.id, { postedUrl: url });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not save.'); return; }
    onPosted?.();
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">
          Mark spotlight as posted
        </h2>
        <p className="text-meta text-b3 mb-4 leading-relaxed">
          Paste the public link to your {platformLabel} post. The provider
          will get an email to confirm and your funds release as soon as they do.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-meta font-extrabold text-black mb-1">Post URL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
            />
          </div>

          {err && <p className="text-meta text-danger font-extrabold">{err}</p>}

          <button
            type="submit"
            disabled={busy || !url.trim()}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${url.trim() && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Saving…' : 'Mark as posted'}
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
