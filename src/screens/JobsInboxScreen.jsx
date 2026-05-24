import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { INBOX_REQUESTS } from '../data/mock';
import { listProviderBookings } from '../lib/api';

// Map a Supabase bookings row → the same shape the existing UI uses.
function bookingToRequest(b) {
  const dt   = b.scheduled_at ? new Date(b.scheduled_at) : null;
  const date = dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const appt = dt
    ? `${dt.toLocaleDateString('en-US', { weekday: 'short' })}, ${date} — ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : '—';
  return {
    id:                  b.id,
    sender:              b.consumer?.display_name || 'Cergio user',
    preview:             b.notes || b.service?.title || 'New booking request',
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

const TABS = ['Requests', 'Upcoming', 'Past'];
const FILTERS = ['Filter (All)', 'Status'];

export function JobsInboxScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
  const [activeTab, setActiveTab] = useState('Requests');
  const [real, setReal] = useState(null);

  useEffect(() => {
    if (!auth?.isSignedIn) { setReal([]); return; }
    let cancelled = false;
    listProviderBookings().then(({ data }) => {
      if (cancelled) return;
      setReal((data || []).map(bookingToRequest));
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  // Real bookings first; pad with mock so the demo always has visual content.
  const requests   = real === null
    ? INBOX_REQUESTS
    : (real.length > 0 ? real : INBOX_REQUESTS);
  const badgeCount = requests.filter(r => r.isUnread).length;

  return (
    <div className="flex-1 overflow-y-auto pb-24 bg-cr">

      {/* header — title + search */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <h1 className="text-[28px] font-extrabold text-black tracking-tight leading-none flex-shrink-0">
          Jobs
        </h1>
        <button
          onClick={() => showToast('Search coming soon')}
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

      {/* filters */}
      <div className="flex gap-2 px-5 py-3.5">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => showToast(`${f} — filters coming soon`)}
            className="border border-bdr rounded-pill px-3.5 py-1.5
                       text-[13px] font-semibold text-b2 bg-white
                       hover:border-g hover:text-gd transition-colors"
          >
            {f}
          </button>
        ))}
      </div>

      {/* request list */}
      <div className="px-5 flex flex-col gap-3">
        {activeTab === 'Requests' && requests.map((req, i) => (
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

              <p className="text-[13px] text-b3 font-medium leading-snug mb-2 truncate">
                {req.preview}
              </p>

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

        {/* empty states for Upcoming / Past */}
        {activeTab !== 'Requests' && (
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
