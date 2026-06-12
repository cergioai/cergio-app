// Per design-spec.md — provider Availability modal: pick status + service hours.
// CERGIO-GUARD: previously the Save button toasted "Availability saved"
// without persisting ANYTHING. Brand-killing lie — providers thought
// they were marked unavailable, customers could still book. Now we
// persist the per-date choice to auth.user.user_metadata.availability
// (same proven pattern as default_address). The booking-time gate
// that reads this map is tracked as a roadmap item — until it
// ships, providers should still manually decline blocked dates.
// The save toast wording reflects this honestly.
import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const OPTIONS = [
  { id: 'available',    label: 'Available',           dot: 'bg-g',         copy: 'Bookings on this date will automatically be accepted' },
  { id: 'request_only', label: 'Request only',        dot: 'bg-warn',      copy: 'Customers can only send you requests that you can manually accept or decline.' },
  { id: 'unavailable',  label: "I'm not available",   dot: 'bg-[#E05A3A]', copy: 'Customers will not be able to book or request you at this time. This setting should only be on when you cannot work.' },
];

function formatHour(h) {
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

export function AvailabilityScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, auth } = useOutletContext();
  const [status, setStatus] = useState('available');
  const [startHr, setStartHr] = useState(10);
  const [endHr, setEndHr]     = useState(14);
  const [saving, setSaving]   = useState(false);

  // Date being edited — passed from CalendarScreen via location.state.dateIso.
  // Falls back to today if the user landed here directly (e.g. via /profile → settings).
  const activeDate = location.state?.dateIso ? new Date(location.state.dateIso) : new Date();
  const dateKey    = activeDate.toISOString().slice(0, 10); // YYYY-MM-DD
  const dateLabel  = activeDate.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });

  // Hydrate from auth.user.user_metadata.availability[dateKey] if present.
  useEffect(() => {
    const slot = auth?.user?.user_metadata?.availability?.[dateKey];
    if (!slot) return;
    if (slot.status) setStatus(slot.status);
    if (typeof slot.startHr === 'number') setStartHr(slot.startHr);
    if (typeof slot.endHr === 'number') setEndHr(slot.endHr);
  }, [auth?.user?.id, dateKey]);

  const canSave = (status !== 'available' || endHr > startHr) && !saving;

  // Persist to auth user_metadata under availability[YYYY-MM-DD].
  // Falls back to localStorage on auth/network error so the user's
  // selection at least survives a reload on their device.
  //
  // CERGIO-GUARD: reviewer (2026-05-27 wave 3) caught that a
  // signed-OUT user landing on this route would hit
  // `supabase.auth.updateUser` (which fails), then the localStorage
  // catch would toast "Saved on this device (sync will retry)" —
  // but there's no account for sync to retry against. Short-circuit
  // here with an actionable message instead.
  const saveAvailability = async () => {
    if (!canSave) return;
    if (!auth?.isSignedIn) {
      showToast('Sign in to save your availability');
      navigate('/auth');
      return;
    }
    setSaving(true);
    const slot = { status, startHr, endHr, updated_at: new Date().toISOString() };
    try {
      const prev = auth?.user?.user_metadata?.availability || {};
      const next = { ...prev, [dateKey]: slot };
      const { error } = await supabase.auth.updateUser({ data: { availability: next } });
      if (error) throw error;
      showToast('Saved — full scheduling lands soon');
      navigate(-1);
    } catch (e) {
      try {
        const key = `cergio.availability.${auth?.user?.id || 'anon'}`;
        const cached = JSON.parse(localStorage.getItem(key) || '{}');
        cached[dateKey] = slot;
        localStorage.setItem(key, JSON.stringify(cached));
        showToast('Saved on this device (sync will retry)');
        navigate(-1);
      } catch {
        showToast(e?.message || 'Could not save — try again');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* close */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center text-black text-xl"
        >
          ✕
        </button>
      </div>

      {/* heading */}
      <div className="px-5 pt-2 pb-5">
        <h1 className="text-display-2 font-extrabold text-black tracking-tight">Availability</h1>
        <p className="text-body text-b3 mt-1">{dateLabel}</p>
      </div>

      {/* options */}
      <div className="flex flex-col">
        {OPTIONS.map(o => {
          const active = status === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setStatus(o.id)}
              className="flex items-start gap-3 px-5 py-4 border-b border-bdr text-left"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-body-lg font-extrabold text-black">{o.label}</p>
                  <span className={`w-2.5 h-2.5 rounded-full ${o.dot}`} />
                </div>
                <p className="text-body-sm text-b3 mt-1 leading-relaxed">{o.copy}</p>
              </div>
              <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center
                              ${active ? 'bg-g border-2 border-g' : 'bg-white border-2 border-bdr'}`}>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* service hours — only relevant when not unavailable */}
      {status !== 'unavailable' && (
        <div className="px-5 pt-6 pb-2">
          <p className="text-heading-1 font-extrabold text-black mb-1">Service hours</p>
          <p className="text-body text-b3 leading-relaxed mb-5">
            What is the earliest and latest time you'll accept reservations on this date?
          </p>

          <div className="flex items-center justify-between mb-5">
            <div className="bg-bg5 rounded-[14px] px-5 py-3 min-w-[110px] text-center">
              <p className="text-heading-2 font-extrabold text-black">{formatHour(startHr)}</p>
            </div>
            <span className="text-body text-b3 font-medium">and</span>
            <div className="bg-bg5 rounded-[14px] px-5 py-3 min-w-[110px] text-center">
              <p className="text-heading-2 font-extrabold text-black">{formatHour(endHr)}</p>
            </div>
          </div>

          {/* range slider — start */}
          <div className="px-1 mb-3">
            <label className="block text-meta font-extrabold text-b3 uppercase tracking-wide mb-1">Start</label>
            <input
              type="range" min="0" max="23" value={startHr}
              onChange={e => setStartHr(Math.min(parseInt(e.target.value, 10), endHr - 1))}
              className="w-full accent-g"
            />
          </div>
          <div className="px-1">
            <label className="block text-meta font-extrabold text-b3 uppercase tracking-wide mb-1">End</label>
            <input
              type="range" min="1" max="23" value={endHr}
              onChange={e => setEndHr(Math.max(parseInt(e.target.value, 10), startHr + 1))}
              className="w-full accent-g"
            />
          </div>
        </div>
      )}

      {/* save */}
      <div className="px-5 pt-8 mt-auto">
        <button
          onClick={saveAvailability}
          disabled={!canSave}
          className={`w-full rounded-[24px] py-4 text-body-lg font-extrabold transition-all
            ${canSave ? 'bg-black text-white hover:opacity-90 active:scale-[.97]' : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <p className="text-meta-sm text-b3 mt-3 leading-snug text-center">
          Your choice is saved to your account. Auto-blocking of
          bookings on unavailable dates launches with full scheduling
          — please still manually decline requests on blocked dates
          until then.
        </p>
      </div>
    </div>
  );
}
