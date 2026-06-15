import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  listProviderBookings,
  listConsumerBookings,
  listMyOutboundSpotlightRequests,
  listInboundRequests,
  listMyRequestsWithResponses,
  listMyRequestQuestions,
  listMySentOffers,
  replyRequestQuestion,
  respondToRequest,
  confirmBookingPost,
  flagBookingPost,
  markBookingComplete,
} from '../lib/api';
import { stampInboxSeen } from '../hooks/useInboxUnread';
import { usePartyCounts, formatKeyCounts } from '../hooks/usePartyCounts';
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
    consumerId:          b.consumer?.id || null,
    serviceTitle:        svcTitle,
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

// Overview digest row — folder title + count + a couple of preview lines + View all.
function OverviewRow({ title, count, items = [], onView }) {
  return (
    <div className="bg-white border border-bdr rounded-[18px] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-lg font-extrabold text-black">
          {title}{count > 0 && <span className="text-g"> · {count}</span>}
        </p>
        <button onClick={onView} className="text-body-sm font-extrabold text-g whitespace-nowrap flex-shrink-0">
          View all →
        </button>
      </div>
      {count === 0 ? (
        <p className="text-meta text-b3 mt-1">Nothing here yet.</p>
      ) : items.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {items.map((it, i) => (
            <p key={i} className="text-meta text-b2 truncate">• {it}</p>
          ))}
          {count > items.length && (
            <p className="text-meta-sm text-b3">+{count - items.length} more</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

const TABS = ['Overview', 'Requests', 'Sent', 'Upcoming', 'Past'];

export function JobsInboxScreen() {
  const navigate = useNavigate();
  const { showToast, auth, payForBooking, handleBook } = useOutletContext();
  const [activeTab, setActiveTab] = useState('Overview');
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

  // My offers awaiting the requester to schedule (two-step barter, SPEC-47).
  const [sentOffers, setSentOffers] = useState([]);
  useEffect(() => {
    if (!auth?.isSignedIn) { setSentOffers([]); return; }
    let cancelled = false;
    const fetchOnce = () => listMySentOffers().then(({ data }) => { if (!cancelled) setSentOffers(data || []); });
    fetchOnce();
    const t = setInterval(fetchOnce, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [auth?.isSignedIn]);

  // Key counts about each card's other party — the connector-request requester
  // AND the booking consumer — mutual · network · reco's · reach. One call for
  // the whole inbox so every card (booking or free request) reads the same map.
  const requesterCounts = usePartyCounts([
    ...(inbound || []).map(r => r.requester?.id),
    ...(real || []).map(r => r.consumerId),
  ]);

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
  const [sent, setSent] = useState(null);     // outgoing spotlight asks (eager, for counts)
  const [postTarget, setPostTarget] = useState(null);     // booking → MarkBookingPostedModal
  const [flagOpenFor, setFlagOpenFor] = useState(null);   // booking id with flag input open
  const [flagDraft, setFlagDraft] = useState('');
  const [jobBusy, setJobBusy] = useState({});             // { [bookingId]: true }
  const refreshJobs = async () => {
    const [c, p] = await Promise.all([listConsumerBookings(), listProviderBookings()]);
    setMyJobs({ asConsumer: c.data || [], asProvider: p.data || [] });
  };
  useEffect(() => {
    // Eager (was Upcoming/Past-only) so the Overview + folder counts have
    // upcoming/past totals without switching tabs.
    if (!auth?.isSignedIn) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([listConsumerBookings(), listProviderBookings()]);
      if (cancelled) return;
      setMyJobs({ asConsumer: c.data || [], asProvider: p.data || [] });
    })();
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

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

  // Per-folder counts for the tab labels + the Overview digest.
  const upcomingCount = myJobs
    ? myJobs.asConsumer.filter(b => isLiveJob(b) || b.status === 'pending').length
      + myJobs.asProvider.filter(isLiveJob).length
    : 0;
  const pastCount = myJobs
    ? myJobs.asConsumer.filter(isPastJob).length + myJobs.asProvider.filter(isPastJob).length
    : 0;
  const newRequestsCount = (inbound || []).length;
  const awaitingCount = sentOffers.length;
  const sentCount = (sent || []).length;
  // Action-needed surfacing (Tarik 2026-06-15): the IG-post nudge (me as the
  // Connector, once the provider marked complete) and the spotlight review
  // (me as the provider, once the Connector posted).
  const needPostCount = myJobs
    ? myJobs.asConsumer.filter(b => b.is_free_for_rainmaker && b.completed_at && !b.posted_at && !b.post_confirmed_at).length
    : 0;
  const reviewSpotlightCount = myJobs
    ? myJobs.asProvider.filter(b => b.is_free_for_rainmaker && b.posted_at && !b.post_confirmed_at).length
    : 0;
  const tabCounts = {
    Overview: 0,
    Requests: badgeCount,
    Sent: sentCount,
    Upcoming: upcomingCount,
    Past: pastCount,
  };

  const handleConfirmPost = async (b) => {
    setJobBusy(prev => ({ ...prev, [b.id]: true }));
    const { error } = await confirmBookingPost(b.id);
    setJobBusy(prev => ({ ...prev, [b.id]: false }));
    if (error) { showToast(`Failed: ${error.message}`); return; }
    showToast('Post accepted ✓ — barter complete');
    refreshJobs();
  };
  const handleMarkComplete = async (b) => {
    setJobBusy(prev => ({ ...prev, [b.id]: true }));
    const { error } = await markBookingComplete(b.id);
    setJobBusy(prev => ({ ...prev, [b.id]: false }));
    if (error) { showToast(`Failed: ${error.message}`); return; }
    showToast(b.is_free_for_rainmaker ? 'Marked complete — they\'ll be asked to post their IG spotlight.' : 'Marked complete.');
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

  // Sent — provider's outgoing spotlight asks (eager so the Sent folder count
  // shows on the Overview). State is declared higher up so tabCounts can read it.
  useEffect(() => {
    if (!auth?.isSignedIn || sent !== null) return;
    listMyOutboundSpotlightRequests({ limit: 50 }).then(({ data }) => {
      setSent(data || []);
    });
  }, [auth?.isSignedIn, sent]);

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

      {/* tabs — horizontally scrollable; every folder shows its count */}
      <div className="flex items-center gap-5 px-5 border-b border-bdr overflow-x-auto">
        {TABS.map(tab => {
          const active = tab === activeTab;
          const count = tabCounts[tab] || 0;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative pb-3 flex items-center gap-1.5 cursor-pointer flex-shrink-0"
            >
              <span className={`text-body ${active ? 'font-extrabold text-black' : 'font-medium text-b3'}`}>
                {tab}
              </span>
              {count > 0 && (
                <div className={`text-caps font-extrabold rounded-full min-w-[18px] h-[18px]
                                 flex items-center justify-center px-1.5
                                 ${active ? 'bg-g text-white' : 'bg-bg5 text-b2'}`}>
                  {count}
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

        {/* OVERVIEW — at-a-glance digest of every folder with counts + View all
            (Tarik 2026-06-15). The default landing tab. */}
        {activeTab === 'Overview' && (
          <>
            {needPostCount > 0 && (
              <div className="bg-gl border-2 border-g/40 rounded-[18px] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-body-lg font-extrabold text-gd">
                    Post your IG spotlight<span className="text-g"> · {needPostCount}</span>
                  </p>
                  <button onClick={() => setActiveTab('Upcoming')} className="text-body-sm font-extrabold text-g whitespace-nowrap flex-shrink-0">
                    Do it now →
                  </button>
                </div>
                <p className="text-meta text-b2 mt-1 leading-snug">
                  A provider marked your job complete. Post to finish the barter + unlock new free services.
                </p>
              </div>
            )}
            {reviewSpotlightCount > 0 && (
              <div className="bg-gl border-2 border-g/40 rounded-[18px] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-body-lg font-extrabold text-gd">
                    Spotlights to review<span className="text-g"> · {reviewSpotlightCount}</span>
                  </p>
                  <button onClick={() => setActiveTab('Upcoming')} className="text-body-sm font-extrabold text-g whitespace-nowrap flex-shrink-0">
                    Review →
                  </button>
                </div>
                <p className="text-meta text-b2 mt-1 leading-snug">
                  A Connector posted your IG spotlight — review and accept it.
                </p>
              </div>
            )}
            {myAnswered.length > 0 && (
              <OverviewRow
                title="Offers to book"
                count={myAnswered.reduce((n, r) => n + (r.responses || []).length, 0)}
                items={myAnswered
                  .flatMap(r => (r.responses || []).map(resp => `${resp.responder?.display_name || 'A provider'} · ${resp.service?.title || r.service_type || 'service'}`))
                  .slice(0, 2)}
                onView={() => setActiveTab('Requests')}
              />
            )}
            <OverviewRow
              title="New requests"
              count={newRequestsCount}
              items={(inbound || []).slice(0, 2).map(r => `${r.requester?.display_name || 'A user'} · ${r.service_type || 'service'}`)}
              onView={() => setActiveTab('Requests')}
            />
            <OverviewRow
              title="Awaiting their schedule"
              count={awaitingCount}
              items={sentOffers.slice(0, 2).map(o => `${o.requesterName} · ${o.serviceType}`)}
              onView={() => setActiveTab('Requests')}
            />
            <OverviewRow
              title="Upcoming jobs"
              count={upcomingCount}
              items={myJobs
                ? [...myJobs.asConsumer.filter(b => isLiveJob(b) || b.status === 'pending'),
                   ...myJobs.asProvider.filter(isLiveJob)]
                    .slice(0, 2)
                    .map(b => `${b.service?.title || 'Service'}`)
                : []}
              onView={() => setActiveTab('Upcoming')}
            />
            {sentCount > 0 && (
              <OverviewRow title="Spotlight requests sent" count={sentCount} onView={() => setActiveTab('Sent')} />
            )}
            {pastCount > 0 && (
              <OverviewRow title="Past" count={pastCount} onView={() => setActiveTab('Past')} />
            )}
          </>
        )}

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
                    const canBook = !!(resp.service?.id && resp.responder?.id) && handleBook;
                    return (
                      <div key={resp.id} className="bg-gl rounded-[14px] px-3 py-2.5">
                        <button
                          type="button"
                          disabled={!target}
                          onClick={() => target && navigate(`/u/${target}`)}
                          className="w-full flex items-center gap-3 text-left
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
                        {/* Book a time — turns the offer into a scheduled booking,
                            which kicks off the barter (service → IG post → confirm).
                            Tarik 2026-06-15: closes the end-to-end loop. */}
                        {canBook && (
                          <button
                            type="button"
                            onClick={() => handleBook({
                              id:           resp.service.id,
                              ownerId:      resp.responder.id,
                              name,
                              title:        resp.service.title,
                              offeringId:   null,
                              price:        (price || 0) / 100,
                              priceCents:   price || 0,
                              isFree:       !price,
                              // Provider already offered → confirm on schedule
                              // so it lands in both Upcoming immediately.
                              preConfirmed: true,
                            })}
                            className="w-full mt-2 bg-g text-white rounded-[12px] py-2 text-meta font-extrabold cg-cta active:scale-[.98] transition-all"
                          >
                            {price ? `Book a time · $${(price / 100).toFixed(0)}` : 'Book a free time →'}
                          </button>
                        )}
                      </div>
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
                      {/* Same template as the spotlight InboundCard, but the
                          SERVICE seeing a Connector's request leads with REACH
                          (Tarik 2026-06-15): name + status, then IG · network ·
                          reco's made, then the ask line + their message. */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          <span className="text-body-lg font-extrabold text-black truncate">
                            {senderName}
                          </span>
                          {/* RULE (Tarik 2026-06-15): a service viewing a Connector
                              LEADS with the Connector badge. */}
                          {requesterCounts[req.requester?.id]?.isConnector && (
                            <span className="inline-flex items-center gap-0.5 bg-gl text-gd text-[10px] font-extrabold px-1.5 py-0.5 rounded-pill shrink-0">
                              Connector
                            </span>
                          )}
                        </div>
                        <span className="bg-bg5 text-b2 rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold whitespace-nowrap flex-shrink-0">
                          New
                        </span>
                      </div>
                      {formatKeyCounts(requesterCounts[req.requester?.id], { recoKind: 'made' }) && (
                        <p className="text-meta-sm text-b2 font-medium">
                          {formatKeyCounts(requesterCounts[req.requester?.id], { recoKind: 'made' })}
                        </p>
                      )}
                      <p className="text-meta-sm text-b3 mt-0.5">
                        Free service request · {minutesAgo === 0 ? 'just now' : `${minutesAgo}m ago`}
                      </p>
                      {/* Ask line — mirror of the spotlight side's offer line. */}
                      <p className="text-body-sm text-black leading-snug mt-2">
                        <strong>{senderName.split(' ')[0]}</strong> is looking for a <strong>free {req.service_type}</strong> — they'll spotlight you in return.
                      </p>
                      {req.description && (
                        <p className="text-meta text-b2 italic leading-snug mt-2 line-clamp-3">
                          &ldquo;{req.description}&rdquo;
                        </p>
                      )}
                      {req.location_text && (
                        <p className="text-meta text-b3 font-medium leading-snug mt-1">
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

        {/* AWAITING SCHEDULE — offers I've sent that are waiting on the
            requester to pick a time (two-step barter, SPEC-47). Tarik
            2026-06-15: so an accepted request isn't "lost" before it becomes
            a scheduled Upcoming job. */}
        {activeTab === 'Requests' && sentOffers.length > 0 && (
          <>
            <p className="text-meta font-extrabold text-b3 uppercase tracking-wide pt-1">
              Awaiting their schedule
            </p>
            {sentOffers.map(o => (
              <div key={o.id} className="bg-white border border-bdr rounded-[20px] p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-body-sm font-extrabold text-black leading-snug">
                    You offered <span className="text-gd">{o.serviceType}</span> to {o.requesterName}
                  </p>
                  <span className="bg-bg5 text-b2 rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold whitespace-nowrap flex-shrink-0">
                    {o.status === 'countered' ? 'Countered' : 'Offer sent'}
                  </span>
                </div>
                <p className="text-meta text-b3 leading-snug mt-1">
                  Waiting on {o.requesterName.split(' ')[0]} to pick a time — it moves to Upcoming once they book.
                </p>
              </div>
            ))}
          </>
        )}

        {/* CERGIO-GUARD (2026-06-12): the generic "No requests yet"
            card was rendering UNDER live "requests near you" cards
            (Tarik's screenshot) because it only checked bookings.
            Now it only shows when the tab is truly empty. */}
        {activeTab === 'Requests' && requests.length === 0
          && (!inbound || inbound.length === 0)
          && openQuestions.length === 0
          && sentOffers.length === 0
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
            <Avatar name={req.sender} idx={i} />

            {/* Same template as the spotlight / "New requests near you" cards
                (Tarik 2026-06-15): name + status, reach-led counts, type · date,
                the ask line, then their message. Drives /inbox off the old format. */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className="text-body-lg font-extrabold text-black truncate">{req.sender}</span>
                  {/* RULE (Tarik 2026-06-15): lead with the Connector badge. */}
                  {requesterCounts[req.consumerId]?.isConnector && (
                    <span className="inline-flex items-center gap-0.5 bg-gl text-gd text-[10px] font-extrabold px-1.5 py-0.5 rounded-pill shrink-0">
                      Connector
                    </span>
                  )}
                </div>
                {req.needsResponse && (
                  <span className="bg-bg5 text-b2 rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold whitespace-nowrap flex-shrink-0">
                    Needs response
                  </span>
                )}
              </div>

              {formatKeyCounts(requesterCounts[req.consumerId], { recoKind: 'made' }) && (
                <p className="text-meta-sm text-b2 font-medium">
                  {formatKeyCounts(requesterCounts[req.consumerId], { recoKind: 'made' })}
                </p>
              )}

              <p className="text-meta-sm text-b3 mt-0.5">
                {req.isFreeForRainmakers ? 'Free service request' : 'Booking request'} · {req.date}
              </p>

              <p className="text-body-sm text-black leading-snug mt-2">
                {req.isFreeForRainmakers ? (
                  <><strong>{req.sender.split(' ')[0]}</strong> is looking for a <strong>free {req.serviceTitle}</strong> — they'll spotlight you in return.</>
                ) : (
                  <><strong>{req.sender.split(' ')[0]}</strong> wants to book your <strong>{req.serviceTitle}</strong>.</>
                )}
              </p>

              {req.note && (
                <p className="text-meta text-b2 italic leading-snug mt-2 line-clamp-3">
                  &ldquo;{req.note}&rdquo;
                </p>
              )}

              <p className="text-meta text-b3 font-medium leading-snug mt-1">{req.appointmentTime}</p>
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
                        {b.completed_at ? (
                          <div className="bg-gl border border-g/30 rounded-[12px] px-3 py-2.5 mt-3">
                            <p className="text-body-sm font-extrabold text-gd leading-snug">
                              {otherName.split(' ')[0]} marked the job complete — post your IG spotlight now.
                            </p>
                            <p className="text-meta text-b2 leading-snug mt-0.5">
                              It finishes the barter and unlocks your next free service.
                            </p>
                          </div>
                        ) : (
                          <p className="text-meta text-b2 font-medium leading-snug mt-3">
                            After the job, post your IG spotlight and confirm it here —
                            that completes the barter and unlocks your next free service.
                          </p>
                        )}
                        <button
                          onClick={() => setPostTarget(b)}
                          className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold mt-2 hover:opacity-90 active:scale-[.98] transition-all"
                        >
                          {b.completed_at ? 'Post your IG spotlight →' : 'Mark IG post done'}
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
                // Provider can mark the job complete anytime (even before start)
                // until it's done — Tarik 2026-06-15.
                const canMarkComplete = !b.completed_at && !b.post_confirmed_at && b.status !== 'cancelled';
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
                    {/* Mark job complete — available anytime until done. */}
                    {canMarkComplete && (
                      <>
                        <p className="text-meta text-b3 font-medium leading-snug mt-3">
                          {b.is_free_for_rainmaker
                            ? `${otherName.split(' ')[0]} posts an IG spotlight after the job — mark it complete to nudge them.`
                            : `Mark the job complete when it's done — payment releases automatically after.`}
                        </p>
                        <button
                          onClick={() => handleMarkComplete(b)}
                          disabled={jobBusy[b.id]}
                          className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold mt-2 hover:opacity-90 active:scale-[.98] transition-all disabled:opacity-60"
                        >
                          {jobBusy[b.id] ? 'Working…' : 'Mark job complete'}
                        </button>
                      </>
                    )}
                    {/* Marked complete, awaiting the Connector's IG post. */}
                    {b.completed_at && awaitingPost && (
                      <div className="bg-warnBg border border-warn/40 text-warnText rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-3">
                        Marked complete · {otherName.split(' ')[0]} will post their IG spotlight; you'll review it here.
                      </div>
                    )}
                    {/* Paid: marked complete → auto-release window. */}
                    {b.completed_at && !b.is_free_for_rainmaker && !b.post_confirmed_at && (
                      <div className="bg-gl text-gd rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-3">
                        Marked complete · funds release automatically within 3h unless challenged.
                      </div>
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
          onPosted={(res) => {
            showToast(res?.heldForLowRating
              ? 'Review sent to the provider — your post is on hold until the rating is resolved.'
              : 'Posted ✓ — provider notified to confirm');
            refreshJobs();
          }}
        />
      )}
    </div>
  );
}
