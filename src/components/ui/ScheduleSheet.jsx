// CERGIO-GUARD (2026-06-12): schedule-confirm sheet per Tarik —
// "need a way for user to confirm time of job and day (calendar and
// done etc)". Bottom sheet with a month calendar + time slots + Done.
//
// Used in the booking flow (free AND paid) so scheduled_at is a real,
// user-chosen moment instead of the old "+24h placeholder". On a FREE
// booking the confirmed time is what later triggers the Connector's
// "post your IG spotlight" step, so this is the anchor of the barter
// loop.
//
// Props:
//   title     — heading (e.g. "When should Jamie come?")
//   onDone    — (Date) => void  fired with the chosen date+time
//   onClose   — dismiss without choosing
import { useMemo, useState } from 'react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Hourly slots 8:00 → 19:00 — broad enough for home services.
const SLOTS = Array.from({ length: 12 }, (_, i) => 8 + i);

function fmtSlot(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

function sameDay(a, b) {
  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function ScheduleSheet({ title = 'Pick a day & time', onDone, onClose }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [monthAnchor, setMonthAnchor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [day, setDay]   = useState(null);  // Date (midnight) | null
  const [hour, setHour] = useState(null);  // 8..19 | null

  // Build the visible month grid (leading blanks + days).
  const grid = useMemo(() => {
    const y = monthAnchor.getFullYear();
    const m = monthAnchor.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    return cells;
  }, [monthAnchor]);

  const monthLabel = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const canPrev = monthAnchor.getFullYear() > today.getFullYear() ||
                  monthAnchor.getMonth() > today.getMonth();

  // A slot today that's already in the past can't be picked.
  const slotDisabled = (h) => {
    if (!day) return true;
    if (!sameDay(day, today)) return false;
    return h <= new Date().getHours();
  };

  const valid = day && hour != null && !slotDisabled(hour);

  const confirm = () => {
    if (!valid) return;
    const chosen = new Date(day);
    chosen.setHours(hour, 0, 0, 0);
    onDone?.(chosen);
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-[390px] bg-white rounded-t-[24px] p-5 pb-7 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h2 className="text-[20px] font-extrabold text-black leading-tight mb-1">{title}</h2>
        <p className="text-meta text-b3 mb-4 leading-snug">
          Confirm the day and time of the job — both of you see the same schedule.
        </p>

        {/* month nav */}
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => canPrev && setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}
            disabled={!canPrev}
            aria-label="Previous month"
            className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 font-extrabold disabled:opacity-30"
          >
            ‹
          </button>
          <p className="text-body font-extrabold text-black">{monthLabel}</p>
          <button
            type="button"
            onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}
            aria-label="Next month"
            className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 font-extrabold"
          >
            ›
          </button>
        </div>

        {/* weekday header */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((w, i) => (
            <p key={i} className="text-center text-meta-sm font-extrabold text-b3">{w}</p>
          ))}
        </div>

        {/* day grid */}
        <div className="grid grid-cols-7 gap-y-1 mb-4">
          {grid.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const past   = d < today;
            const isSel  = sameDay(d, day);
            const isToday = sameDay(d, today);
            return (
              <button
                key={d.toISOString()}
                type="button"
                disabled={past}
                onClick={() => { setDay(d); setHour(null); }}
                className={`mx-auto w-9 h-9 rounded-full text-body-sm font-extrabold transition-colors
                  ${isSel ? 'bg-g text-white'
                    : past ? 'text-b3/40 cursor-not-allowed'
                    : isToday ? 'bg-gl text-gd'
                    : 'text-black hover:bg-bg5'}`}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        {/* time slots */}
        <p className="text-meta font-extrabold text-b3 uppercase tracking-wide mb-2">
          {day
            ? `Time on ${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : 'Pick a day first'}
        </p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {SLOTS.map(h => {
            const disabled = slotDisabled(h);
            const isSel = hour === h;
            return (
              <button
                key={h}
                type="button"
                disabled={disabled}
                onClick={() => setHour(h)}
                className={`rounded-[12px] py-2.5 text-body-sm font-extrabold border transition-colors
                  ${isSel ? 'bg-g text-white border-g'
                    : disabled ? 'bg-bg5/50 text-b3/40 border-transparent cursor-not-allowed'
                    : 'bg-white text-black border-bdr hover:border-g'}`}
              >
                {fmtSlot(h)}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          className={`w-full rounded-[24px] py-4 text-body-lg font-extrabold transition-all
            ${valid ? 'bg-g text-white hover:opacity-90 active:scale-[.97]' : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {valid
            ? `Done — ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${fmtSlot(hour)}`
            : 'Done'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full text-body-sm font-extrabold text-b3 py-2 mt-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
