// CERGIO-GUARD (2026-06-14): canonical screen a provider sees for an inbound
// request from a Connector ("New requests near you" → here). Rebuilt to match
// the Figma frame "Message (Essential Details)" 1:1 (treatments, not pills) —
// Figma is the layout source of truth. Real data via getInboundRequest +
// Accept/Counter/Decline via respondToRequest. Connector status + friends-in-
// common + connector-strength are our overrides on top of the frame.
// NO fake IG media — the photo strip is gated on real data.igMedia.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useOutletContext } from 'react-router-dom';
import { getInboundRequest, getMutualConnections, respondToRequest, getPublicProfileStats, isConnectorProfile } from '../lib/api';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null;

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function formatWhen(req) {
  if (req?.when_text) return req.when_text;
  if (req?.scheduled_at) {
    const d = new Date(req.scheduled_at);
    return `${d.toLocaleDateString('en-US', { weekday: 'short' })}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return null;
}

function mutualSummaryText({ count, connectors }) {
  const friends = Math.max(0, count - connectors);
  const parts = [];
  if (friends > 0)    parts.push(`${friends} ${friends === 1 ? 'friend' : 'friends'}`);
  if (connectors > 0) parts.push(`${connectors} ${connectors === 1 ? 'Connector' : 'Connectors'}`);
  return `${parts.join(' and ')} in common`;
}

// Green shield (Free for Connectors) — matches the Figma inline treatment.
function ShieldIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#4AA901" aria-hidden="true">
      <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
      <path d="M10.5 13.2l-1.9-1.9-1.2 1.2 3.1 3.1 5-5-1.2-1.2z" fill="#fff" />
    </svg>
  );
}

export function RequestFromConnectorScreen() {
  const navigate = useNavigate();
  const { reqId } = useParams();
  const [searchParams] = useSearchParams();
  const myServiceId = searchParams.get('myServiceId') || null;
  const { showToast, auth } = useOutletContext();

  const [data, setData] = useState(null);     // null = loading
  const [notFound, setNotFound] = useState(false);
  const [mutuals, setMutuals] = useState(null);
  const [stats, setStats] = useState(null);   // connector strength (recos / services)
  const [phase, setPhase] = useState(null);    // null | 'pending' | 'done'
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterDraft, setCounterDraft] = useState('');
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInboundRequest(reqId).then(({ data: r, error }) => {
      if (cancelled) return;
      if (error || !r) { setNotFound(true); return; }
      const requester = r.requester || {};
      const isConnector = isConnectorProfile(requester);
      setData({
        id:            r.id,
        requesterId:   requester.id || null,
        requesterName: requester.display_name || 'A Cergio user',
        isConnector,
        igHandle:      requester.instagram_handle || null,
        igFollowers:   requester.instagram_followers ?? null,
        igMedia:       null,  // reserved — real IG media post Meta approval
        serviceType:   r.service_type || r.category || 'Service request',
        description:   r.what || r.description || '',
        whenText:      formatWhen(r),
        locationText:  r.location_text || null,
        lat:           r.lat ?? null,
        lng:           r.lng ?? null,
        isFree:        isConnector || !!r.is_free_for_rainmaker,
        budgetCents:   r.budget_cents ?? 0,
        status:        r.status,
      });
      if (requester.id) {
        getMutualConnections(requester.id).then(({ data: m }) => {
          if (!cancelled) setMutuals(m || { count: 0, connectors: 0, sample: [] });
        });
        getPublicProfileStats(requester.id).then(({ data: s }) => {
          if (!cancelled) setStats(s || null);
        });
      } else {
        setMutuals({ count: 0, connectors: 0, sample: [] });
      }
    });
    return () => { cancelled = true; };
  }, [reqId]);

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cr px-8 text-center">
        <p className="text-body font-extrabold text-black">This request is no longer open.</p>
        <p className="text-meta text-b3 font-medium mt-1">It may have been filled or withdrawn.</p>
        <button onClick={() => navigate('/inbox')}
          className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-body-sm font-extrabold">
          Back to Inbox
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cr">
        <p className="text-body text-b3">Loading request…</p>
      </div>
    );
  }

  const alreadyResolved = data.status && data.status !== 'pending';
  const hasMutuals = mutuals && mutuals.count > 0;
  const strength = [
    data.igFollowers > 0 ? `${Number(data.igFollowers).toLocaleString()} followers` : null,
    stats && stats.recommended > 0 ? `${stats.recommended} reco'd` : null,
    stats && stats.listedServices > 0 ? `${stats.listedServices} ${stats.listedServices === 1 ? 'service' : 'services'}` : null,
  ].filter(Boolean).join(' · ');

  const mapUrl = (!mapFailed && data.lat && data.lng && MAPS_KEY)
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${data.lat},${data.lng}&zoom=14&size=640x300&scale=2&maptype=roadmap&key=${MAPS_KEY}`
    : null;

  const sendResponse = async (status, offeredPriceCents = null) => {
    if ((status === 'offered' || status === 'countered') && !myServiceId) {
      showToast('You need a listed service to respond.');
      return;
    }
    setPhase('pending');
    const { error } = await respondToRequest(data.id, {
      status, serviceId: myServiceId || null, offeredPriceCents, message: null, waveN: null,
    });
    if (error) { showToast('Could not send — try again.'); setPhase(null); return; }
    setPhase('done');
    if (status === 'declined') { navigate(-1); }
    else {
      showToast(status === 'countered'
        ? `Counter sent — ${data.requesterName} will be notified.`
        : `Accepted — ${data.requesterName} will be notified.`);
      setTimeout(() => navigate(-1), 1200);
    }
  };

  const submitCounter = () => {
    const dollars = parseFloat(counterDraft);
    if (!Number.isFinite(dollars) || dollars < 0) { showToast('Enter a valid price.'); return; }
    setCounterOpen(false);
    sendResponse('countered', Math.round(dollars * 100));
  };

  const ico = 'w-9 h-9 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.10)] flex items-center justify-center text-black';

  return (
    <div className="flex-1 flex flex-col bg-cr pb-28 overflow-y-auto">
      {/* header — back · name · ••• (Figma) */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <button onClick={() => navigate(-1)} className={ico} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="text-heading-2 font-extrabold text-black truncate px-2">{data.requesterName}</span>
        <button onClick={() => data.requesterId && navigate(`/u/${data.requesterId}`)} className={ico} aria-label="More">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
      </div>

      {/* status row — (!) Needs Response · View Details (icon+text, NOT a pill) */}
      <div className="px-5 py-2 flex items-center justify-between border-b border-line">
        {alreadyResolved ? (
          <span className="text-body-sm font-extrabold text-b3">Closed</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-[#2E9CDB] flex items-center justify-center text-white text-[11px] font-extrabold">!</span>
            <span className="text-body-sm font-extrabold text-black">Needs Response</span>
          </div>
        )}
        <button onClick={() => document.getElementById('svp-job-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="text-body-sm font-extrabold text-black">View Details</button>
      </div>

      {/* title + free + service needed */}
      <div id="svp-job-details" className="px-5 pt-4 pb-4 scroll-mt-4">
        <h1 className="text-display-2 font-extrabold text-black leading-tight">{data.serviceType}</h1>
        {data.isFree && (
          <div className="flex items-center gap-1.5 mt-2">
            <ShieldIcon size={16} />
            <span className="text-body-sm font-extrabold text-g">Free for Connectors</span>
          </div>
        )}
        {data.description && <p className="text-body-lg text-black mt-3 leading-snug">{data.description}</p>}
        {data.whenText && <p className="text-body text-b3 mt-0.5">{data.whenText}</p>}
      </div>

      {/* map — real Google Static Map (lat/lng) under the approximate-area overlay */}
      <div className="px-5 pb-3">
        <div className="relative rounded-[18px] overflow-hidden h-[196px] bg-[#EFE9DF] border border-line">
          {mapUrl && (
            <img src={mapUrl} alt="" onError={() => setMapFailed(true)}
              className="absolute inset-0 w-full h-full object-cover" />
          )}
          {/* approximate-area radius */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-[#3FA9B8]/30 border-2 border-[#2F8C9A]/50" aria-hidden="true" />
          {/* eye-off pin, top-right */}
          <div className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111114" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" /><path d="M3 3l18 18" />
            </svg>
          </div>
          {/* white floating info box */}
          <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 bg-white rounded-[14px] p-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.10)]">
            <p className="text-body-sm font-extrabold text-black leading-snug">Map shows approximate location</p>
            <p className="text-meta text-b3 mt-1 leading-snug">
              {data.locationText ? <>Around <span className="font-semibold text-b2">{data.locationText}</span>. </> : null}
              Exact address is shared after you confirm the booking.
            </p>
          </div>
        </div>
      </div>

      <p className="text-center text-meta text-b3 py-2">Scroll down for messages</p>

      {/* requester — IG handle + followers + Connector + See Instagram (coral) */}
      {(data.isConnector || data.igHandle) && (
        <div className="px-5 pb-3">
          <div className="bg-bg4 rounded-[18px] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex items-center justify-center w-10 h-10 min-w-10 rounded-xl border-2 border-gd">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-body font-extrabold text-black truncate">{data.igHandle || data.requesterName}</p>
                    {data.isConnector && (
                      <span className="inline-flex items-center gap-0.5 bg-gl text-gd text-[10px] font-extrabold px-1.5 py-0.5 rounded-pill">
                        <ShieldIcon size={9} />Connector
                      </span>
                    )}
                  </div>
                  <p className="text-meta-sm text-b3 truncate">{strength || 'Connector'}</p>
                </div>
              </div>
              {data.igHandle && (
                <a href={`https://instagram.com/${String(data.igHandle).replace(/^@/, '')}`} target="_blank" rel="noreferrer"
                  className="shrink-0 bg-salmon text-white rounded-pill px-3.5 py-2 text-meta-sm font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                  See Instagram
                </a>
              )}
            </div>

            {/* IG photo strip — reserved for real media (no fakes until Meta media) */}
            {data.igHandle && Array.isArray(data.igMedia) && data.igMedia.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-3">
                {data.igMedia.slice(0, 3).map((m, i) => (
                  <div key={i} className="aspect-square rounded-[12px] overflow-hidden bg-bg5">
                    <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
                {data.igMedia.length > 3 && (
                  <div className="aspect-square rounded-[12px] bg-black text-white flex flex-col items-center justify-center text-meta-sm font-extrabold leading-tight">
                    <span className="text-body-lg">+{data.igMedia.length - 3}</span>more
                  </div>
                )}
              </div>
            )}

            {data.requesterId && (
              <button onClick={() => navigate(`/u/${data.requesterId}`)}
                className="mt-2 inline-flex items-center gap-1 text-meta-sm font-extrabold text-gd hover:underline">
                See full profile →
              </button>
            )}
          </div>
        </div>
      )}

      {/* friends in common (override) */}
      {hasMutuals && (
        <div className="px-5 pb-3">
          <div className="bg-card border border-line rounded-[18px] p-3.5 flex items-center gap-3">
            <div className="flex -space-x-2">
              {mutuals.sample.map(m => (
                <span key={m.id}
                  className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-meta-sm font-extrabold text-white ${m.is_connector ? 'bg-g' : 'bg-gradient-to-br from-[#b06090] to-[#703050]'}`}
                  title={m.name}>{m.initial}</span>
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-body-sm font-extrabold text-black leading-snug">{mutualSummaryText(mutuals)}</p>
              <p className="text-meta text-b3 leading-snug truncate">
                {mutuals.sample.map(m => m.name).join(', ')}{mutuals.count > mutuals.sample.length ? ` +${mutuals.count - mutuals.sample.length} more` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* benefit line (Figma) */}
      {!alreadyResolved && data.isFree && (
        <div className="px-5 pt-2 text-center">
          <p className="text-body-lg font-extrabold text-black">You'll get free marketing</p>
          <p className="text-body-sm text-b3">and service verification with a 4+ star rating.</p>
        </div>
      )}

      {/* sticky actions — Accept free request / Counter / Decline */}
      {!alreadyResolved && (
        <div className="fixed bottom-0 inset-x-0 max-w-[390px] mx-auto bg-cr px-5 pt-3 pb-6">
          {phase === 'pending' ? (
            <p className="text-body-sm text-b3 font-medium text-center py-3">Sending…</p>
          ) : counterOpen ? (
            <div className="flex items-center gap-2">
              <span className="text-body-sm font-extrabold text-b3">$</span>
              <input autoFocus inputMode="decimal" placeholder="Your price" value={counterDraft}
                onChange={e => setCounterDraft(e.target.value)}
                className="flex-1 border border-bdr rounded-[12px] px-3 py-3 text-body-sm font-medium text-black bg-white outline-none focus:border-g" />
              <button onClick={submitCounter} className="bg-g text-white rounded-[12px] px-4 py-3 text-meta font-extrabold">Send</button>
              <button onClick={() => setCounterOpen(false)} className="text-meta font-extrabold text-b3 px-2">Cancel</button>
            </div>
          ) : (
            <>
              <button onClick={() => sendResponse('offered')}
                className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                {data.isFree ? 'Accept free request' : 'Accept'}
              </button>
              <div className="flex items-center justify-center gap-6 mt-2">
                <button onClick={() => { setCounterDraft(''); setCounterOpen(true); }} className="text-body font-extrabold text-b2 py-1">Counter</button>
                <button onClick={() => sendResponse('declined')} className="text-body font-extrabold text-g py-1">Decline</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
