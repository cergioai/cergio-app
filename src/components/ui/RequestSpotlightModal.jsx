// Provider → Connector: ask for a paid spotlight on IG / TT.
// Shows the Connector's rate card (snapshotted in the request), lets the
// provider pick a platform if both are offered, adds a short message, and
// fires createSpotlightRequest(). The Connector sees this in their inbox
// and can Accept / Counter (lower price) / Decline.
import { useState } from 'react';
import { createSpotlightRequest } from '../../lib/api';
import { PLATFORM_FEE_RATE, platformFeeCents, sellerEarningsCents, fmtDollars } from '../../lib/fees';

const fmtPrice = fmtDollars;

export function RequestSpotlightModal({ connector, onClose, onSent }) {
  // Available platforms = the ones the Connector priced. Default to the
  // cheaper one (more likely they'll accept).
  const igPrice = connector.spotlight_price_instagram_cents;
  const ttPrice = connector.spotlight_price_tiktok_cents;
  const platforms = [];
  if (igPrice != null) platforms.push({ id: 'instagram', label: 'Instagram', cents: igPrice });
  if (ttPrice != null) platforms.push({ id: 'tiktok',    label: 'TikTok',    cents: ttPrice });
  const [platform, setPlatform] = useState(platforms[0]?.id || 'instagram');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const picked = platforms.find(p => p.id === platform) || platforms[0];

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!picked || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await createSpotlightRequest({
      connectorId: connector.id,
      platform:    picked.id,
      officialPriceCents: picked.cents,
      message,
    });
    setBusy(false);
    if (error) {
      setErr(error.message || 'Could not send.');
      return;
    }
    onSent?.();
    onClose?.();
  };

  const connectorName = connector.display_name
    || (connector.instagram_handle && `@${connector.instagram_handle}`)
    || (connector.tiktok_handle && `@${connector.tiktok_handle}`)
    || 'Connector';

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">
          Request a spotlight from {connectorName}
        </h2>
        <p className="text-[12px] text-b3 mb-4 leading-relaxed">
          They'll see your message + service. They can accept at rate-card price,
          counter at a lower price, or decline.
        </p>

        {platforms.length === 0 ? (
          <p className="text-[13px] text-b3 mb-4">
            This Connector hasn't set a rate card yet. Send them a friend invite
            instead.
          </p>
        ) : (
          <>
            {platforms.length > 1 && (
              <div className="flex gap-2 mb-3">
                {platforms.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={`flex-1 rounded-[14px] py-3 text-[13px] font-extrabold transition-all
                      ${platform === p.id
                        ? 'bg-gl text-gd border-2 border-g'
                        : 'bg-bg5 text-b2 border-2 border-transparent hover:border-g/30'}`}
                  >
                    {p.label}
                    <span className="block text-[11px] font-bold mt-0.5">{fmtPrice(p.cents)} / post</span>
                  </button>
                ))}
              </div>
            )}

            {/* Fee breakdown — transparent so providers know where their money goes. */}
            {picked && (
              <div className="bg-bg5/60 border border-bdr rounded-[14px] px-3.5 py-3 mb-3">
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className="text-b2">You pay</span>
                  <span className="font-extrabold text-black">{fmtPrice(picked.cents)}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-b3">
                  <span>Connector earns</span>
                  <span>{fmtPrice(sellerEarningsCents(picked.cents))}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-b3">
                  <span>Cergio fee ({Math.round(PLATFORM_FEE_RATE * 100)}%)</span>
                  <span>{fmtPrice(platformFeeCents(picked.cents))}</span>
                </div>
              </div>
            )}
          </>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="block text-[12px] font-extrabold text-black mb-1">Message (optional)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, 600))}
              placeholder="Tell them about your service + why you'd love a spotlight…"
              rows={3}
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-[13px] text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
            />
            <p className="text-[10px] text-b3 mt-1 text-right">{message.length} / 600</p>
          </div>

          {err && <p className="text-[12px] text-danger font-bold">{err}</p>}

          <button
            type="submit"
            disabled={!picked || busy}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${picked && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Sending…' : `Send request${picked ? ` · ${fmtPrice(picked.cents)}` : ''}`}
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
