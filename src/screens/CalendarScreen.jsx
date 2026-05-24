// Per design-spec.md — provider Calendar: date strip + hourly day view.
// Fetches real bookings when signed in; falls back to mock data otherwise.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { CALENDAR_DAYS, CALENDAR_BOOKINGS } from '../data/mock';
import { listProviderBookings } from '../lib/api';

const STATUS = {
  available:    { dot: 'bg-g',         label: 'Available',           copy: 'Bookings on this date will automatically be accepted' },
  request_only: { dot: 'bg-warn',      label: 'Request only',        copy: 'Customers can only send you requests — you accept or decline.' },
  unavailable:  { dot: 'bg-[#E05A3A]', label: "I'm not available",   copy: "Customers will not be able to book or request you at this time." },
};

const HOURS  = Array.from({ length: 24 }, (_, i) => i);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatHour(h) {
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function ymd(d) {
  // local-date key like 2026-05-15
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build the rolling 9-day window starting today.
function buildDateWindow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i < 9; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push({
      id:    ymd(d),
      date:  d,
      day:   d.getDate(),
      month: MONTHS[d.getMonth()],
      status: 'available',
      bookings: 0,
    });
  }
  return out;
}

export function CalendarScreen() {
  const navigate = useNavigate();
  const { auth } = useOutletContext();

  // Days strip — real dates anchored on today.
  const [days, setDays] = useState(buildDateWindow);
  const [activeDay, setActiveDay] = useState(days[0].id);
  const [allBookings, setAllBookings] = useState(null); // null = loading

  useEffect(() => {
    if (!auth?.isSignedIn) { setAllBookings([]); return; }
    let cancelled = false;
    listProviderBookings().then(({ data }) => {
      if (cancelled) return;
      setAllBookings(data || []);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  // Bucket bookings by yyyy-mm-dd; tally each day's count.
  const bucketed = useMemo(() => {
    const m = {};
    (allBookings || []).forEach(b => {
      if (!b.scheduled_at) return;
      const d = new Date(b.scheduled_at);
      const key = ymd(d);
      if (!m[key]) m[key] = [];
      m[key].push(b);
    });
    return m;
  }, [allBookings]);

  // Merge counts into days strip.
  const enrichedDays = useMemo(
    () => days.map(d => ({ ...d, bookings: (bucketed[d.id] || []).length })),
    [days, bucketed]
  );

  const day      = enrichedDays.find(d => d.id === activeDay) || enrichedDays[0];
  const status   = STATUS[day.status];
  const todays   = bucketed[day.id] || [];

  // Only use mock blocks for signed-out demo viewers. Signed-in users with
  // zero bookings get a real empty state below.
  const usingMock = !auth?.isSignedIn;
  const blocks    = usingMock
    ? CALENDAR_BOOKINGS
    : todays.map(b => {
        const dt   = new Date(b.scheduled_at);
        const hour = dt.getHours();
        // Prefer the offering's session length; fall back to 60 min for hourly bookings.
        const mins = b.offering?.duration_minutes || 60;
        const dur  = Math.max(1, Math.round(mins / 60));
        return {
          hour,
          duration: dur,
          color:    b.status === 'completed' ? 'gd' : 'g',
          title:    `${b.service?.title || 'Service'} — ${b.consumer?.display_name || 'Customer'}`,
          id:       b.id,
        };
      });

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* header */}
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <h1 className="text-[28px] font-extrabold text-black tracking-tight">Calendar</h1>
        <button
          onClick={() => navigate('/calendar/availability', { state: { dateIso: day.date.toISOString() } })}
          className="w-10 h-10 rounded-full bg-white border border-bdr flex items-center justify-center text-black"
          aria-label="Calendar settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      {/* date strip */}
      <div className="flex overflow-x-auto px-5 pb-4 gap-0 scrollbar-hide border-b border-bdr">
        {enrichedDays.map(d => {
          const active = d.id === activeDay;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDay(d.id)}
              className={`flex-shrink-0 flex flex-col items-center justify-center w-[68px] py-3 relative
                          border-l border-bdr first:border-l-0
                          ${active ? 'bg-g rounded-[14px]' : 'bg-transparent'}`}
            >
              <span className={`text-[12px] ${active ? 'text-white/85 font-medium' : 'text-b3 font-medium'}`}>{d.month}</span>
              <span className={`text-[20px] font-extrabold ${active ? 'text-white' : 'text-black'}`}>{d.day}</span>
              {d.bookings > 0 && (
                <span className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full
                                  ${active ? 'bg-white' : 'bg-g'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* status row */}
      <button
        onClick={() => navigate('/calendar/availability', { state: { dateIso: day.date.toISOString() } })}
        className="flex items-center justify-between gap-3 px-5 py-4 border-b border-bdr text-left"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[16px] font-extrabold text-black">{status.label}</p>
            <span className={`w-2.5 h-2.5 rounded-full ${status.dot}`} />
          </div>
          <p className="text-[13px] text-b3 mt-0.5 leading-relaxed">{status.copy}</p>
        </div>
        <span className="text-b3 text-lg">›</span>
      </button>

      {/* empty state when this day has nothing */}
      {!usingMock && blocks.length === 0 && (
        <div className="px-5 py-10 text-center">
          <p className="text-[14px] text-b3 leading-relaxed">
            No bookings on this day.<br />
            Tap another date in the strip above.
          </p>
        </div>
      )}

      {/* hourly timeline */}
      <div className="flex flex-col">
        {HOURS.map(h => {
          const booking = blocks.find(b => b.hour === h);
          return (
            <div key={h} className="relative flex items-start gap-3 px-5 pt-3 min-h-[60px]">
              <span className="text-[12px] text-b3 font-medium w-12 flex-shrink-0 pt-0.5">{formatHour(h)}</span>
              <div className="flex-1 border-t border-bdr relative">
                {booking && (
                  <button
                    onClick={() => booking.id && navigate(`/request/${booking.id}`)}
                    className={`absolute left-0 right-0 top-1 rounded-[12px] p-3 text-white shadow-card text-left
                                ${booking.color === 'g' ? 'bg-g' : 'bg-gd'}`}
                    style={{ height: `${booking.duration * 60 - 8}px` }}
                  >
                    <p className="text-[13px] font-extrabold leading-tight">{booking.title}</p>
                    <p className="text-[11px] text-white/85 mt-0.5">
                      {formatHour(booking.hour)} – {formatHour(booking.hour + booking.duration)}
                    </p>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
