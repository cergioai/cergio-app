// CERGIO-GUARD (2026-06-13): the canonical screen a provider sees for an
// inbound request from a Connector ("New requests near you" → here). This
// REPLACES the thin Accept/Counter/Decline bar that used to live on the
// PublicProfile ?reqId path. Backed by the `requests` table via
// getInboundRequest — every field is real (SPEC-12). Mirrors Tarik's
// "Accepting Free Service request" mockup:
//   • Job details (free pill, description, timing)
//   • Approximate-location card — exact address shared only after confirm
//   • Requester block — Connector status + IG handle/followers + See Instagram
//   • Friends-in-common over the network graph
//   • Accept / Counter / Decline (respondToRequest)
//   • "See full profile" → the requester's PublicProfile (secondary)
// NO fake IG photo grid (gated on real media; absent today).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useOutletContext } from 'react-router-dom';
import { getInboundRequest, getMutualConnections, respondToRequest, getPublicProfileStats, isConnectorProfile } from '../lib/api';

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function GradientAvatar({ name }) {
  return (
    <div className="rounded-full bg-gradient-to-br from-[#b06090] to-[#703050]
                    flex items-center justify-center text-white font-extrabold flex-shrink-0
                    w-11 h-11 text-body">
      {getInitials(name)}
    </div>
  );
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

  useEffect(() => {
    let cancelled = false;
    getInboundRequest(reqId).then(({ data: r, error }) => {
      if (cancelled) return;
      if (error || !r) { setNotFound(true); return; }
      const requester = r.requester || {};
      // Connector status drives the badge AND the free-barter framing:
      // a request FROM a Connector is a free service ↔ reach exchange
      // (Tarik 2026-06-13). Connector = ≥300 followers OR cc_verified_at.
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
        // Free when the requester is a Connector (barter), or if an
        // explicit free flag was ever set on the request row.
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

  const sendResponse = async (status, offeredPriceCents = null) => {
    if ((status === 'offered' || status === 'countered') && !myServiceId) {
      showToast('You need a listed service to respond.');
      return;
    }
    setPhase('pending');
    const { error } = await respondToRequest(data.id, {
      status,
      serviceId: myServiceId || null,
      offeredPriceCents,
      message: null,
      waveN: null,
    });
    if (error) {
      showToast('Could not send — try again.');
      setPhase(null);
      return;
    }
    setPhase('done');
    if (status === 'declined') {
      navigate(-1);
    } else {
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

  return (
    <div className="flex-1 flex flex-col bg-cr pb-28 overflow-y-auto">
      {/* nav */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-card border border-bdr flex items-center justify-center text-b2 text-base">
          ←
        </button>
        <span className="text-body-lg font-extrabold text-black truncate px-2">{data.requesterName}</span>
        {/* ••• matches Figma; opens the requester's full profile */}
        {data.requesterId ? (
          <button onClick={() => navigate(`/u/${data.requesterId}`)} aria-label="More"
            className="w-9 h-9 rounded-full bg-card border border-bdr flex items-center justify-center text-b2 text-base">
            •••
          </button>
        ) : <div className="w-9" />}
      </div>

      {/* status row — "Needs Response" + "View Details" (Figma frame 3) */}
      <div className="px-5 pb-3 flex items-center justify-between">
        {alreadyResolved ? (
          <div className="inline-flex items-center gap-1.5 bg-bg5 text-b2 text-meta-sm font-extrabold px-2.5 py-1 rounded-pill">
            <span className="w-2 h-2 rounded-full bg-b3" />
            Closed
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 bg-g text-white text-meta-sm font-extrabold px-2.5 py-1 rounded-pill">
            <span className="w-3.5 h-3.5 rounded-full bg-white text-g flex items-center justify-center text-[9px] font-extrabold">!</span>
            Needs Response
          </div>
        )}
        <button
          onClick={() => document.getElementById('svp-job-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="text-body-sm font-extrabold text-black whitespace-nowrap">
          View Details
        </button>
      </div>

      {/* purpose banner */}
      <div className="px-5 pb-3">
        {data.isFree ? (
          <div className="bg-gl/60 border border-g/30 rounded-[14px] p-3.5">
            {/* Frame 2 ("{Connector} wants to market your services") folded in here */}
            <p className="text-body-sm font-extrabold text-gd leading-snug">
              {data.requesterName} wants to market your services
            </p>
            <p className="text-meta text-b2 mt-1 leading-snug">
              In exchange for a free <span className="font-extrabold text-black">{data.serviceType}</span>, they'll
              spotlight it{data.igFollowers > 0 ? <> to their <span className="font-extrabold text-black">{Number(data.igFollowers).toLocaleString()}</span> followers</> : ' to their social audience'} — no cash changes hands.
            </p>
          </div>
        ) : (
          <div className="bg-card border border-bdr rounded-[14px] p-3.5">
            <p className="text-body-sm font-extrabold text-black leading-snug">
              Paid request{data.budgetCents > 0 ? ` · budget $${Math.round(data.budgetCents / 100)}` : ''}
            </p>
            <p className="text-meta text-b2 mt-1 leading-snug">
              <span className="font-extrabold text-black">{data.requesterName}</span> wants{' '}
              <span className="font-extrabold text-black">{data.serviceType}</span>. Accept at their budget or send a counter price.
            </p>
          </div>
        )}
      </div>

      {/* job details */}
      <div id="svp-job-details" className="px-5 pb-4 scroll-mt-4">
        <h2 className="text-heading-1 font-extrabold text-black leading-tight mb-2">{data.serviceType}</h2>
        {data.isFree && (
          <div className="inline-flex items-center gap-1 bg-gl text-gd text-meta-sm font-extrabold px-2 py-0.5 rounded-pill mb-3">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
            </svg>
            Free for Connectors
          </div>
        )}
        {data.description && <p className="text-body-lg text-black mb-1">{data.description}</p>}
        {data.whenText && <p className="text-body text-b3">{data.whenText}</p>}
      </div>

      {/* approximate-location card */}
      <div className="px-5 pb-3">
        <div className="relative overflow-hidden rounded-[18px] bg-gl border border-line p-4">
          <div className="absolute -right-6 -top-8 w-40 h-40 rounded-full bg-g/10" aria-hidden="true" />
          <div className="absolute right-6 top-6 w-20 h-20 rounded-full border-2 border-g/30" aria-hidden="true" />
          <div className="relative flex items-start gap-3">
            <span className="w-9 h-9 min-w-9 rounded-full bg-white border border-bdr flex items-center justify-center mt-0.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" />
                <path d="M3 3l18 18" />
              </svg>
            </span>
            <div className="flex-1">
              <p className="text-body-sm font-extrabold text-black leading-snug">Map shows approximate location</p>
              <p className="text-meta text-b2 mt-1 leading-snug">
                {data.locationText
                  ? <>Around <span className="font-extrabold text-black">{data.locationText}</span>. The exact address is shared after you confirm the booking.</>
                  : <>Exact address will be shared after the user confirms the booking.</>}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* requester — Connector status + Instagram */}
      {(data.isConnector || data.igHandle) && (
        <div className="px-5 pb-3">
          <div className="bg-soft rounded-[18px] p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center justify-center w-9 h-9 min-w-9 rounded-md border-2 border-gd">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none" />
                </svg>
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-body font-extrabold text-black truncate">{data.igHandle || data.requesterName}</p>
                  {data.isConnector && (
                    <span className="inline-flex items-center gap-0.5 bg-gl text-gd text-[10px] font-extrabold px-1.5 py-0.5 rounded-pill">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" /></svg>
                      Connector
                    </span>
                  )}
                </div>
                <p className="text-meta-sm text-b3 truncate">
                  {[
                    data.igFollowers != null && data.igFollowers > 0
                      ? `${Number(data.igFollowers).toLocaleString()} followers` : null,
                    stats && stats.recommended > 0 ? `${stats.recommended} reco'd` : null,
                    stats && stats.listedServices > 0 ? `${stats.listedServices} ${stats.listedServices === 1 ? 'service' : 'services'}` : null,
                  ].filter(Boolean).join(' · ') || 'Connector'}
                </p>
              </div>
            </div>
            {data.igHandle && (
              <a href={`https://instagram.com/${String(data.igHandle).replace(/^@/, '')}`}
                target="_blank" rel="noreferrer"
                className="shrink-0 bg-salmon text-white rounded-pill px-3.5 py-2 text-meta-sm font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                See Instagram
              </a>
            )}
          </div>
          {/* "See full profile" kept (Tarik) — drill into the requester */}
          {data.requesterId && (
            <button onClick={() => navigate(`/u/${data.requesterId}`)}
              className="mt-2 inline-flex items-center gap-1 text-meta-sm font-extrabold text-gd hover:underline">
              See full profile →
            </button>
          )}
        </div>
      )}

      {/* friends in common */}
      {hasMutuals && (
        <div className="px-5 pb-3">
          <div className="bg-card border border-line rounded-[18px] p-3.5 flex items-center gap-3">
            <div className="flex -space-x-2">
              {mutuals.sample.map(m => (
                <span key={m.id}
                  className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-meta-sm font-extrabold text-white
                              ${m.is_connector ? 'bg-g' : 'bg-gradient-to-br from-[#b06090] to-[#703050]'}`}
                  title={m.name}>
                  {m.initial}
                </span>
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-body-sm font-extrabold text-black leading-snug">{mutualSummaryText(mutuals)}</p>
              <p className="text-meta text-b3 leading-snug truncate">
                {mutuals.sample.map(m => m.name).join(', ')}
                {mutuals.count > mutuals.sample.length ? ` +${mutuals.count - mutuals.sample.length} more` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* benefit subcopy */}
      {!alreadyResolved && data.isFree && (
        <div className="px-5 pt-2 text-center">
          <p className="text-body-lg font-extrabold text-black">You'll get free marketing</p>
          <p className="text-body-sm text-b3">and service verification with a 4+ star rating.</p>
        </div>
      )}

      {/* sticky action bar */}
      {!alreadyResolved && (
        <div className="fixed bottom-0 inset-x-0 max-w-[390px] mx-auto bg-white border-t border-line px-5 pt-3 pb-6 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          {phase === 'pending' ? (
            <p className="text-body-sm text-b3 font-medium text-center py-3">Sending…</p>
          ) : counterOpen ? (
            <div className="flex items-center gap-2">
              <span className="text-body-sm font-extrabold text-b3">$</span>
              <input
                autoFocus inputMode="decimal" placeholder="Your price"
                value={counterDraft}
                onChange={e => setCounterDraft(e.target.value)}
                className="flex-1 border border-bdr rounded-[10px] px-3 py-2.5 text-body-sm font-medium text-black bg-white outline-none focus:border-g"
              />
              <button onClick={submitCounter}
                className="bg-g text-white rounded-[10px] px-4 py-2.5 text-meta font-extrabold">Send</button>
              <button onClick={() => setCounterOpen(false)}
                className="text-meta font-extrabold text-b3 px-2">Cancel</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => sendResponse('offered')}
                className="flex-1 bg-g text-white rounded-[24px] py-3.5 text-body font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                {data.isFree ? 'Accept free request' : 'Accept'}
              </button>
              <button onClick={() => { setCounterDraft(''); setCounterOpen(true); }}
                className="bg-white border border-bdr rounded-[24px] px-4 py-3.5 text-body font-extrabold text-b2">
                Counter
              </button>
              <button onClick={() => sendResponse('declined')}
                className="bg-white border border-bdr rounded-[24px] px-4 py-3.5 text-body font-extrabold text-b3">
                Decline
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
