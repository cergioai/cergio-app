// Connector → Provider: counter-offer a lower price on an inbound spotlight
// request. Provider sees the new price + savings vs the original rate-card
// price. Cergio fee (10%) still comes off the agreed price.
import { useState } from 'react';
import { counterSpotlightRequest } from '../../lib/api';
import { PLATFORM_FEE_RATE, platformFeeCents, sellerEarningsCents, fmtDollars } from '../../lib/fees';

export function CounterSpotlightModal({ request, onClose, onCountered }) {
  const officialCents = request.official_price_cents;
  // Default suggestion: 80% of official (a friendly 20% off).
  const suggested = Math.max(0, Math.round(officialCents * 0.8) / 100);
  const [dollars, setDollars] = useState(String(suggested));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const offerCents = (dollars === '' || dollars == null)
    ? null
    : Math.max(0, Math.round(+dollars * 100));
  const valid = offerCents != null && offerCents > 0 && offerCents < officialCents;
  const savingsCents = offerCents != null ? Math.max(0, officialCents - offerCents) : 0;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await counterSpotlightRequest(request.id, { offeredPriceCents: offerCents });
    setBusy(false);
    if (error) {
      setErr(error.message || 'Could not send counter.');
      return;
    }
    onCountered?.();
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">
          Offer a lower price
        </h2>
        <p className="text-[12px] text-b3 mb-4 leading-relaxed">
          Your rate card says <strong className="text-black">{fmtDollars(officialCents)}</strong>{' '}
          for {request.platform === 'instagram' ? 'an Instagram' : 'a TikTok'} post.
          Offer a discount and they'll see the savings.
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="bg-white border-2 border-bdr rounded-[14px] px-3.5 py-3 flex items-center gap-2 focus-within:border-g">
            <span className="text-[16px] font-extrabold text-b3">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={dollars}
              onChange={e => setDollars(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              className="flex-1 bg-transparent text-[20px] font-extrabold text-black outline-none"
              autoFocus
            />
            <span className="text-[12px] font-bold text-b3">/post</span>
          </div>

          {/* Breakdown card */}
          {valid && (
            <div className="bg-gl border border-g/30 rounded-[14px] px-3.5 py-3">
              <div className="flex items-center justify-between text-[13px] mb-1">
                <span className="text-gd font-bold">They save</span>
                <span className="font-extrabold text-gd">{fmtDollars(savingsCents)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-gd/80">
                <span>You earn</span>
                <span>{fmtDollars(sellerEarningsCents(offerCents))}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-gd/80">
                <span>Cergio fee ({Math.round(PLATFORM_FEE_RATE * 100)}%)</span>
                <span>{fmtDollars(platformFeeCents(offerCents))}</span>
              </div>
            </div>
          )}
          {offerCents != null && offerCents >= officialCents && (
            <p className="text-[12px] text-danger font-bold">
              Counter must be less than your rate card ({fmtDollars(officialCents)}).
            </p>
          )}
          {err && <p className="text-[12px] text-danger font-bold">{err}</p>}

          <button
            type="submit"
            disabled={!valid || busy}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${valid && !busy
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Sending…' : 'Send counter-offer'}
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
