// CERGIO-GUARD (2026-06-14): dedicated detail screen for an inbound SPOTLIGHT
// request — a service provider asking THIS Connector to spotlight their work.
// Frame-3 quality, but the Connector decides by the provider's SERVICE
// reputation (services · reco's received · bio), not the provider's IG reach.
// Route /spotlight/:id, opened from ConnectorRequestsScreen's inbound card.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import {
  getSpotlightRequest, setSpotlightRequestStatus, counterSpotlightRequest,
  getMutualConnections, getPublicProfileStats, isConnectorProfile,
} from '../lib/api';
import { fmtDollars, sellerEarningsCents, PLATFORM_FEE_RATE } from '../lib/fees';

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}
function Avatar({ name }) {
  return (
    <div className="w-11 h-11 min-w-11 rounded-full bg-gradient-to-br from-g to-gd flex items-center justify-center text-white font-extrabold text-body">
      {getInitials(name)}
    </div>
  );
}
function mutualSummaryText({ count, connectors }) {
  const friends = Math.max(0, count - connectors);
  const parts = [];
  if (friends > 0)    parts.push(`${friends} ${friends === 1 ? 'friend' : 'friends'}`);
  if (connectors > 0) parts.push(`${connectors} ${connectors === 1 ? 'Connector' : 'Connectors'}`);
  return `${parts.join(' and ')} in common`;
}

export function SpotlightRequestScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast } = useOutletContext();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [mutuals, setMutuals] = useState(null);
  const [stats, setStats] = useState(null);
  const [phase, setPhase] = useState(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterDraft, setCounterDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    getSpotlightRequest(id).then(({ data: r, error }) => {
      if (cancelled) return;
      if (error || !r) { setNotFound(true); return; }
      setData(r);
      const pid = r.provider?.id || r.provider_id;
      if (pid) {
        getMutualConnections(pid).then(({ data: m }) => { if (!cancelled) setMutuals(m || { count: 0, connectors: 0, sample: [] }); });
        getPublicProfileStats(pid).then(({ data: s }) => { if (!cancelled) setStats(s || null); });
      } else {
        setMutuals({ count: 0, connectors: 0, sample: [] });
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cr px-8 text-center">
        <p className="text-body font-extrabold text-black">This spotlight request is no longer open.</p>
        <button onClick={() => navigate('/connectors/requests')} className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-body-sm font-extrabold">Back</button>
      </div>
    );
  }
  if (!data) {
    return <div className="flex-1 flex items-center justify-center bg-cr"><p className="text-body text-b3">Loading request…</p></div>;
  }

  const providerName = data.provider?.display_name || data.service?.title || 'A provider';
  const providerFirst = providerName.split(' ')[0];
  const providerBio = data.provider?.bio || data.provider?.headline || null;
  const services = data.providerServices || [];
  const recosReceived = data.providerRecosReceived || 0;
  const networkCount = (stats && stats.networkCount) || 0;
  const recosMade = (stats && stats.recommended) || 0;
  const igFollowers = data.provider?.instagram_followers || 0;
  const ttFollowers = data.provider?.tiktok_followers || 0;
  const providerIsConnector = isConnectorProfile(data.provider || {});
  // Counts about the requesting provider (lead with the SERVICE above; these
  // back it up). Tarik 2026-06-14: show network · reco's · reach + Connector status.
  const countLine = [
    networkCount > 0 ? `${networkCount} network on Cergio` : null,
    recosMade > 0 ? `${recosMade} reco${recosMade === 1 ? '' : 's'} made` : null,
    igFollowers > 0 ? `${Number(igFollowers).toLocaleString()} IG` : null,
    ttFollowers > 0 ? `${Number(ttFollowers).toLocaleString()} TikTok` : null,
  ].filter(Boolean).join(' · ');

  const effective = data.offered_price_cents ?? data.official_price_cents ?? 0;
  const isFree = effective === 0;
  const platformLabel = data.platform === 'instagram' ? 'Instagram' : 'TikTok';
  const platformShort = data.platform === 'instagram' ? 'IG' : 'TikTok';
  const serviceLabel = data.service?.taxonomy_provider_type || data.service?.title || 'service';
  const isMyTurn = data.status === 'pending' || (data.status === 'countered' && data.last_counter_by === 'provider');
  const hasMutuals = mutuals && mutuals.count > 0;

  const act = async (fn, okMsg) => {
    setPhase('pending');
    const { error } = await fn();
    setPhase(null);
    if (error) { showToast('Could not send — try again.'); return; }
    showToast(okMsg);
    setTimeout(() => navigate(-1), 1000);
  };
  const accept  = () => act(() => setSpotlightRequestStatus(data.id, 'accepted'), `Accepted — ${providerFirst} will be notified.`);
  const decline = () => act(() => setSpotlightRequestStatus(data.id, 'declined'), 'Declined');
  const submitCounter = () => {
    const d = parseFloat(counterDraft);
    if (!Number.isFinite(d) || d < 0) { showToast('Enter a price.'); return; }
    setCounterOpen(false);
    act(() => counterSpotlightRequest(data.id, { offeredPriceCents: Math.round(d * 100) }), 'Counter sent.');
  };

  const ico = 'w-9 h-9 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.10)] flex items-center justify-center text-black';

  return (
    <div className="flex-1 flex flex-col bg-cr pb-32 overflow-y-auto">
      {/* header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className={ico} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="text-heading-2 font-extrabold text-black truncate px-2">Spotlight request</span>
        <div className="w-9" />
      </div>

      {/* eyebrow + headline */}
      <div className="px-5 pt-1 pb-3">
        <p className="text-caps text-gd mb-1">{isFree ? 'Free spotlight swap' : 'Paid spotlight request'}</p>
        <h1 className="text-heading-2 font-extrabold text-black leading-tight">
          {isFree ? (
            <>Free {serviceLabel} Offer <span className="text-g">⇄</span> Free {platformShort} Spotlight</>
          ) : (
            <>Spotlight {serviceLabel} on {platformLabel} <span className="text-g">·</span> earn {fmtDollars(sellerEarningsCents(effective))}</>
          )}
        </h1>
        {!isFree && (
          <p className="text-meta text-b3 mt-1">{fmtDollars(effective)} total · {fmtDollars(sellerEarningsCents(effective))} to you after {Math.round(PLATFORM_FEE_RATE * 100)}% fee</p>
        )}
      </div>

      {/* provider — LEAD with service reputation */}
      <div className="px-5 pb-3">
        <div className="bg-bg4 rounded-[18px] p-3.5">
          <div className="flex items-start gap-3">
            <Avatar name={providerName} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-body font-extrabold text-black truncate">{providerName}</p>
                {providerIsConnector && (
                  <span className="inline-flex items-center gap-1 bg-gl text-gd rounded-pill px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide shrink-0">
                    Connector
                  </span>
                )}
              </div>
              {/* LEAD with the SERVICE — this is what makes the Connector decide. */}
              {(services.length > 0 || recosReceived > 0) && (
                <p className="text-meta-sm text-gd font-extrabold mt-0.5 leading-snug">
                  {services.length > 0
                    ? services.map(s => `${s.name} (${s.recos} reco${s.recos === 1 ? '' : 's'} received)`).join(', ')
                    : `${recosReceived} reco${recosReceived === 1 ? '' : 's'} received`}
                </p>
              )}
              {providerBio && <p className="text-meta text-b3 leading-snug mt-1 line-clamp-3">{providerBio}</p>}
              {countLine && <p className="text-meta-sm text-b3 mt-1">{countLine}</p>}
            </div>
          </div>

          {hasMutuals && (
            <div className="mt-2.5 pt-2.5 border-t border-line flex items-center gap-2.5">
              <div className="flex -space-x-2 shrink-0">
                {mutuals.sample.map(m => (
                  <button key={m.id} onClick={() => navigate(`/u/${m.id}`)} title={m.name}
                    className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-extrabold text-white ${m.is_connector ? 'bg-g' : 'bg-gradient-to-br from-[#b06090] to-[#703050]'}`}>{m.initial}</button>
                ))}
              </div>
              <p className="text-meta text-b2 leading-snug min-w-0">
                <span className="font-extrabold text-black">{mutualSummaryText(mutuals)}</span>
              </p>
            </div>
          )}

          {(data.provider?.id || data.service?.owner_id) && (
            <button onClick={() => navigate(`/u/${data.provider?.id || data.service?.owner_id}`)}
              className="mt-2 inline-flex items-center gap-1 text-meta-sm font-extrabold text-gd hover:underline">
              See full profile →
            </button>
          )}
        </div>
      </div>

      {/* the ask + message */}
      <div className="px-5 pb-3">
        <div className="bg-soft rounded-[18px] p-4">
          <p className="text-body text-black leading-relaxed">
            {isFree ? (
              <><span className="font-extrabold">{providerFirst}</span> is offering a free <span className="font-extrabold">{serviceLabel}</span> in return for a free {platformLabel} spotlight.</>
            ) : (
              <><span className="font-extrabold">{providerFirst}</span> wants a {platformLabel} spotlight for their <span className="font-extrabold">{serviceLabel}</span> and will pay <span className="font-extrabold">{fmtDollars(effective)}</span>.</>
            )}
          </p>
          {data.message && <p className="text-body-sm text-b2 italic mt-2 leading-snug">&ldquo;{data.message}&rdquo;</p>}
          {/* Scheduling note — unlike a Connector requesting a free SERVICE (where
              the time matters up front), accepting a spotlight just agrees to the
              swap; the two parties arrange timing together afterward. */}
          <p className="text-meta text-b3 mt-2.5 pt-2.5 border-t border-line leading-snug">
            Accepting agrees to the swap — you and {providerFirst} arrange the timing together afterward.
          </p>
        </div>
      </div>

      {/* actions */}
      {isMyTurn && (
        <div className="fixed bottom-0 inset-x-0 max-w-[390px] mx-auto bg-cr px-5 pt-3 pb-6 border-t border-line shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          {phase === 'pending' ? (
            <p className="text-body-sm text-b3 font-medium text-center py-3">Sending…</p>
          ) : counterOpen ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-9 h-9 min-w-9 rounded-[10px] bg-gl text-gd text-body font-extrabold">$</span>
                <input autoFocus inputMode="decimal" placeholder="Your price" value={counterDraft}
                  onChange={e => setCounterDraft(e.target.value)}
                  className="flex-1 border border-bdr rounded-[12px] px-3 py-3 text-body-sm font-medium text-black bg-white outline-none focus:border-g" />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={submitCounter} className="flex-1 bg-g text-white rounded-[24px] py-3.5 text-body font-extrabold active:scale-[.98] transition-all">Send counter</button>
                <button onClick={() => setCounterOpen(false)} className="text-body font-extrabold text-b3 px-3">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={accept}
                className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                {isFree ? 'Offer the spotlight' : `Accept · earn ${fmtDollars(sellerEarningsCents(effective))}`}
              </button>
              <div className="flex items-center justify-center gap-3 mt-2.5">
                <button onClick={() => { setCounterDraft(''); setCounterOpen(true); }}
                  className="inline-flex items-center gap-1.5 border border-bdr rounded-pill px-4 py-2 text-body-sm font-extrabold text-b2 hover:bg-bg5 active:scale-[.97] transition-all">
                  <span className="text-g">$⇄</span>{isFree ? 'Counter with a price' : 'Set your price'}
                </button>
                <button onClick={decline} className="rounded-pill px-4 py-2 text-body-sm font-extrabold text-g hover:bg-gl active:scale-[.97] transition-all">Decline</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
