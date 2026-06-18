// CERGIO-GUARD (2026-06-14): canonical screen a provider sees for an inbound
// request from a Connector ("New requests near you" → here). Rebuilt to match
// the Figma frame "Message (Essential Details)" 1:1 (treatments, not pills) —
// Figma is the layout source of truth. Real data via getInboundRequest +
// Accept/Counter/Decline via respondToRequest. Connector status + friends-in-
// common + connector-strength are our overrides on top of the frame.
// NO fake IG media — the photo strip is gated on real data.igMedia.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useOutletContext } from 'react-router-dom';
import { getInboundRequest, getMutualConnections, respondToRequest, getPublicProfileStats, isConnectorProfile, askRequestQuestion, listRequestQuestions, getMyDisplayName, getConnectorSpotlights, acceptRequestWithTime, listMyServices } from '../lib/api';
import { IgPostTile } from '../components/ui/IgPostTile';

const QUICK_QS = [
  'Who buys the ingredients?',
  'Will you cover food costs upfront?',
  'Can I send you an ingredient list?',
];

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

// Small initials avatar for the message bubble.
function Avatar({ name }) {
  return (
    <div className="w-9 h-9 min-w-9 rounded-full bg-gradient-to-br from-[#b06090] to-[#703050] flex items-center justify-center text-white text-meta-sm font-extrabold">
      {getInitials(name)}
    </div>
  );
}

// Compose a personalized note in the Connector's voice from the real request
// fields (Tarik 2026-06-14). Derived from data we have — not fabricated.
// e.g. "Hey Jan, need a personal chef tuesday at 5pm — vegan Ecuadorian
//       birthday party. Happy to spotlight you free to my 319 followers 🙌"
function composeNote({ serviceType, whenText, description, igFollowers, providerFirst, isFree = true, budgetCents = 0 }) {
  // Greet by the provider's registered first name when present.
  const useName = providerFirst && /^[A-Za-z][A-Za-z'-]{1,}$/.test(providerFirst);
  const greet   = useName ? `Hi ${providerFirst}, ` : 'Hi! ';
  // Always lead with "I need a {service}" so it flows even when the user
  // didn't type the service explicitly; append their specifics only when
  // they add detail beyond the service type.
  const svc      = (serviceType || 'service').toLowerCase();
  const desc     = (description || '').trim();
  const specifics = desc && !desc.toLowerCase().includes(svc) ? desc : '';
  const when     = whenText && !`${svc} ${specifics}`.toLowerCase().includes(whenText.toLowerCase()) ? ` ${whenText}` : '';
  const reach    = igFollowers > 0 ? ` to my ${Number(igFollowers).toLocaleString()} followers` : ' to my followers';
  const closer   = isFree
    ? ` Happy to spotlight you for free${reach} 🙌`
    : (budgetCents > 0 ? ` My budget is up to $${Math.round(budgetCents / 100)} — what's your price?` : " What's your price?");
  return `${greet}I need a ${svc}${specifics ? ` — ${specifics}` : ''}${when}.${closer}`;
}

// Approximate area only — strip the street number/line + zip + country so the
// EXACT address stays hidden until the booking is accepted + confirmed.
// "5700 Collins Ave, Miami Beach, FL 33140, USA" → "Miami Beach, FL"
function approxArea(text) {
  if (!text) return null;
  let parts = text.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1 && /\d/.test(parts[0])) parts = parts.slice(1);       // drop street line
  parts = parts.filter(p => !/^(usa|united states|us)$/i.test(p));            // drop country
  parts = parts.map(p => p.replace(/\s*\d{4,}.*$/, '').trim()).filter(Boolean); // drop zip
  return parts.slice(0, 2).join(', ') || null;
}

export function RequestFromConnectorScreen() {
  const navigate = useNavigate();
  const { reqId } = useParams();
  const [searchParams] = useSearchParams();
  const myServiceId = searchParams.get('myServiceId') || null;
  const { showToast, auth } = useOutletContext();

  const [data, setData] = useState(null);     // null = loading
  // CERGIO-GUARD (2026-06-17, Tarik): the Inbox card passes the provider's
  // service via ?myServiceId=, but a DIRECT /inbound link (shared/bookmarked)
  // has none — which made Accept/Counter wrongly say "you need a listed
  // service" even with a matching listing. Fallback: resolve the provider's
  // own matching LISTED service (effect below). effectiveServiceId is used by
  // every respond handler instead of the raw URL param.
  const [resolvedSvcId, setResolvedSvcId] = useState(null);
  const effectiveServiceId = myServiceId || resolvedSvcId;
  const [notFound, setNotFound] = useState(false);
  const [mutuals, setMutuals] = useState(null);
  const [stats, setStats] = useState(null);   // connector strength (recos / services)
  const [phase, setPhase] = useState(null);    // null | 'pending' | 'done'
  const [composerMode, setComposerMode] = useState(null); // null | 'bid' | 'counter' | 'accept-time'
  const [counterDraft, setCounterDraft] = useState('');   // bid / counter price
  const [counterMsg, setCounterMsg] = useState('');       // note to the requester
  const [timeDraft, setTimeDraft] = useState('');         // chosen time when flexible
  const [mapOpen, setMapOpen] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [askOpen, setAskOpen] = useState(false);
  const [askDraft, setAskDraft] = useState('');
  const [myName, setMyName] = useState('');
  const [spotlights, setSpotlights] = useState([]);

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
        ttHandle:      requester.tiktok_handle || null,
        ttFollowers:   requester.tiktok_followers ?? null,
        headline:      (requester.headline || '').trim() || null,
        bio:           (requester.bio || '').trim() || null,
        igMedia:       null,  // reserved — real IG media post Meta approval
        spotlights:    null,  // reserved — past spotlights this Connector posted
        serviceType:   r.service_type || r.category || 'Service request',
        // TASK text for the message: prefer the requester's RAW words
        // (description / query) over the parsed type (what), e.g.
        // "vegan Ecuadorian dinner for 6" not "Catering".
        description:   r.description || r.query || r.what || '',
        whenText:      formatWhen(r),
        scheduledAt:   r.scheduled_at || null,
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
        getConnectorSpotlights(requester.id).then(({ data: sp }) => {
          if (!cancelled) setSpotlights(sp || []);
        });
      } else {
        setMutuals({ count: 0, connectors: 0, sample: [] });
      }
    });
    return () => { cancelled = true; };
  }, [reqId]);

  // Signed-in provider's name, for greeting them by first name in the note.
  useEffect(() => {
    let cancelled = false;
    getMyDisplayName().then(({ data: n }) => { if (!cancelled) setMyName(n || ''); });
    return () => { cancelled = true; };
  }, []);

  // Resolve the provider's own service when the URL didn't carry one (direct
  // link). Match the request's type to a LISTED service (taxonomy → category →
  // title), else fall back to the only/most-recent listing. Mirrors how the
  // Inbox derives my_service_id, so Accept works from anywhere. (Tarik 2026-06-17)
  useEffect(() => {
    if (myServiceId || !data) return;
    let cancelled = false;
    listMyServices().then(({ data: svcs }) => {
      if (cancelled) return;
      const listed = (svcs || []).filter(s => s.status === 'listed');
      if (!listed.length) { setResolvedSvcId(null); return; }
      const want = (data.serviceType || '').trim().toLowerCase();
      const match = want && listed.find(s =>
        [s.taxonomy_provider_type, s.category, s.title].some(v => {
          const t = (v || '').toLowerCase();
          return t && (t === want || t.includes(want) || want.includes(t));
        })
      );
      setResolvedSvcId((match || listed[0]).id);
    });
    return () => { cancelled = true; };
  }, [myServiceId, data]);

  // Load any pre-booking Q&A on this request.
  useEffect(() => {
    let cancelled = false;
    if (!reqId) return;
    listRequestQuestions(reqId).then(({ data: qs }) => {
      if (!cancelled) setQuestions(qs || []);
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
  const isPaid = !data.isFree;                 // budget set / not a Connector barter
  const hasSpecificTime = !!data.scheduledAt || /\b\d{1,2}\s*(:|am|pm)/i.test(data.whenText || '');
  const isFlexibleTime = !hasSpecificTime;     // provider picks the time on accept
  // Top line = the connector's REACH/contribution: audience (IG + TikTok) ·
  // reco's MADE · Cergio network. Their services + reco's RECEIVED sit under
  // the bio (contrasted as what they DO + social proof on their work).
  // LEAD with REACH (Tarik 2026-06-15): a Connector requesting a FREE service
  // is judged on reach first — IG followers, then network on Cergio, then
  // reco's made; services + reco's RECEIVED sit lower. Mirrors the profile
  // interim screen's order.
  const reachBits = [
    data.igFollowers > 0 ? `${Number(data.igFollowers).toLocaleString()} IG followers` : null,
    data.ttFollowers > 0 ? `${Number(data.ttFollowers).toLocaleString()} TikTok` : null,
  ].filter(Boolean);
  const reachLine = reachBits.join(' · ');
  const strength = [
    stats && stats.networkCount > 0 ? `${stats.networkCount} network on Cergio` : null,
    stats && stats.recommended > 0 ? `${stats.recommended} reco's made` : null,
  ].filter(Boolean).join(' · ');
  const services = (stats && stats.services) || [];

  const providerName = myName
    || auth?.user?.user_metadata?.display_name
    || auth?.user?.user_metadata?.full_name
    || auth?.user?.user_metadata?.name
    || auth?.profile?.display_name
    || '';
  const providerFirst = providerName.trim().split(' ')[0] || '';
  const note = composeNote({
    requesterName: data.requesterName, serviceType: data.serviceType, whenText: data.whenText,
    description: data.description, igFollowers: data.igFollowers, providerFirst,
    isFree: data.isFree, budgetCents: data.budgetCents,
  });

  // Approximate area + keyless OSM map of the neighborhood (no precise marker
  // so the exact address stays hidden until the booking is confirmed).
  const approxAddr = approxArea(data.locationText);
  const hasGeo = Number.isFinite(data.lat) && Number.isFinite(data.lng);
  const dLat = 0.008, dLng = 0.012;
  const osmSrc = hasGeo
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${data.lng - dLng}%2C${data.lat - dLat}%2C${data.lng + dLng}%2C${data.lat + dLat}&layer=mapnik`
    : null;

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${data.serviceType} request`, url });
      else { await navigator.clipboard.writeText(url); showToast('Link copied'); }
    } catch { /* dismissed */ }
  };
  const handleFlag = () => showToast('Flagged for review — thanks.');

  const sendQuestion = async () => {
    const text = askDraft.trim();
    if (!text) { showToast('Type a question first.'); return; }
    const { data: q, error } = await askRequestQuestion(data.id, text);
    if (error || !q) { showToast('Could not send — try again.'); return; }
    setQuestions(prev => [...prev, q]);
    setAskDraft(''); setAskOpen(false);
    showToast(`Question sent — ${data.requesterName} will be notified.`);
  };

  const sendResponse = async (status, offeredPriceCents = null, message = null) => {
    if ((status === 'offered' || status === 'countered') && !effectiveServiceId) {
      showToast('You need a listed service to respond.');
      return;
    }
    setPhase('pending');
    const { error } = await respondToRequest(data.id, {
      status, serviceId: effectiveServiceId || null, offeredPriceCents, message, waveN: null,
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

  // Accept + pick a time → CONFIRMED booking at that time (Tarik 2026-06-16).
  // Either party can reschedule it afterwards. scheduledAt may be null (the
  // request had no concrete time) — the RPC then defaults, and the connector
  // can set/adjust it.
  const acceptWithTime = async (scheduledAt) => {
    if (!effectiveServiceId) { showToast('You need a listed service to accept.'); return; }
    setPhase('pending');
    const { error } = await acceptRequestWithTime({ requestId: data.id, serviceId: effectiveServiceId, scheduledAt });
    if (error) { showToast(error.message || 'Could not confirm — try again.'); setPhase(null); return; }
    setPhase('done');
    setComposerMode(null);
    showToast(`Booked & confirmed — ${data.requesterName} can reschedule with you.`);
    setTimeout(() => navigate('/inbox'), 1200);
  };

  const openComposer = (mode) => { setCounterDraft(''); setCounterMsg(''); setTimeDraft(''); setComposerMode(mode); };

  const fmtChosen = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? v
      : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  };

  // Unified submit for the bid / counter / pick-a-time composer.
  const submitResponse = () => {
    // Pick-a-time accept → CONFIRMED booking at that time (not just an offer).
    if (composerMode === 'accept-time') {
      if (!timeDraft) { showToast('Pick a start time.'); return; }
      acceptWithTime(timeDraft);
      return;
    }
    const wantsPrice = composerMode === 'bid' || composerMode === 'counter';
    let priceCents = null;
    if (wantsPrice) {
      const dollars = parseFloat(counterDraft);
      if (!Number.isFinite(dollars) || dollars < 0) { showToast('Enter a price.'); return; }
      priceCents = Math.round(dollars * 100);
    }
    const parts = [];
    if (counterMsg.trim()) parts.push(counterMsg.trim());
    const message = parts.join(' · ') || null;
    const status = composerMode === 'counter' ? 'countered' : 'offered';
    setComposerMode(null);
    sendResponse(status, priceCents, message);
  };

  const ico = 'w-9 h-9 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.10)] flex items-center justify-center text-black';

  return (
    <div className="flex-1 flex flex-col bg-cr pb-48 overflow-y-auto">
      {/* header — back · name · flag + share */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className={ico} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={handleFlag} className={ico} aria-label="Flag">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
          </button>
          <button onClick={handleShare} className={ico} aria-label="Share">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></svg>
          </button>
        </div>
      </div>

      {/* headline — eyebrow label + the exchange + date */}
      <div className="px-5 pt-1 pb-3">
        <p className="text-caps text-gd mb-1">{data.isFree ? 'Free service request' : 'Paid service request'}</p>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-heading-2 font-extrabold text-black leading-tight">
            {data.isFree ? (
              <>Free {data.serviceType} <span className="text-g">⇄</span> Free spotlight{data.igFollowers > 0 ? <> to {Number(data.igFollowers).toLocaleString()} followers</> : null}</>
            ) : (
              <>{data.serviceType}{data.budgetCents > 0 ? <> · up to <span className="text-g">${Math.round(data.budgetCents / 100)}</span></> : null}</>
            )}
          </h1>
          {data.whenText && (
            <span className="shrink-0 text-meta-sm font-extrabold text-gd bg-gl rounded-pill px-2.5 py-1 mt-0.5 whitespace-nowrap">{data.whenText}</span>
          )}
        </div>
      </div>

      {/* requester block — identity (avatar · bio · services) ABOVE the IG box;
          mutual friends BELOW the IG box (Tarik 2026-06-14). */}
      {(data.isConnector || data.igHandle || data.bio) && (
        <div className="px-5 pb-3">
          <div className="bg-bg4 rounded-[18px] p-3.5">
            {/* identity: avatar + name + Connector badge + IG counts + bio */}
            <div className="flex items-start gap-3">
              <Avatar name={data.requesterName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-body font-extrabold text-black truncate">{data.requesterName}</p>
                  {data.isConnector && (
                    <span className="inline-flex items-center gap-0.5 bg-gl text-gd text-[10px] font-extrabold px-1.5 py-0.5 rounded-pill">
                      <ShieldIcon size={9} />Connector
                    </span>
                  )}
                </div>
                {/* Headline — below the Connector badge, above the IG count
                    (Tarik 2026-06-17). The bio stays below, above services. */}
                {data.headline && (
                  <p className="text-meta text-b2 font-medium leading-snug mt-0.5">{data.headline}</p>
                )}
                {/* LEAD with reach: IG followers (prominent), then network ·
                    reco's made, then See Instagram, then bio. */}
                {reachLine && (
                  <p className="flex items-center gap-1 text-body-sm font-extrabold text-black mt-0.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true" className="shrink-0">
                      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none" />
                    </svg>
                    {reachLine}
                  </p>
                )}
                {strength && <p className="text-meta-sm text-b3 mt-0.5">{strength}</p>}
                {data.igHandle && (
                  <a href={`https://instagram.com/${String(data.igHandle).replace(/^@/, '')}`} target="_blank" rel="noreferrer"
                    className="inline-block text-meta-sm text-gd font-extrabold underline underline-offset-2 hover:opacity-80 mt-0.5">See Instagram</a>
                )}
                {data.bio && <p className="text-meta text-b3 leading-snug mt-1 line-clamp-3">{data.bio}</p>}
              </div>
            </div>

            {/* services offered — each with its own reco count (no "Services:" word) */}
            {services.length > 0 && (
              <p className="text-meta-sm text-b3 leading-snug mt-2">
                {services.map((s, i) => (
                  <span key={s.name}>{i > 0 ? ', ' : ''}<span className="font-extrabold text-b2">{s.name}</span> ({s.recos} reco{s.recos === 1 ? '' : 's'} received)</span>
                ))}
              </p>
            )}

            {/* mutual friends — directly under the services offered (Tarik) */}
            <div className="mt-2.5">
              {mutuals === null ? null : hasMutuals ? (
                <div className="flex items-center gap-2.5">
                  <div className="flex -space-x-2 shrink-0">
                    {mutuals.sample.map(m => (
                      <button key={m.id} onClick={() => navigate(`/u/${m.id}`)} title={m.name}
                        className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-extrabold text-white ${m.is_connector ? 'bg-g' : 'bg-gradient-to-br from-[#b06090] to-[#703050]'}`}>{m.initial}</button>
                    ))}
                  </div>
                  <p className="text-meta text-b2 leading-snug min-w-0">
                    <span className="font-extrabold text-black">{mutualSummaryText(mutuals)}</span>{' — '}
                    {mutuals.sample.map((m, i) => (
                      <span key={m.id}>{i > 0 ? ', ' : ''}<button onClick={() => navigate(`/u/${m.id}`)} className="text-gd font-extrabold hover:underline">{m.name}</button></span>
                    ))}
                    {mutuals.count > mutuals.sample.length ? ` +${mutuals.count - mutuals.sample.length} more` : ''}
                  </p>
                </div>
              ) : (
                <p className="text-meta text-b3">You have no mutual friends with {data.requesterName} yet.</p>
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

      {/* previous spotlights on Cergio — the Connector's track record of posts
          they've made for other services. Real IG post links (tappable tiles),
          not fabricated media; only shown when they have any. */}
      {data.isConnector && spotlights.length > 0 && (
        <div className="px-5 pb-3">
          <p className="text-body-sm font-extrabold text-black mb-2">
            Previous spotlights on Cergio <span className="text-b3 font-medium">· {spotlights.length}</span>
          </p>
          {/* Spotlights ~70% smaller (Tarik 2026-06-17) — fixed-width tiles in a
              wrapping row rather than full-width thirds. */}
          <div className="flex flex-wrap gap-2">
            {spotlights.slice(0, 6).map(s => (
              <div key={s.id} className="w-[76px]">
                <IgPostTile url={s.post_url} aspect="4 / 5" label={`Spotlight: ${s.title}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* personalized message from the Connector (composed from the request) */}
      <div className="px-5 pb-3">
        <div className="bg-soft rounded-[18px] p-4">
          <div className="flex items-start gap-2.5">
            <div className="w-6 h-6 min-w-6 mt-0.5 rounded-full bg-gradient-to-br from-[#b06090] to-[#703050] flex items-center justify-center text-white text-[10px] font-extrabold">
              {getInitials(data.requesterName)}
            </div>
            <p className="text-body text-black leading-relaxed flex-1">{note}</p>
          </div>
        </div>
      </div>

      {/* pre-booking Q&A — ask follow-up questions before deciding (Tarik) */}
      {!alreadyResolved && (
        <div className="px-5 pb-3">
          {questions.length > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {questions.map(q => (
                <div key={q.id} className="bg-white border border-line rounded-[14px] p-3">
                  <p className="text-meta-sm font-extrabold text-b3">You asked</p>
                  <p className="text-body-sm text-black leading-snug">{q.body}</p>
                  {q.reply ? (
                    <div className="mt-2 pl-3 border-l-2 border-g/40">
                      <p className="text-meta-sm font-extrabold text-gd">{data.requesterName} replied</p>
                      <p className="text-body-sm text-black leading-snug">{q.reply}</p>
                    </div>
                  ) : (
                    <p className="text-meta text-b3 mt-1">Waiting for reply…</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {askOpen ? (
            <div className="bg-white border border-bdr rounded-[16px] p-3">
              <div className="flex flex-wrap gap-2 mb-2">
                {QUICK_QS.map(q => (
                  <button key={q} type="button" onClick={() => setAskDraft(q)}
                    className="text-meta-sm font-extrabold text-gd bg-gl rounded-pill px-2.5 py-1 hover:bg-g/15 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
              <textarea autoFocus rows={2} value={askDraft} onChange={e => setAskDraft(e.target.value)}
                placeholder="Ask a question before you decide…"
                className="w-full border border-bdr rounded-[12px] px-3 py-2.5 text-body-sm font-medium text-black bg-white outline-none focus:border-g resize-none" />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={sendQuestion} className="flex-1 bg-g text-white rounded-pill py-2.5 text-meta font-extrabold active:scale-[.98] transition-all">Send question</button>
                <button onClick={() => setAskOpen(false)} className="text-meta font-extrabold text-b3 px-3">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => { setAskDraft(''); setAskOpen(true); }}
              className="w-full inline-flex items-center justify-center gap-1.5 border border-bdr rounded-pill py-2.5 text-body-sm font-extrabold text-gd hover:bg-bg5 transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Ask a question before you accept
            </button>
          )}
        </div>
      )}

      {/* map — area around the address; tap to expand (Airbnb-style). No
          precise pin; exact street address blocked until accepted + confirmed. */}
      <div className="px-5 pb-3">
        <button type="button" onClick={() => setMapOpen(true)}
          className="relative block w-full text-left rounded-[18px] overflow-hidden h-[200px] bg-[#E8EEE6] border border-line">
          {osmSrc ? (
            <iframe title="Approximate area" src={osmSrc} loading="lazy"
              className="absolute inset-0 w-full h-full pointer-events-none" style={{ border: 0, filter: 'saturate(0.92)' }} />
          ) : null}
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-g/15 border-2 border-g/40" aria-hidden="true" />
          <span className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111114" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </span>
          <span className="absolute left-3 right-3 bottom-3 block">
            <span className="block bg-white/95 backdrop-blur rounded-[12px] px-3 py-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.10)]">
              <span className="block text-body-sm font-extrabold text-black leading-snug">
                Approximate area{approxAddr ? ` · ${approxAddr}` : ''}
              </span>
              <span className="block text-meta text-b3 mt-0.5 leading-snug">
                Tap to expand · exact address shared after you accept &amp; confirm.
              </span>
            </span>
          </span>
        </button>
      </div>

      {/* benefit line (Figma) */}
      {!alreadyResolved && data.isFree && (
        <div className="px-5 pt-2 text-center">
          <p className="text-body-lg font-extrabold text-black">You'll get free marketing</p>
          <p className="text-body-sm text-b3">and service verification with a 4+ star rating.</p>
        </div>
      )}

      {/* sticky actions — adapt to free/paid + flexible time */}
      {!alreadyResolved && (
        <div className="fixed bottom-0 inset-x-0 max-w-[390px] mx-auto bg-cr px-5 pt-3 pb-6 border-t border-line shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          {phase === 'pending' ? (
            <p className="text-body-sm text-b3 font-medium text-center py-3">Sending…</p>
          ) : composerMode ? (
            <div>
              {(composerMode === 'bid' || composerMode === 'counter') && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-9 h-9 min-w-9 rounded-[10px] bg-gl text-gd text-body font-extrabold">$</span>
                  <input autoFocus inputMode="decimal"
                    placeholder={composerMode === 'bid' ? 'Your bid price' : 'Propose a price'}
                    value={counterDraft} onChange={e => setCounterDraft(e.target.value)}
                    className="flex-1 border border-bdr rounded-[12px] px-3 py-3 text-body-sm font-medium text-black bg-white outline-none focus:border-g" />
                </div>
              )}
              {isFlexibleTime && (
                <div className="mt-2">
                  <label className="block text-meta-sm font-extrabold text-b2 mb-1">Pick a start time</label>
                  <input type="datetime-local" value={timeDraft} onChange={e => setTimeDraft(e.target.value)}
                    className="w-full border border-bdr rounded-[12px] px-3 py-3 text-body-sm font-medium text-black bg-white outline-none focus:border-g" />
                </div>
              )}
              <input value={counterMsg} onChange={e => setCounterMsg(e.target.value)}
                placeholder="Add a note (optional)"
                className="w-full mt-2 border border-bdr rounded-[12px] px-3 py-3 text-body-sm font-medium text-black bg-white outline-none focus:border-g" />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={submitResponse} className="flex-1 bg-g text-white rounded-[24px] py-3.5 text-body font-extrabold active:scale-[.98] transition-all">
                  {composerMode === 'bid' ? 'Send bid' : composerMode === 'counter' ? 'Send counter' : 'Confirm & accept'}
                </button>
                <button onClick={() => setComposerMode(null)} className="text-body font-extrabold text-b3 px-3">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {isPaid ? (
                <button onClick={() => openComposer('bid')}
                  className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                  Place a bid{data.budgetCents > 0 ? ` · budget $${Math.round(data.budgetCents / 100)}` : ''}
                </button>
              ) : isFlexibleTime ? (
                <button onClick={() => openComposer('accept-time')}
                  className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                  Pick a time &amp; accept
                </button>
              ) : (
                <button onClick={() => acceptWithTime(data.scheduledAt)}
                  className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
                  Accept &amp; confirm{data.scheduledAt ? '' : ' time'}
                </button>
              )}
              <div className="flex items-center justify-center gap-3 mt-2.5">
                {!isPaid && (
                  <button onClick={() => openComposer('counter')}
                    className="inline-flex items-center gap-1.5 border border-bdr rounded-pill px-4 py-2 text-body-sm font-extrabold text-b2 hover:bg-bg5 active:scale-[.97] transition-all">
                    <span className="text-g">$</span>Counter
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10l-3-3M17 17H7l3 3" /></svg>
                  </button>
                )}
                <button onClick={() => sendResponse('declined')} className="rounded-pill px-4 py-2 text-body-sm font-extrabold text-g hover:bg-gl active:scale-[.97] transition-all">Decline</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* expanded map — Airbnb-style larger view (still approximate, no pin) */}
      {mapOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setMapOpen(false)}>
          <div className="relative w-full max-w-[420px] h-[72vh] bg-white rounded-[20px] overflow-hidden" onClick={e => e.stopPropagation()}>
            {osmSrc ? (
              <iframe title="Approximate area — expanded" src={osmSrc} className="absolute inset-0 w-full h-full" style={{ border: 0 }} />
            ) : null}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full bg-g/15 border-2 border-g/40 pointer-events-none" aria-hidden="true" />
            <button onClick={() => setMapOpen(false)} aria-label="Close map"
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,0.18)] flex items-center justify-center text-black">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
            <div className="absolute left-3 right-3 bottom-3 bg-white/95 backdrop-blur rounded-[12px] px-3 py-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.12)]">
              <p className="text-body-sm font-extrabold text-black leading-snug">Approximate area{approxAddr ? ` · ${approxAddr}` : ''}</p>
              <p className="text-meta text-b3 mt-0.5 leading-snug">Exact address is shared after you accept &amp; the booking is confirmed.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
