import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { listProviderBookings, listMyOutboundSpotlightRequests } from '../lib/api';

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
                  text-white text-[14px] font-extrabold flex-shrink-0
                  ${AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length]}`}
    >
      {getInitials(name)}
    </div>
  );
}

const TABS = ['Requests', 'Sent', 'Upcoming', 'Past'];

export function JobsInboxScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
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

  // Real bookings only — empty state when there are none. No more mock pad.
  const requests   = real ?? [];
  const badgeCount = requests.filter(r => r.isUnread).length;

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
        <h1 className="text-[28px] font-extrabold text-black tracking-tight leading-none flex-shrink-0">
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
              className="flex-1 bg-transparent outline-none text-[13px] text-black placeholder-b3 py-1"
            />
            <button
              type="button"
              onClick={() => { setSearchOpen(false); setSearchQ(''); }}
              aria-label="Close search"
              className="text-[14px] text-b3 font-bold px-1"
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
            <span className="text-[13px] text-b3 font-medium">Search jobs and requests</span>
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
              <span className={`text-[14px] ${active ? 'font-extrabold text-black' : 'font-medium text-b3'}`}>
                {tab}
              </span>
              {active && tab === 'Requests' && badgeCount > 0 && (
                <div className="bg-g text-white text-[10px] font-extrabold rounded-full
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
        {activeTab === 'Requests' && requests.length === 0 && (
          <div className="bg-white border border-bdr rounded-[20px] p-8 text-center">
            <p className="text-[14px] font-extrabold text-black">No requests yet</p>
            <p className="text-[12px] text-b3 font-medium mt-1 leading-snug">
              Booking requests from Cergio users show up here. List a service to get found.
            </p>
            <button
              onClick={() => navigate('/list-service')}
              className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-[14px] font-extrabold"
            >
              List a service →
            </button>
          </div>
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
                <span className="text-[15px] font-extrabold text-black truncate">{req.sender}</span>
                <span className="text-[12px] text-b3 font-medium flex-shrink-0 ml-2">{req.date}</span>
              </div>

              <p className={`text-[13px] font-extrabold leading-snug mb-1 truncate
                              ${req.isFreeForRainmakers ? 'text-gd' : 'text-black'}`}>
                {req.preview}
              </p>
              {req.note && (
                <p className="text-[12px] text-b3 font-medium leading-snug mb-2 line-clamp-2">
                  "{req.note}"
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-b3 font-medium">{req.appointmentTime}</span>
                {req.isFreeForRainmakers && (
                  <span className="inline-flex items-center gap-1 bg-gl text-gd
                                   text-[11px] font-bold px-2 py-0.5 rounded-pill">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
                    </svg>
                    Free for Connectors
                  </span>
                )}
              </div>

              {req.needsResponse && (
                <div className="mt-3 inline-flex items-center gap-1.5 bg-g text-white
                                text-[11px] font-bold px-2.5 py-1 rounded-pill">
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
            <p className="text-[14px] font-extrabold text-black">No spotlight requests sent yet</p>
            <p className="text-[12px] text-b3 font-medium mt-1 leading-snug">
              Ask a Connector to spotlight your service on Instagram or TikTok.
            </p>
            <button
              onClick={() => navigate('/connectors/browse')}
              className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-[13px] font-extrabold"
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
                <p className="text-[14px] font-extrabold text-black leading-tight truncate">
                  {platform} spotlight request
                </p>
                <p className="text-[12px] text-b3 mt-0.5 leading-snug">
                  {created} · {s.status}
                  {price ? ` · $${(price / 100).toFixed(0)}` : ''}
                </p>
              </div>
              <span className="text-b3 text-base">›</span>
            </button>
          );
        })}

        {/* Empty states for Upcoming / Past */}
        {(activeTab === 'Upcoming' || activeTab === 'Past') && (
          <div className="bg-white border border-bdr rounded-[20px] p-8 text-center">
            <p className="text-[14px] text-b3 font-medium">
              No {activeTab.toLowerCase()} jobs yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
