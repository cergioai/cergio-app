// CERGIO-GUARD (2026-06-17, Tarik): "add a recommend button next to a service…
// for services already on the platform" + "a box to add a review when adding a
// recommendation". Bottom-sheet popup opened from a service page. Writes a
// recommendation LINKED to the real service_id (recommendService), so it shows
// on the provider's profile ("People who love {name}") and the recommender's
// Go-Tos. The review text is the recommender's own words (no fake data).
import { useState } from 'react';
import { recommendService } from '../../lib/api';

export function RecommendProviderModal({ serviceId, providerName, onClose, onDone }) {
  const [review, setReview] = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState(null);
  const first = (providerName || 'this provider').split(' ')[0];

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!review.trim()) { setErr('Add a short review so your friends know why.'); return; }
    setBusy(true); setErr(null);
    const { error } = await recommendService(serviceId, { review });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not send — try again.'); return; }
    onDone?.();
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">
          Recommend {first}
        </h2>
        <p className="text-meta text-b3 mb-3 leading-relaxed">
          Your recommendation shows on {first}&apos;s profile and your own Go-Tos, and helps friends
          who trust you find them.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-meta font-extrabold text-black mb-1">Your review</label>
            <textarea
              value={review}
              onChange={e => setReview(e.target.value)}
              rows={4}
              autoFocus
              placeholder={`What makes ${first} great? (e.g. "On time, spotless work, would book again.")`}
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
            />
          </div>

          {err && <p className="text-meta text-danger font-extrabold">{err}</p>}

          <button
            type="submit"
            disabled={busy || !review.trim()}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${review.trim() && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Sending…' : 'Post recommendation'}
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
