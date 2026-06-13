// CERGIO-GUARD (2026-06-12): Connector marks the IG spotlight for a FREE
// booking as posted — the "Confirm Instagram Post" step on Tarik's flow
// board ("Unlocks App for GOAT"). Captures the public IG URL so the
// provider can review + accept (or flag). Until the provider accepts,
// the Connector's free-service ordering stays locked.
//
// Mirrors MarkPostedModal (spotlights) — same sheet anatomy, booking
// barter wiring underneath (markBookingPosted in lib/api).
import { useState } from 'react';
import { markBookingPosted } from '../../lib/api';

export function MarkBookingPostedModal({ booking, onClose, onPosted }) {
  const [url, setUrl]   = useState(booking?.post_url || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const providerFirst = (booking?.provider?.display_name || 'the provider').split(' ')[0];
  const reposting = !!booking?.post_flag_reason;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await markBookingPosted(booking.id, { postUrl: url });
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
          {reposting ? 'Update your Instagram post' : 'Confirm your Instagram post'}
        </h2>
        <p className="text-meta text-b3 mb-3 leading-relaxed">
          Paste the public link to your Instagram post about{' '}
          <span className="font-extrabold text-black">{booking?.service?.title || 'the service'}</span>.
          It's shared on your Cergio activity, and {providerFirst} gets notified to
          accept it — that completes the barter and unlocks your next free service.
        </p>
        {reposting && (
          <div className="bg-warnBg border border-warn/40 rounded-[12px] px-3 py-2 mb-3">
            <p className="text-meta-sm font-extrabold text-warnText">
              {providerFirst} flagged: “{booking.post_flag_reason}”
            </p>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-meta font-extrabold text-black mb-1">Post URL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/..."
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
            {busy ? 'Saving…' : reposting ? 'Resubmit post' : 'Mark as posted'}
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
