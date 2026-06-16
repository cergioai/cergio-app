// Connector completes a FREE barter: RATE the service + post the IG spotlight in
// ONE step (Tarik 2026-06-15 — "rate and initiate IG post"). 4★+ publishes the
// spotlight and completes the barter. Below 4★, the post is HELD: the Connector
// must explain (private review shared with the provider + analyzed by Cergio),
// and the provider can reply / escalate (module 2). markBookingPosted +
// createReview in lib/api do the writes.
import { useState, useEffect } from 'react';
import { markBookingPosted, createReview, getMyEarningsSummary } from '../../lib/api';
import { buildInviteUrl } from '../../lib/referral';

const fmtUsd = (cents) => `$${Math.round((cents || 0) / 100).toLocaleString()}`;

function Stars({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map(i => (
        <button type="button" key={i} onClick={() => onChange(i)} aria-label={`${i} star`} className="p-0.5">
          <svg width="34" height="34" viewBox="0 0 24 24">
            <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
              fill={i <= value ? '#4AA901' : '#E5E5E3'} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function MarkBookingPostedModal({ booking, connectorId, onClose, onPosted }) {
  const [url, setUrl]         = useState(booking?.post_url || '');
  const [stars, setStars]     = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);
  const [copied, setCopied]   = useState(false);
  const [showBio, setShowBio] = useState(false);
  const [earn, setEarn]       = useState(null);
  useEffect(() => {
    let cancelled = false;
    getMyEarningsSummary().then(({ data }) => { if (!cancelled) setEarn(data || null); });
    return () => { cancelled = true; };
  }, []);
  const providerFirst = (booking?.provider?.display_name || 'the provider').split(' ')[0];
  const reposting = !!booking?.post_flag_reason;
  const lowRating = stars > 0 && stars < 4;

  // The connector's UNIQUE referral link (Tarik 2026-06-15): every signup
  // through it credits them (7% up to $250). `?s=` ties the click to THIS
  // spotlight for the auto-audit once Meta Graph is approved.
  const spotlightLink = connectorId
    ? `${buildInviteUrl(connectorId)}${buildInviteUrl(connectorId).includes('?') ? '&' : '?'}s=${booking?.id || ''}`
    : '';
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(spotlightLink); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setErr('Copy failed — long-press the link to copy.'); }
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!stars) { setErr('Please rate the service first.'); return; }
    if (lowRating && !comment.trim()) { setErr('Please explain what went wrong.'); return; }
    if (!lowRating && !/^https?:\/\//i.test(url.trim())) { setErr('Paste the public link to your Instagram post.'); return; }
    setBusy(true);
    setErr(null);

    // Save the rating either way — it's shared with the provider (private).
    const { error: revErr } = await createReview(booking.id, stars, comment.trim());
    if (revErr && !/duplicate/i.test(revErr.message || '')) { setBusy(false); setErr(revErr.message); return; }

    if (lowRating) {
      // Below 4★ → the IG post is HELD. The provider is notified to review the
      // rating and can reply / escalate (module 2). No markBookingPosted.
      setBusy(false);
      onPosted?.({ heldForLowRating: true });
      onClose?.();
      return;
    }

    // 4★+ → publish the spotlight, completing the barter.
    const { error } = await markBookingPosted(booking.id, { postUrl: url });
    setBusy(false);
    if (error) { setErr(error.message || 'Could not save.'); return; }
    onPosted?.();
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">
          {reposting ? 'Update your spotlight' : 'Rate & post your spotlight'}
        </h2>
        <p className="text-meta text-b3 mb-3 leading-relaxed">
          Rate your <span className="font-extrabold text-black">{booking?.service?.title || 'service'}</span>{' '}
          from {providerFirst}, then post your Instagram spotlight to finish the barter and
          unlock your next free service.
        </p>
        {reposting && (
          <div className="bg-warnBg border border-warn/40 rounded-[12px] px-3 py-2 mb-3">
            <p className="text-meta-sm font-extrabold text-warnText">
              {providerFirst} flagged: &ldquo;{booking.post_flag_reason}&rdquo;
            </p>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-meta font-extrabold text-black mb-1.5">Your rating</label>
            <Stars value={stars} onChange={setStars} />
          </div>

          {lowRating ? (
            <>
              {/* Below-4★ private-review flow (Tarik 2026-06-15). */}
              <div>
                <label className="block text-meta font-extrabold text-black mb-1">
                  Explain why the service was poor
                </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={3}
                  placeholder="What went wrong?"
                  className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
                />
              </div>
              <div className="bg-cr2 border border-bdr rounded-[12px] px-3.5 py-3">
                <p className="text-meta text-b2 leading-snug">
                  Your review will be shared with the provider and analyzed by Cergio. The
                  Instagram post is on hold until the rating is resolved — providers need a
                  4★+ rating for the spotlight to go live.
                </p>
                <p className="text-meta-sm text-b3 leading-snug mt-1.5">
                  These reviews are <span className="font-extrabold">private, not public</span>.
                  Cergio is built on truthful reviews from trusted friends — not gamed reviews
                  from strangers.
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Unique link + earnings hook */}
              {spotlightLink && (
                <div className="bg-gl border border-g/30 rounded-[14px] p-3.5">
                  <p className="text-meta font-extrabold text-gd mb-1.5">Your spotlight link</p>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-meta text-black bg-white rounded-[10px] px-2.5 py-2 border border-bdr">{spotlightLink}</span>
                    <button type="button" onClick={copyLink}
                      className="bg-g text-white rounded-[10px] px-3 py-2 text-meta font-extrabold whitespace-nowrap">
                      {copied ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-meta-sm text-b2 mt-1.5 leading-snug">
                    Every signup through your link earns you <span className="font-extrabold text-gd">7% of their spend, up to $250</span>.
                  </p>
                  {earn && (earn.earnedCents > 0 || earn.pendingCents > 0) && (
                    <p className="text-meta-sm text-gd font-extrabold mt-1.5 pt-1.5 border-t border-g/20">
                      You've earned {fmtUsd(earn.earnedCents)}{earn.pendingCents > 0 ? ` · ${fmtUsd(earn.pendingCents)} pending` : ''}
                    </p>
                  )}
                </div>
              )}

              {/* Effortless 3-step Story flow */}
              <ol className="text-meta text-b2 leading-snug flex flex-col gap-1.5 pl-4 list-decimal">
                <li><span className="font-extrabold text-black">Copy your link</span> above.</li>
                <li>Open Instagram → add this service to your <span className="font-extrabold text-black">Story</span> → tap the <span className="font-extrabold text-black">Link sticker</span> → paste.</li>
                <li>Save the Story to a <span className="font-extrabold text-black">“Spotlights” Highlight</span> so the link keeps working past 24h.</li>
              </ol>
              <a href="https://instagram.com" target="_blank" rel="noreferrer"
                 className="block text-center bg-black text-white rounded-[14px] py-2.5 text-body-sm font-extrabold active:scale-[.98] transition-all">
                Open Instagram
              </a>

              {/* Bio-link upsell — the always-on converter */}
              <button type="button" onClick={() => setShowBio(s => !s)}
                className="text-meta-sm text-gd font-extrabold text-left">
                {showBio ? '– ' : '+ '}Put this link in your bio too — earns on every post
              </button>
              {showBio && (
                <p className="text-meta text-b3 leading-snug -mt-1">
                  Instagram → Edit profile → add your link under <span className="font-extrabold">Links</span>. One-time
                  setup; then every post routes through it. Posting to your feed? Tag <span className="font-extrabold">@cergio</span> + <span className="font-extrabold">#cergiofeed</span>.
                </p>
              )}

              {/* Confirm — paste the Story Highlight / post link for the record */}
              <div>
                <label className="block text-meta font-extrabold text-black mb-1">Paste your Story-Highlight or post link</label>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.instagram.com/..."
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black placeholder-b3 outline-none focus:ring-2 focus:ring-g/30"
                />
              </div>
            </>
          )}

          {err && <p className="text-meta text-danger font-extrabold">{err}</p>}

          <button
            type="submit"
            disabled={busy || !stars}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${stars && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Saving…' : lowRating ? 'Submit review' : reposting ? 'Resubmit spotlight' : 'Rate & post spotlight'}
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
