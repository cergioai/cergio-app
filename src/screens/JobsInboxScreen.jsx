import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  listProviderBookings,
  listConsumerBookings,
  listMyOutboundSpotlightRequests,
  listInboundRequests,
  listMyRequestsWithResponses,
  listMyRequestQuestions,
  replyRequestQuestion,
  respondToRequest,
  confirmBookingPost,
  flagBookingPost,
} from '../lib/api';
import { stampInboxSeen } from '../hooks/useInboxUnread';
import { MarkBookingPostedModal } from '../components/ui/MarkBookingPostedModal';

// Map a Supabase bookings row → the same shape the existing UI uses.
function bookingToRequest(b) {
  const dt   = b.scheduled_at ? new Date(b.scheduled_at) : null;
  const date = dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const appt = dt
    ? `${dt.toLocaleDateString('en-US', { weekday: 'short' })}, ${date} — ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : '—';
  // Phase 6 (2026-06-01): purpose-aware preview line. Was "free-text
  // notes || service title || 'New booking request'" — which didn't
  // explain WHAT the consumer was asking for. Now leads with the
  // exchange type so the inbox reads like a meaningful queue:
  //   free spotlight ask → "Free spotlight ask · {service}"
  //   paid booking       → "Booking request · {service}"
  const svcTitle = b.service?.title || 'your service';
  const purpose = b.is_free_for_rainmaker
    ? `Free spotlight ask · ${svcTitle}`
    : `Booking request · ${svcTitle}`;
  return {
    id:                  b.id,
    sender:              b.consumer?.display_name || 'Cergio user',
    // Free-form note (if the consumer left one) becomes the secondary
    // preview; the purpose line above is what reads as the "what".
    preview:             purpose,
    note:                b.notes || '',
    date,
    appointmentTime:     appt,
    isFreeForRainmakers: !!b.is_free_for_rainmaker,
    needsResponse:       b.status === 'pending',
    isUnread:            b.status === 'pending',
    real:                true,
  };
}

// Avatar palette — matches the friend-avatar gradient style used elsewhere in the app.
const AVATAR_GRADIENTS = [
  'bg-gradient-to-br from-[#b06090] to-[#703050]',
  'bg-gradient-to-br from-[#4478aa] to-[#2a5070]',
  'bg-gradient-to-br from-g to-gd',
  'bg-gradient-to-br from-[#c07050] to-[#903828]',
  'bg-gradient-to-br from-[#885088] to-[#5a3060]',
];

function getInitials(name) {
  return name
    .split(' ')
    .map(s => s[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, idx }) {
  return (
    <div
      className={`w-12 h-12 rounded-full flex items-center justify-center
                  text-white text-body font-extrabold flex-shrink-0
                  ${AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length]}`}
    >
      {getInitials(name)}
    </div>
  );
}

const TABS = ['Requests', 'Sent', 'Upcoming', 'Past'];

export function JobsInboxScreen() {
  const navigate = useNavigate();
  const { showToast, auth, payForBooking } = useOutletContext();
  const [activeTab, setActiveTab] = useState('Requests');
  const [real, setReal] = useState(null);
  // CERGIO-GUARD: real client-side filter, no 'coming soon' placeholder.
  // Filters across sender + preview + date across all tabs.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const matchesSearch = (r) => {
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return [r.sender, r.preview, r.date, r.appointmentTime]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  };

  useEffect(() => {
    if (!auth?.isSignedIn) { setReal([]); return; }
    let cancelled = false;
    listProviderBookings().then(({ data }) => {
      if (cancelled) return;
      setReal((data || []).map(bookingToRequest));
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  // CERGIO-GUARD (2026-06-12): stamp the inbox-seen timestamp so the
  // BottomNav dot (useInboxUnread) clears when the user visits Inbox.
  useEffect(() => { stampInboxSeen(); }, []);

  // CERGIO-GUARD (2026-06-12): requester-side visibility. Tarik:
  // "t@cergio.ai didn't get a confirm that info@cergio.ai confirmed."
  // The requester had no surface showing provider responses after
  // leaving /results. This loads the user's own posted requests with
  // confirmed responses so the Requests tab can show "{provider}
  // accepted your {service} request". Refreshes every 30s alongside
  // the inbound poll.
  const [myRequests, setMyRequests] = useState(null);
  useEffect(() => {
    if (!auth?.isSignedIn) { setMyRequests([]); return; }
    let cancelled = false;
    const fetchOnce = () => {
      listMyRequestsWithResponses({ limit: 20 }).then(({ data }) => {
        if (cancelled) return;
        setMyRequests(data || []);
      });
    };
    fetchOnce();
    const t = setInterval(fetchOnce, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [auth?.isSignedIn]);
  // Requests I posted that have at least one live response — the rows
  // worth surfacing in the Requests tab.
  const myAnswered = (myRequests || []).filter(r => (r.responses || []).length > 0);

  // Pre-booking questions providers asked on MY requests — I answer them here.
  const [myQuestions, setMyQuestions] = useState([]);
  const [replyDraft, setReplyDraft] = useState({});   // { [questionId]: text }
  useEffect(() => {
    if (!auth?.isSignedIn) { setMyQuestions([]); return; }
    let cancelled = false;
    const fetchOnce = () => listMyRequestQuestions().then(({ data }) => { if (!cancelled) setMyQuestions(data || []); });
    fetchOnce();
    const t = setInterval(fetchOnce, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [auth?.isSignedIn]);
  const sendReply = async (q) => {
    const text = (replyDraft[q.id] || '').trim();
    if (!text) { showToast('Type a reply first.'); return; }
    const { error } = await replyRequestQuestion(q.id, text);
    if (error) { showToast('Could not send — try again.'); return; }
    setMyQuestions(prev => prev.map(x => x.id === q.id ? { ...x, reply: text } : x));
    setReplyDraft(prev => ({ ...prev, [q.id]: '' }));
    showToast('Reply sent.');
  };
  const openQuestions = myQuestions.filter(q => !q.reply);

  // Real bookings only — empty state when there are none. No more mock pad.
  const requests   = real ?? [];

  // CERGIO-GUARD (2026-06-03): open consumer requests this provider can
  // respond to. Sits ABOVE the existing booking list because every
  // second a provider takes here is bid-decay time
  // (MARKETPLACE_SPEC § 4 time-decay weighting). Accept / Counter /
  // Decline call respondToRequest with the corresponding status.
  const [inbound, setInbound] = useState(null);
  const [responding, setResponding] = useState({}); // { [requestId]: 'pending'|'done' }
  // Tracks the last request the provider responded to so we can show a
  // confirmation card instead of the generic "No requests yet" empty state.
  const [lastResponded, setLastResponded] = useState(null); // { sender, status }
  // CERGIO-GUARD (2026-06-03): inline counter UI per Tarik — no
  // window.prompt. counterOpenFor stores the id of the request
  // whose counter input is expanded; counterDraft holds the typed
  // dollar value.
  const [counterOpenFor, setCounterOpenFor] = useState(null);
  const [counterDraft, setCounterDraft] = useState('');
  useEffect(() => {
    if (!auth?.isSignedIn) { setInbound([]); return; }
    let cancelled = false;
    const fetchOnce = () => {
      listInboundRequests({ limit: 20 }).then(({ data }) => {
        if (cancelled) return;
        setInbound(data || []);
      });
    };
    fetchOnce();
    // Refresh every 30s so a provider sitting on the Jobs tab sees new
    // requests roll in without manually pulling.
    const t = setInterval(fetchOnce, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [auth?.isSignedIn]);

  // CERGIO-GUARD (2026-06-12): the Requests tab badge now counts ALL
  // actionable items — unread bookings + open requests near you +
  // provider responses to my own requests — so it matches what the
  // tab actually renders.
  const badgeCount =
    requests.filter(r => r.isUnread).length +
    (inbound || []).length +
    openQuestions.length +
    myAnswered.reduce((n, r) => n + (r.responses || []).length, 0);

  async function handleInboundResponse(req, status) {
    if (!req.my_service_id) {
      showToast('You need a listed service to respond.');
      return;
    }
    setResponding(prev => ({ ...prev, [req.id]: 'pending' }));
    const { error } = await respondToRequest(req.id, {
      status,
      serviceId: req.my_service_id,
      offeredPriceCents: null, // null = take the asking price; counter UI sets a value
      message: null,
      waveN: null,
    });
    if (error) {
      showToast('Could not send response — try again.');
      setResponding(prev => ({ ...prev, [req.id]: undefined }));
      return;
    }
    setResponding(prev => ({ ...prev, [req.id]: 'done' }));
    // Optimistically drop this row so the inbox visibly shrinks.
    setInbound(prev => (prev || []).filter(r => r.id !== req.id));
    // Remember who we just responded to so the empty-state shows a
    // confirmation card instead of "No requests yet / List a service".
    setLastResponded({ sender: req.sender || 'the user', status });
    showToast(
      status === 'offered'   ? 'Offer sent ✓'   :
      status === 'declined'  ? 'Request declined' :
      status === 'countered' ? 'Counter sent ✓' :
      'Response sent'
    );
  }

  // CERGIO-GUARD (2026-06-12): Upcoming / Past tabs are REAL now —
  // they carry the free-service barter loop from Tarik's flow board.
  // Both roles load lazily when either tab activates:
  //   as consumer (Connector) → mark IG post done / see flag reasons
  //   as provider             → review post, Accept or flag a problem
  const [myJobs, setMyJobs] = useState(null); // { asConsumer:[], asProvider:[] }
  const [postTarget, setPostTarget] = useState(null);     // booking → MarkBookingPostedModal
  const [flagOpenFor, setFlagOpenFor] = useState(null);   // booking id with flag input open
  const [flagDraft, setFlagDraft] = useState('');
  const [jobBusy, setJobBusy] = useState({});             // { [bookingId]: true }
  const refreshJobs = async () => {
    const [c, p] = await Promise.all([listConsumerBookings(), listProviderBookings()]);
    setMyJobs({ asConsumer: c.data || [], asProvider: p.data || [] });
  };
  useEffect(() => {
    if ((activeTab !== 'Upcoming' && activeTab !== 'Past') || !auth?.isSignedIn) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([listConsumerBookings(), listProviderBookings()]);
      if (cancelled) return;
      setMyJobs({ asConsumer: c.data || [], asProvider: p.data || [] });
    })();
    return () => { cancelled = true; };
  }, [activeTab, auth?.isSignedIn]);

  // A free booking is "live" until the provider accepts the IG post —
  // even when the job itself is done. That keeps the barter obligation
  // visible in Upcoming instead of vanishing into Past unfinished.
  const isLiveJob = (b) =>
    ['confirmed', 'in_progress'].includes(b.status) ||
    (b.is_free_for_rainmaker && !b.post_confirmed_at &&
      ['confirmed', 'in_progress', 'completed'].includes(b.status));
  const isPastJob = (b) =>
    (b.status === 'completed' && (!b.is_free_for_rainmaker || !!b.post_confirmed_at)) ||
    b.status === 'cancelled';

  const handleConfirmPost = async (b) => {
    setJobBusy(prev => ({ ...prev, [b.id]: true }));
    const { error } = await confirmBookingPost(b.id);
    setJobBusy(prev => ({ ...prev, [b.id]: false }));
    if (error) { showToast(`Failed: ${error.message}`); return; }
    showToast('Post accepted ✓ — barter complete');
    refreshJobs();
  };
  const handleFlagPost = async (b) => {
    const reason = flagDraft.trim();
    if (!reason) { showToast('Say what needs fixing.'); return; }
    setJobBusy(prev => ({ ...prev, [b.id]: true }));
    const { error } = await flagBookingPost(b.id, { reason });
    setJobBusy(prev => ({ ...prev, [b.id]: false }));
    if (error) { showToast(`Failed: ${error.message}`); return; }
    setFlagOpenFor(null);
    setFlagDraft('');
    showToast("Sent — they'll update the post.");
    refreshJobs();
  };

  // Sent — provider's outgoing spotlight asks. Loaded lazily so the
  // Inbox tab doesn't pay the cost until the user opens the Sent tab.
  const [sent, setSent] = useState(null);
  useEffect(() => {
    if (activeTab !== 'Sent' || !auth?.isSignedIn) return;
    if (sent !== null) return;
    listMyOutboundSpotlightRequests({ limit: 50 }).then(({ data }) => {
      setSent(data || []);
    });
  }, [activeTab, auth?.isSignedIn, sent]);

  return (
    <div className="flex-1 overflow-y-auto pb-24 bg-cr">

      {/* header — title + search */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <h1 className="text-display-2 font-extrabold text-black tracking-tight leading-none flex-shrink-0">
          Jobs
        </h1>
        {searchOpen ? (
          <div className="flex-1 flex items-center gap-2 bg-white border border-bdr rounded-pill px-4 py-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="#6B6B6B" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              autoFocus
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by name, service, date…"
              className="flex-1 bg-transparent outline-none text-body-sm text-black placeholder-b3 py-1"
            />
            <button
              type="button"
              onClick={() => { setSearchOpen(false); setSearchQ(''); }}
              aria-label="Close search"
              className="text-body text-b3 font-extrabold px-1"
            >×</button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="flex-1 flex items-center gap-2 bg-white border border-bdr rounded-pill
                       px-4 py-2.5 text-left hover:border-g transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="#6B6B6B" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <span className="text-body-sm text-b3 font-medium">Search jobs and requests</span>
          </button>
        )}
      </div>

      {/* tabs */}
      <div className="flex items-center gap-6 px-5 border-b border-bdr">
        {TABS.map(tab => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative pb-3 flex items-center gap-1.5 cursor-pointer"
            >
              <span className={`text-body ${active ? 'font-extrabold text-black' : 'font-medium text-b3'}`}>
                {tab}
              </span>
              {active && tab === 'Requests' && badgeCount > 0 && (
                <div className="bg-g text-white text-caps font-extrabold rounded-full
                                min-w-[18px] h-[18px] flex items-center justify-center px-1.5">
                  {badgeCount}
                </div>
              )}
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-g rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* request list — filter pills removed per audit */}
      <div className="px-5 flex flex-col gap-3 pt-4">

        {/* CERGIO-GUARD (2026-06-03): open consumer requests for this
            provider's service type — the "notify → confirm" half of
            MARKETPLACE_SPEC. Sits ABOVE existing bookings because
            every second of provider lag is bid-decay
            (MARKETPLACE_SPEC § 4). */}
        {/* CERGIO-GUARD (2026-06-12): responses to MY posted requests.
            Tarik: "t@cergio.ai didn't get a confirm that info@cergio.ai
            confirmed" — once the requester left /results there was NO
            surface showing that a provider accepted. This section is
            that surface. Sits at the very top of the Requests tab:
            a response to something YOU asked for is the most timely
            item here. Each response row taps through to the provider's
            profile (/u/{id}) so the requester can vet them. */}
        {/* Pre-booking questions providers asked on your requests — reply here. */}
        {activeTab === 'Requests' && openQuestions.length > 0 && (
          <>
            <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-1">
              Questions to answer
            </p>
            {openQuestions.map(q => (
              <div key={q.id} className="bg-white border-2 border-g/30 rounded-[18px] p-4">
                <p className="text-body-sm font-extrabold text-black leading-snug">
                  {q.askerName}{q.serviceType ? ` · ${q.serviceType}` : ''}
                </p>
                <p className="text-body text-black leading-snug mt-1">&ldquo;{q.body}&rdquo;</p>
                <div className="flex items-center gap-2 mt-2.5">
                  <input value={replyDraft[q.id] || ''} onChange={e => setReplyDraft(prev => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="Type your reply…"
                    className="flex-1 border border-bdr rounded-[12px] px-3 py-2.5 text-body-sm font-medium text-black bg-white outline-none focus:border-g" />
                  <button onClick={() => sendReply(q)} className="bg-g text-white rounded-[12px] px-4 py-2.5 text-meta font-extrabold active:scale-[.97] transition-all">Reply</button>
                </div>
              </div>
            ))}
          </>
        )}

        {activeTab === 'Requests' && myAnswered.length > 0 && (
          <>
            <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-1">
              Responses to your requests
            </p>
            {myAnswered.map(myReq => (
              <div key={myReq.id} className="bg-white border-2 border-g/30 rounded-[20px] p-4">
                <p className="text-body-sm font-extrabold text-black leading-snug truncate">
                  Your request · {myReq.service_type || myReq.category || 'service'}
                </p>
                {myReq.location_text && (
                  <p className="text-meta text-b3 font-medium leading-snug mt-0.5 truncate">
                    {myReq.location_text}
                  </p>
                )}
                <div className="mt-2 flex flex-col gap-2">
                  {myReq.responses.map((resp, ri) => {
                    const name  = resp.responder?.display_name || 'A provider';
                    const price = resp.offered_price_cents;
                    const priceLabel = price != null ? ` — $${(price / 100).toFixed(0)}` : '';
                    const line =
                      resp.status === 'accepted'  ? `${name} is confirmed ✓` :
                      resp.status === 'countered' ? `${name} countered${priceLabel}` :
                      `${name} accepted your request${priceLabel}`;
                    const target = resp.responder?.id || null;
                    return (
                      <button
                        key={resp.id}
                        type="button"
                        disabled={!target}
                        onClick={() => target && navigate(`/u/${target}`)}
                        className="w-full flex items-center gap-3 bg-gl rounded-[14px] px-3 py-2.5 text-left
                                   hover:opacity-90 transition-opacity disabled:cursor-default"
                      >
                        <Avatar name={name} idx={ri} />
                        <div className="flex-1 min-w-0">
                          <p className="text-body-sm font-extrabold text-gd leading-snug">
                            {line}
                          </p>
                          {resp.service?.title && (
                            <p className="text-meta-sm text-b2 font-medium leading-snug truncate">
                              {resp.service.title}
                            </p>
                          )}
                          {target && (
                            <p className="text-meta-sm text-g font-extrabold mt-0.5">
                              View profile →
                            </p>
                          )}
                        </div>
                        <span className="text-b3 text-base flex-shrink-0">›</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {activeTab === 'Requests' && inbound && inbound.length > 0 && (
          <>
            <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-1">
              New requests near you
            </p>
            {inbound.filter(req => {
              if (!searchQ.trim()) return true;
              const q = searchQ.toLowerCase();
              const name = req.requester?.display_name || '';
              return [name, req.service_type, req.description, req.location_text]
                .filter(Boolean)
                .some(v => String(v).toLowerCase().includes(q));
            }).map((req, i) => {
              const senderName = req.requester?.display_name || 'A Cergio user';
              const state = responding[req.id];
              const minutesAgo = req.created_at
                ? Math.max(0, Math.round((Date.now() - new Date(req.created_at).getTime()) / 60000))
                : 0;
              // CERGIO-GUARD (2026-06-13): tapping the card opens the
              // dedicated connector-request screen (job details, map,
              // Connector status, friends-in-common, Accept/Counter/
              // Decline). That screen carries a "See full profile" link
              // to /u/{requester.id}, so Tarik's "view the profile before
              // responding" need is preserved as a secondary tap. Inline
              // Accept/Counter/Decline buttons stay OUTSIDE this tappable
              // area as a quick path.
              const profileTarget = req.requester?.id || null;
              const openProfile = () => {
                navigate(`/inbound/${req.id}?myServiceId=${req.my_service_id || ""}`);
              };
              return (
                <div
                  key={req.id}
                  className="bg-white border-2 border-g/30 rounded-[20px] p-4 flex gap-3"
                >
                  <div className="w-2 flex-shrink-0 mt-1.5">
                    <div className="w-2 h-2 rounded-full bg-g" />
                  </div>
                  <button
                    type="button"
                    onClick={openProfile}
                    disabled={!profileTarget}
                    aria-label={`View ${senderName}'s profile`}
                    className="flex-shrink-0 self-start disabled:cursor-default"
                  >
                    <Avatar name={senderName} idx={i} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={openProfile}
                      disabled={!profileTarget}
                      className="w-full text-left -m-1 p-1 rounded-[14px] hover:bg-bg5/30 transition-colors
                                 disabled:hover:bg-transparent disabled:cursor-default"
                    >
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-body-lg font-extrabold text-black truncate">
                          {senderName}
                        </span>
                        <span className="text-meta text-b3 font-medium flex-shrink-0 ml-2">
                          {minutesAgo === 0 ? 'just now' : `${minutesAgo}m ago`}
                        </span>
                      </div>
                      <p className="text-body-sm font-extrabold text-black leading-snug mb-1 truncate">
                        Needs a {req.service_type}
                      </p>
                      {req.description && (
                        <p className="text-meta text-b3 font-medium leading-snug mb-2 line-clamp-2">
                          "{req.description}"
                        </p>
                      )}
                      {req.location_text && (
                        <p className="text-meta text-b3 font-medium leading-snug">
                          {req.location_text}
                        </p>
                      )}
                      {profileTarget && (
                        <p className="text-meta-sm text-g font-extrabold mt-1">
                          View profile →
                        </p>
                      )}
                    </button>
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        disabled={state === 'pending'}
                        onClick={() => handleInboundResponse(req, 'offered')}
                        className="flex-1 bg-g text-white rounded-pill py-2 text-meta font-extrabold cg-cta disabled:opacity-60"
                      >
                        {state === 'pending' ? 'Sending…' : 'Accept'}
                      </button>
                      {/* CERGIO-GUARD (2026-06-03): inline Counter input
                          replaces window.prompt per Tarik. Click Counter
                          → row expands with a $ input + Send / × controls.
                          No popup. */}
                      <button
                        type="button"
                        disabled={state === 'pending'}
                        onClick={() => {
                          if (!req.my_service_id) {
                            showToast('You need a listed service to respond.');
                            return;
                          }
                          setCounterOpenFor(prev => prev === req.id ? null : req.id);
                          setCounterDraft('');
                        }}
                        className="bg-white border border-bdr rounded-pill px-3 py-2 text-meta font-extrabold text-b2 cg-cta-ghost disabled:opacity-60"
                      >
                        Counter
                      </button>
                      <button
                        type="button"
                        disabled={state === 'pending'}
                        onClick={() => handleInboundResponse(req, 'declined')}
                        className="bg-white border border-bdr rounded-pill px-3 py-2 text-meta font-extrabold text-b3 cg-cta-ghost disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                    {counterOpenFor === req.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-body-sm font-extrabold text-b3">$</span>
                        <input
                          autoFocus
                          inputMode="decimal"
                          value={counterDraft}
                          onChange={e => setCounterDraft(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Escape') { setCounterOpenFor(null); return; }
                            if (e.key !== 'Enter') return;
                            const dollars = parseFloat(counterDraft);
                            if (!Number.isFinite(dollars) || dollars < 0) {
                              showToast('Enter a non-negative number.');
                              return;
                            }
                            setResponding(prev => ({ ...prev, [req.id]: 'pending' }));
                            const { error } = await respondToRequest(req.id, {
                              status: 'countered',
                              serviceId: req.my_service_id,
                              offeredPriceCents: Math.round(dollars * 100),
                              message: null,
                              waveN: null,
                            });
                            if (error) {
                              showToast('Could not send counter — try again.');
                              setResponding(prev => ({ ...prev, [req.id]: undefined }));
                              return;
                            }
                            setResponding(prev => ({ ...prev, [req.id]: 'done' }));
                            setInbound(prev => (prev || []).filter(r => r.id !== req.id));
                            setCounterOpenFor(null);
                            showToast('Counter sent ✓');
                          }}
                          placeholder="75"
                          className="flex-1 border-b border-g/40 bg-transparent outline-none
                                     text-body font-extrabold text-black py-1"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const dollars = parseFloat(counterDraft);
                            if (!Number.isFinite(dollars) || dollars < 0) {
                              showToast('Enter a non-negative number.');
                              return;
                            }
                            setResponding(prev => ({ ...prev, [req.id]: 'pending' }));
                            const { error } = await respondToRequest(req.id, {
                              status: 'countered',
                              serviceId: req.my_service_id,
                              offeredPriceCents: Math.round(dollars * 100),
                              message: null,
                              waveN: null,
                            });
                            if (error) {
                              showToast('Could not send counter — try again.');
                              setResponding(prev => ({ ...prev, [req.id]: undefined }));
                              return;
                            }
                            setResponding(prev => ({ ...prev, [req.id]: 'done' }));
                            setInbound(prev => (prev || []).filter(r => r.id !== req.id));
                            setCounterOpenFor(null);
                            showToast('Counter sent ✓');
                          }}
                          className="bg-g text-white rounded-pill px-3 py-1.5 text-meta font-extrabold cg-cta"
                        >
                          Send
                        </button>
                        <button
                          type="button"
                          onClick={() => setCounterOpenFor(null)}
                          className="text-body font-extrabold text-b3 bg-transparent border-none cursor-pointer px-1"
                          aria-label="Cancel counter"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {requests.length > 0 && (
              <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-3">
                Bookings
              </p>
            )}
          </>
        )}

        {/* CERGIO-GUARD (2026-06-12): the generic "No requests yet"
            card was rendering UNDER live "requests near you" cards
            (Tarik's screenshot) because it only checked bookings.
            Now it only shows when the tab is truly empty. */}
        {activeTab === 'Requests' && requests.length === 0
          && (!inbound || inbound.length === 0)
          && openQuestions.length === 0
          && myAnswered.length === 0 && (
          lastResponded ? (
            /* Confirmation card — shown after provider responds to a request */
            <div className="bg-white border border-g/30 rounded-[20px] p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-gl flex items-center justify-center mx-auto mb-3">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-body-lg font-extrabold text-black mb-1">
                {lastResponded.status === 'offered'   ? 'Offer sent!'       :
                 lastResponded.status === 'declined'  ? 'Request declined'  :
                 lastResponded.status === 'countered' ? 'Counter sent!'     :
                 'Response sent!'}
              </p>
              <p className="text-body-sm text-b3 font-medium leading-snug mb-4">
                {lastResponded.status === 'offered'
                  ? `Your offer was sent to ${lastResponded.sender}. You'll be notified when they confirm.`
                  : lastResponded.status === 'countered'
                  ? `Your counter was sent to ${lastResponded.sender}. You'll be notified when they respond.`
                  : lastResponded.status === 'declined'
                  ? `You've passed on ${lastResponded.sender}'s request.`
                  : `Your response was sent to ${lastResponded.sender}.`}
              </p>
              <button
                onClick={() => { setLastResponded(null); navigate('/home'); }}
                className="bg-g text-white rounded-[24px] py-3 px-6 text-body font-extrabold"
              >
                Back to home
              </button>
            </div>
          ) : (
            /* Generic empty state — no prior action this session */
            <div className="bg-white border border-bdr rounded-[20px] p-8 text-center">
              <p className="text-body font-extrabold text-black">No requests yet</p>
              <p className="text-meta text-b3 font-medium mt-1 leading-snug">
                Booking requests from Cergio users show up here. List a service to get found.
              </p>
              <button
                onClick={() => navigate('/list-service')}
                className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-body font-extrabold"
              >
                List a service →
              </button>
            </div>
          )
        )}
        {activeTab === 'Requests' && requests.filter(matchesSearch).map((req, i) => (
          <div
            key={req.id}
            onClick={() => req.real
              ? navigate(`/request/${req.id}`)
              : showToast(`Open ${req.sender}'s request — demo card, no real booking attached`)}
            className="bg-white border border-bdr rounded-[20px] p-4 flex gap-3 cursor-pointer
                       transition-shadow hover:shadow-card"
          >
            {/* unread dot column */}
            <div className="w-2 flex-shrink-0 mt-1.5">
              {req.isUnread && <div className="w-2 h-2 rounded-full bg-g" />}
            </div>

            <Avatar name={req.sender} idx={i} />

            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-body-lg font-extrabold text-black truncate">{req.sender}</span>
                <span className="text-meta text-b3 font-medium flex-shrink-0 ml-2">{req.date}</span>
              </div>

              <p className={`text-body-sm font-extrabold leading-snug mb-1 truncate
                              ${req.isFreeForRainmakers ? 'text-gd' : 'text-black'}`}>
                {req.preview}
              </p>
              {req.note && (
                <p className="text-meta text-b3 font-medium leading-snug mb-2 line-clamp-2">
                  "{req.note}"
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-meta text-b3 font-medium">{req.appointmentTime}</span>
                {req.isFreeForRainmakers && (
                  <span className="inline-flex items-center gap-1 bg-gl text-gd
                                   text-meta-sm font-extrabold px-2 py-0.5 rounded-pill">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
                    </svg>
                    Free for Connectors
                  </span>
                )}
              </div>

              {req.needsResponse && (
                <div className="mt-3 inline-flex items-center gap-1.5 bg-g text-white
                                text-meta-sm font-extrabold px-2.5 py-1 rounded-pill">
                  <span className="w-3.5 h-3.5 rounded-full bg-white text-g
                                   flex items-center justify-center text-[9px] font-extrabold">
                    !
                  </span>
                  Needs Response
                </div>
              )}
            </div>
          </div>
        ))}

        {/* SENT tab — outgoing spotlight requests this provider sent to
            Connectors. Each row tappable, routes to the full Connector
            inbox where they can manage / counter / pay. */}
        {activeTab === 'Sent' && sent !== null && sent.length === 0 && (
          <div className="bg-white border border-bdr rounded-[20px] p-6 text-center">
            <p className="text-body font-extrabold text-black">No spotlight requests sent yet</p>
            <p className="text-meta text-b3 font-medium mt-1 leading-snug">
              Ask a Connector to spotlight your service on Instagram or TikTok.
            </p>
            <button
              onClick={() => navigate('/connectors/browse')}
              className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-body-sm font-extrabold"
            >
              Browse Connectors →
            </button>
          </div>
        )}
        {activeTab === 'Sent' && (sent || [])
          .filter(s => {
            if (!searchQ.trim()) return true;
            const q = searchQ.toLowerCase();
            const platform = s.platform === 'tiktok' ? 'TikTok' : 'Instagram';
            const status = s.status || '';
            const created = s.created_at ? new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
            return [platform, status, created].some(v => String(v).toLowerCase().includes(q));
          })
          .map(s => {
          const platform = s.platform === 'tiktok' ? 'TikTok' : 'Instagram';
          const price = s.accepted_price_cents || s.offered_price_cents || s.official_price_cents || 0;
          const created = s.created_at ? new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          return (
            <button
              key={s.id}
              onClick={() => navigate('/connectors/requests')}
              className="bg-white border border-bdr rounded-[20px] p-4 flex items-center gap-3 text-left
                         hover:border-g/40 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-gl flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#3D8B00">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-body font-extrabold text-black leading-tight truncate">
                  {platform} spotlight request
                </p>
                <p className="text-meta text-b3 mt-0.5 leading-snug">
                  {created} · {s.status}
                  {price ? ` · $${(price / 100).toFixed(0)}` : ''}
                </p>
              </div>
              <span className="text-b3 text-base">›</span>
            </button>
          );
        })}

        {/* CERGIO-GUARD (2026-06-12): Upcoming / Past — the barter loop
            surface. Consumer (Connector) cards carry "Mark IG post
            done"; provider cards carry "Accept post / Something's
            wrong". Completed barters land in Past. */}
        {(activeTab === 'Upcoming' || activeTab === 'Past') && (() => {
          if (myJobs === null) {
            return <p className="text-body text-b3 font-medium px-1 py-6">Loading…</p>;
          }
          const pick = activeTab === 'Upcoming' ? isLiveJob : isPastJob;
          // CERGIO-GUARD (2026-06-12): the consumer's own PENDING
          // requests show in Upcoming as "Awaiting confirm" — Tarik:
          // "waiting on responses when user clicks to request a
          // booking". (Provider-side pending lives in the Requests tab
          // as Needs Response — not duplicated here.)
          const pickConsumer = activeTab === 'Upcoming'
            ? (b) => isLiveJob(b) || b.status === 'pending'
            : isPastJob;
          const consumerJobs = myJobs.asConsumer.filter(pickConsumer);
          const providerJobs = myJobs.asProvider.filter(pick);
          if (consumerJobs.length === 0 && providerJobs.length === 0) {
            return (
              <div className="bg-white border border-bdr rounded-[20px] p-8 text-center">
                <p className="text-body text-b3 font-medium">
                  No {activeTab.toLowerCase()} jobs yet.
                </p>
              </div>
            );
          }
          const fmtWhen = (iso) => iso
            ? `${new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
            : '—';
          const Pill = ({ free, status, postConfirmed, paymentDue }) => (
            <span className={`rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold whitespace-nowrap
              ${postConfirmed ? 'bg-gl text-gd'
                : paymentDue ? 'bg-warnBg text-warnText'
                : status === 'pending' ? 'bg-warnBg text-warnText'
                : status === 'cancelled' ? 'bg-bg5 text-b3'
                : free ? 'bg-gl text-gd' : 'bg-bg5 text-b2'}`}>
              {postConfirmed ? 'Barter complete ✓'
                : paymentDue ? 'Payment due'
                : status === 'pending' ? 'Awaiting confirm'
                : status === 'cancelled' ? 'Cancelled'
                : free ? 'Free barter' : status === 'completed' ? 'Completed' : 'Booked'}
            </span>
          );
          return (
            <>
              {consumerJobs.length > 0 && (
                <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-1">
                  Booked by you
                </p>
              )}
              {consumerJobs.map((b, i) => {
                const otherName = b.provider?.display_name || 'Provider';
                // Post CTA only once the provider has ACCEPTED — a pending
                // request has no barter obligation yet.
                const needsPost   = b.is_free_for_rainmaker && !b.posted_at && !b.post_confirmed_at &&
                                    ['confirmed', 'in_progress', 'completed'].includes(b.status);
                const awaitingOk  = b.is_free_for_rainmaker && b.posted_at && !b.post_confirmed_at && !b.post_flag_reason;
                const flagged     = b.is_free_for_rainmaker && !!b.post_flag_reason && !b.post_confirmed_at;
                // CERGIO-GUARD (2026-06-12): pay-after-accept. Provider
                // confirmed the time → consumer must pay before the booking
                // is locked in. Only surfaces for paid (non-free) bookings
                // that haven't been paid yet.
                const paymentDue  = !b.is_free_for_rainmaker && b.status === 'confirmed' && !b.paid_at;
                const totalDollars = b.total_cents ? `$${(b.total_cents / 100).toFixed(0)}` : null;
                return (
                  <div key={b.id} className="bg-white border border-bdr rounded-[20px] p-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={otherName} idx={i} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-2">
                          <p className="text-body font-extrabold text-black truncate">
                            {b.service?.title || 'Service'}
                          </p>
                          <Pill free={b.is_free_for_rainmaker} status={b.status} postConfirmed={!!b.post_confirmed_at} paymentDue={paymentDue} />
                        </div>
                        <p className="text-meta text-b3 font-medium mt-0.5">
                          {otherName} · {fmtWhen(b.scheduled_at)}
                        </p>
                      </div>
                    </div>
                    {needsPost && (
                      <>
                        <p className="text-meta text-b2 font-medium leading-snug mt-3">
                          After the job, post your IG spotlight and confirm it here —
                          that completes the barter and unlocks your next free service.
                        </p>
                        <button
                          onClick={() => setPostTarget(b)}
                          className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold mt-2 hover:opacity-90 active:scale-[.98] transition-all"
                        >
                          Mark IG post done
                        </button>
                      </>
                    )}
                    {awaitingOk && (
                      <div className="bg-warnBg border border-warn/40 text-warnText rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-3">
                        Posted · awaiting {otherName.split(' ')[0]}'s approval
                        {b.post_url && (
                          <a href={b.post_url} target="_blank" rel="noopener noreferrer" className="block underline underline-offset-2 mt-0.5">
                            View your post →
                          </a>
                        )}
                      </div>
                    )}
                    {flagged && (
                      <>
                        <div className="bg-warnBg border border-warn/40 rounded-[12px] px-3 py-2 mt-3">
                          <p className="text-meta-sm font-extrabold text-warnText">
                            {otherName.split(' ')[0]} flagged your post: &ldquo;{b.post_flag_reason}&rdquo;
                          </p>
                        </div>
                        <button
                          onClick={() => setPostTarget(b)}
                          className="w-full bg-white border-2 border-black text-black rounded-[14px] py-2.5 text-body-sm font-extrabold mt-2 hover:bg-bg5/40"
                        >
                          Update post
                        </button>
                      </>
                    )}
                    {/* CERGIO-GUARD (2026-06-12): pay-after-accept CTA.
                        Provider confirmed the time — consumer pays here to
                        lock in the booking. `payForBooking` (from App.jsx
                        outlet context) creates the PaymentIntent and opens
                        the PaymentSheet in-place. */}
                    {paymentDue && (
                      <>
                        <p className="text-meta text-b2 font-medium leading-snug mt-3">
                          {otherName.split(' ')[0]} confirmed your time — pay to lock it in.
                        </p>
                        <button
                          onClick={() => payForBooking(b, { onPaid: refreshJobs })}
                          className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold mt-2 hover:opacity-90 active:scale-[.98] transition-all"
                        >
                          Pay{totalDollars ? ` ${totalDollars}` : ''} to lock it in →
                        </button>
                      </>
                    )}
                    {b.post_confirmed_at && b.post_url && (
                      <a href={b.post_url} target="_blank" rel="noopener noreferrer"
                         className="block text-center text-meta font-extrabold text-g underline underline-offset-2 mt-2">
                        View the post →
                      </a>
                    )}
                  </div>
                );
              })}

              {providerJobs.length > 0 && (
                <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-3">
                  Jobs for you
                </p>
              )}
              {providerJobs.map((b, i) => {
                const otherName = b.consumer?.display_name || 'Cergio user';
                const reviewNeeded = b.is_free_for_rainmaker && b.posted_at && !b.post_confirmed_at;
                const awaitingPost = b.is_free_for_rainmaker && !b.posted_at && !b.post_confirmed_at && b.status !== 'cancelled';
                return (
                  <div key={b.id} className="bg-white border border-bdr rounded-[20px] p-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={otherName} idx={i + 2} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-2">
                          <p className="text-body font-extrabold text-black truncate">
                            {b.service?.title || 'Service'}
                          </p>
                          <Pill free={b.is_free_for_rainmaker} status={b.status} postConfirmed={!!b.post_confirmed_at} />
                        </div>
                        <p className="text-meta text-b3 font-medium mt-0.5">
                          {otherName} · {fmtWhen(b.scheduled_at)}
                        </p>
                      </div>
                    </div>
                    {awaitingPost && (
                      <p className="text-meta text-b3 font-medium leading-snug mt-3">
                        {otherName.split(' ')[0]} posts an IG spotlight after the job —
                        you'll review and accept it here.
                      </p>
                    )}
                    {reviewNeeded && (
                      <>
                        {b.post_url && (
                          <a href={b.post_url} target="_blank" rel="noopener noreferrer"
                             className="block text-center text-meta font-extrabold text-g underline underline-offset-2 mt-3">
                            View their post →
                          </a>
                        )}
                        {b.post_flag_reason && (
                          <p className="text-meta-sm text-warnText font-extrabold text-center mt-1">
                            You flagged: &ldquo;{b.post_flag_reason}&rdquo; — awaiting their update
                          </p>
                        )}
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => { setFlagOpenFor(prev => prev === b.id ? null : b.id); setFlagDraft(''); }}
                            disabled={jobBusy[b.id]}
                            className="flex-1 bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40 disabled:opacity-60"
                          >
                            Something's wrong
                          </button>
                          <button
                            onClick={() => handleConfirmPost(b)}
                            disabled={jobBusy[b.id]}
                            className="flex-1 bg-g text-white rounded-[14px] py-2.5 text-body-sm font-extrabold hover:opacity-90 disabled:opacity-60"
                          >
                            {jobBusy[b.id] ? 'Working…' : 'Accept post'}
                          </button>
                        </div>
                        {flagOpenFor === b.id && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              autoFocus
                              value={flagDraft}
                              onChange={e => setFlagDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleFlagPost(b); if (e.key === 'Escape') setFlagOpenFor(null); }}
                              placeholder="What needs fixing? (e.g. tag @cergio, wrong link)"
                              className="flex-1 border-b border-g/40 bg-transparent outline-none text-body-sm font-medium text-black py-1"
                            />
                            <button
                              onClick={() => handleFlagPost(b)}
                              disabled={jobBusy[b.id]}
                              className="bg-black text-white rounded-pill px-3 py-1.5 text-meta font-extrabold disabled:opacity-60"
                            >
                              Send
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {b.post_confirmed_at && b.post_url && (
                      <a href={b.post_url} target="_blank" rel="noopener noreferrer"
                         className="block text-center text-meta font-extrabold text-g underline underline-offset-2 mt-2">
                        View the post →
                      </a>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>

      {postTarget && (
        <MarkBookingPostedModal
          booking={postTarget}
          onClose={() => setPostTarget(null)}
          onPosted={() => { showToast('Posted ✓ — provider notified to confirm'); refreshJobs(); }}
        />
      )}
    </div>
  );
}
