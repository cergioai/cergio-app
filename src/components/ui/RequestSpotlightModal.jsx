// Provider → Connector: ask for a paid spotlight on IG / TT.
// Shows the Connector's rate card (snapshotted in the request), lets the
// provider pick a platform if both are offered, adds a short message, and
// fires createSpotlightRequest(). The Connector sees this in their inbox
// and can Accept / Counter (lower price) / Decline.
import { useEffect, useState } from 'react';
import { createSpotlightRequest, listMyServices } from '../../lib/api';
import { PLATFORM_FEE_RATE, platformFeeCents, sellerEarningsCents, fmtDollars } from '../../lib/fees';

const fmtPrice = fmtDollars;

export function RequestSpotlightModal({ connector, onClose, onSent }) {
  // Available platforms. A priced platform uses the rate card; a connected
  // handle with NO price is a free/swap platform (cents = 0).
  // CERGIO-GUARD (2026-06-05): the old code only listed PRICED platforms,
  // so a free/swap Connector (both rates NULL) produced platforms=[] and
  // the modal dead-ended with "no rate card — send a friend invite".
  // That made requesting a FREE spotlight impossible, contradicting the
  // free-first marketplace. NULL rate + connected handle = free swap.
  const igPrice = connector.spotlight_price_instagram_cents;
  const ttPrice = connector.spotlight_price_tiktok_cents;
  const platforms = [];
  if (igPrice != null)                                  platforms.push({ id: 'instagram', label: 'Instagram', cents: igPrice });
  else if (connector.instagram_handle)                  platforms.push({ id: 'instagram', label: 'Instagram', cents: 0, free: true });
  if (ttPrice != null)                                  platforms.push({ id: 'tiktok',    label: 'TikTok',    cents: ttPrice });
  else if (connector.tiktok_handle)                     platforms.push({ id: 'tiktok',    label: 'TikTok',    cents: 0, free: true });
  const [platform, setPlatform] = useState(platforms[0]?.id || 'instagram');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Provider picks which of their listings to spotlight — required when
  // they have any services listed; falls back to null when they have none.
  const [myServices, setMyServices] = useState([]);
  const [serviceId, setServiceId]   = useState('');
  useEffect(() => {
    listMyServices().then(({ data }) => {
      const list = data || [];
      setMyServices(list);
      if (list.length === 1) setServiceId(list[0].id); // auto-pick if only one
    });
  }, []);

  const picked = platforms.find(p => p.id === platform) || platforms[0];

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!picked || busy) return;
    if (myServices.length > 0 && !serviceId) return;
    setBusy(true);
    setErr(null);
    const { error } = await createSpotlightRequest({
      connectorId: connector.id,
      platform:    picked.id,
      officialPriceCents: picked.cents,
      message,
      serviceId:   serviceId || null,
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
        <p className="text-meta text-b3 mb-4 leading-relaxed">
          They'll see your message + service. They can accept at rate-card price,
          counter at a lower price, or decline.
        </p>

        {platforms.length === 0 ? (
          <p className="text-body-sm text-b3 mb-4">
            This Connector hasn't connected a social account yet. Send them a
            friend invite instead.
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
                    className={`flex-1 rounded-[14px] py-3 text-body-sm font-extrabold transition-all
                      ${platform === p.id
                        ? 'bg-gl text-gd border-2 border-g'
                        : 'bg-bg5 text-b2 border-2 border-transparent hover:border-g/30'}`}
                  >
                    {p.label}
                    <span className="block text-meta-sm font-extrabold mt-0.5">
                      {p.free ? 'Free / swap' : `${fmtPrice(p.cents)} / post`}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Free swap — explain the barter; no money moves. */}
            {picked?.free && (
              <div className="bg-gl border border-g/30 rounded-[14px] px-3.5 py-3 mb-3">
                <p className="text-body-sm font-extrabold text-gd mb-0.5">Free swap</p>
                <p className="text-meta text-gd/80 leading-snug">
                  You offer your service free of charge; they post your spotlight.
                  No payment, no fees.
                </p>
              </div>
            )}

            {/* Fee breakdown — transparent so providers know where their money goes. */}
            {picked && !picked.free && (
              <div className="bg-bg5/60 border border-bdr rounded-[14px] px-3.5 py-3 mb-3">
                <div className="flex items-center justify-between text-body-sm mb-1">
                  <span className="text-b2">You pay</span>
                  <span className="font-extrabold text-black">{fmtPrice(picked.cents)}</span>
                </div>
                <div className="flex items-center justify-between text-meta text-b3">
                  <span>Connector earns</span>
                  <span>{fmtPrice(sellerEarningsCents(picked.cents))}</span>
                </div>
                <div className="flex items-center justify-between text-meta text-b3">
                  <span>Cergio fee ({Math.round(PLATFORM_FEE_RATE * 100)}%)</span>
                  <span>{fmtPrice(platformFeeCents(picked.cents))}</span>
                </div>
              </div>
            )}
          </>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          {/* Service picker — required when the Provider has listings, so
              the Connector always sees what they're promoting (and, on a
              free swap, what they receive in exchange). */}
          {myServices.length > 0 && (
            <div>
              <label className="block text-meta font-extrabold text-black mb-1">Which service?</label>
              <select
                value={serviceId}
                onChange={e => setServiceId(e.target.value)}
                className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black outline-none focus:ring-2 focus:ring-g/30"
              >
                <option value="">— Pick a service —</option>
                {myServices.map(s => (
                  <option key={s.id} value={s.id}>{s.title || s.category}</option>
                ))}
              </select>
              <p className="text-meta-sm text-b3 mt-1">The Connector sees what they're promoting.</p>
            </div>
          )}

          <div>
            <label className="block text-meta font-extrabold text-black mb-1">Message (optional)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, 600))}
              placeholder="Tell them about your service + why you'd love a spotlight…"
              rows={3}
              className="w-full bg-bg5 rounded-[12px] px-4 py-3 text-body-sm text-black
                         placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none"
            />
            <p className="text-caps text-b3 mt-1 text-right">{message.length} / 600</p>
          </div>

          {err && <p className="text-meta text-danger font-extrabold">{err}</p>}

          <button
            type="submit"
            disabled={!picked || busy || (myServices.length > 0 && !serviceId)}
            className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
              ${picked && !busy && !(myServices.length > 0 && !serviceId)
                ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
                : 'bg-bg5 text-b3 cursor-not-allowed'}`}
          >
            {busy ? 'Sending…'
              : `Send request${picked ? ` · ${picked.free ? 'Free swap' : fmtPrice(picked.cents)}` : ''}`}
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
