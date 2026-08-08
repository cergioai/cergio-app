// Booked-job detail. CERGIO-GUARD (2026-06-14): rebuilt on the REAL booking
// (getBooking) — no more mock Jennifer/David/Broadway (SPEC-12).
//
// FW-24 (Tarik 2026-08-08): this screen is now ROLE-AWARE. It used to render
// only the provider's framing ("Your earnings", the CONSUMER's name as the
// client, "Mark service complete"), so the requester had nowhere to land after
// their time was confirmed — tapping through showed the SERVICE PROFILE
// instead of their job. Founder verbatim: "when clicking to BOOK, he should
// see the booked time and summary of the job (location time, request)... with
// ability to reschedule... need to simplify the back and forth". Both sides now
// get the same job summary, each seeing the other party, and either side can
// reschedule from here (rescheduleBooking notifies the other side).
import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { getBooking, rescheduleBooking } from '../lib/api';

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}
function formatWhen(iso) {
  if (!iso) return 'Time TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Time TBD';
  return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
// datetime-local wants local wall-clock, not the ISO Z string.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function JobDetailsScreen() {
  const navigate = useNavigate();
  const routerLoc = useLocation();
  const { showToast, auth } = useOutletContext();
  const bookingId = routerLoc.state?.bookingId;
  // FW-24: bookings carry no request_id column (SPEC-247), so the caller hands
  // us the originating request text/location when it has it. Falls back to the
  // booking's own notes/location, then the service's.
  const seedRequest  = routerLoc.state?.requestText || '';
  const seedLocation = routerLoc.state?.requestLocation || '';
  const me = auth?.user?.id || null;

  const [job, setJob]   = useState(null); // null = loading · false = none
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!bookingId) { setJob(false); return () => {}; }
    let cancelled = false;
    getBooking(bookingId).then(({ data: b, error }) => {
      if (cancelled) return;
      if (error || !b) { setJob(false); return; }
      const isFree      = b.is_free_for_rainmaker;
      const priceCents  = b.offering?.price_cents ?? b.total_cents ?? 0;
      // Role: whoever is NOT me is "the other party". Default to the provider
      // framing when we can't tell (signed-out deep link), which is the
      // pre-FW-24 behaviour.
      const isConsumer  = !!me && b.consumer?.id === me;
      const other       = isConsumer ? b.provider : b.consumer;
      setJob({
        id:         b.id,
        isConsumer,
        status:     b.status,
        jobType:    b.service?.title || 'Job',
        otherName:  other?.display_name || 'Cergio user',
        otherId:    other?.id || null,
        category:   b.service?.taxonomy_provider_type || b.service?.category || '',
        isFree,
        priceLabel: isConsumer
          ? (isFree
              ? 'Free · you post an IG spotlight'
              : (priceCents > 0 ? `$${Math.round(priceCents / 100)}${b.paid_at ? ' · paid' : ' · pay after they confirm'}` : 'No charge'))
          : (isFree ? 'Instagram marketing' : (priceCents > 0 ? `$${Math.round(priceCents / 100)} · via Stripe` : 'Paid via Stripe')),
        scheduledAt: b.scheduled_at || null,
        when:        formatWhen(b.scheduled_at),
        confirmed:   !!b.schedule_confirmed_at,
        location:    b.location_text || seedLocation || b.service?.location_text || null,
        details:     (seedRequest || b.notes || b.service?.description || '').trim(),
      });
    });
    return () => { cancelled = true; };
  }, [bookingId, me, seedRequest, seedLocation]);

  useEffect(() => load(), [load]);

  const saveNewTime = async () => {
    if (!when) { showToast('Pick a new time.'); return; }
    setBusy(true);
    const { error } = await rescheduleBooking(job.id, when);
    setBusy(false);
    if (error) { showToast(error.message || 'Could not reschedule.'); return; }
    setOpen(false);
    showToast('Time updated — the other side is notified.');
    load();
  };

  if (job === null) {
    return <div className="flex-1 flex items-center justify-center bg-cr"><p className="text-body text-b3">Loading job…</p></div>;
  }
  if (job === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cr px-8 text-center">
        <p className="text-body font-extrabold text-black">No job selected.</p>
        <button onClick={() => navigate('/inbox')} className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-body-sm font-extrabold">Back to Inbox</button>
      </div>
    );
  }

  const rows = [
    job.isConsumer
      ? { label: 'Price', sub: job.priceLabel }
      : { label: 'Your earnings', sub: job.priceLabel, action: 'Benefits', to: '/benefits' },
    { label: 'When', sub: job.when },
    { label: 'Job location', sub: job.location || 'Shared after confirmation' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      {/* map placeholder (decorative) */}
      <div className="relative h-[220px] bg-soft overflow-hidden">
        <svg width="100%" height="220" viewBox="0 0 390 220" preserveAspectRatio="xMidYMid slice">
          <rect width="390" height="220" fill="#F4F4F2" />
          {[50, 100, 150, 195].map(y => <line key={y} x1="0" y1={y} x2="390" y2={y} stroke="#FFFFFF" strokeWidth="6" />)}
          {[70, 160, 250, 330].map(x => <line key={x} x1={x} y1="0" x2={x} y2="220" stroke="#FFFFFF" strokeWidth="6" />)}
          <circle cx="195" cy="120" r="40" fill="#E8F5E0" opacity="0.9" />
          <circle cx="195" cy="120" r="40" fill="none" stroke="#4AA901" strokeWidth="2.5" />
          <circle cx="195" cy="120" r="6" fill="#4AA901" />
        </svg>
        <button onClick={() => navigate(-1)} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white border border-bdr flex items-center justify-center text-b2">✕</button>
        <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 bg-g rounded-pill px-3 py-1.5">
          <span className="w-4 h-4 rounded-full bg-white text-g flex items-center justify-center text-caps font-extrabold">{job.isFree ? '✓' : '$'}</span>
          <span className="text-body-sm font-extrabold text-white">Booked{job.isFree ? ' · free' : ''}</span>
        </div>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[24px] -mt-4 px-5 pt-4 pb-6">
        <div className="w-9 h-1 bg-bdr rounded-full mx-auto mb-4" />
        <h1 className="text-heading-1 font-extrabold text-black">{job.jobType}</h1>
        {/* FW-24: the agreed time leads — this is the answer to "what did I
            book?", so it must not be buried three rows down. */}
        <p className="text-body-sm font-extrabold text-g mt-1 mb-4">
          {job.confirmed ? 'Time confirmed' : 'Time proposed'} · {job.when}
        </p>

        {/* other-party row */}
        <div className="flex items-center justify-between py-4 border-b border-bdr">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-g to-gd flex items-center justify-center text-white font-extrabold text-body">
              {getInitials(job.otherName)}
            </div>
            <div>
              <p className="text-body-lg font-extrabold text-black">{job.otherName}</p>
              <p className="text-meta text-g font-extrabold">
                {job.isConsumer ? (job.category || 'Your provider') : (job.category || 'Client')}
              </p>
            </div>
          </div>
          <button onClick={() => navigate(`/messages/${job.id}`)} className="text-body font-extrabold text-g">Message</button>
        </div>

        {/* info rows */}
        {rows.map((row, i) => (
          <div key={i} className="flex justify-between items-start py-4 border-b border-bdr">
            <div className="flex-1 pr-3">
              <p className="text-body-lg font-extrabold text-black mb-1">{row.label}</p>
              <p className="text-body-sm text-b3">{row.sub}</p>
            </div>
            {row.to && (
              <button onClick={() => navigate(row.to)} className="text-body font-extrabold text-g whitespace-nowrap pt-1">{row.action}</button>
            )}
          </div>
        ))}

        {/* request details */}
        {job.details && (
          <div className="pt-5">
            <p className="text-body-lg font-extrabold text-black mb-2">Request details</p>
            <p className="text-body-sm text-black leading-relaxed">{job.details}</p>
          </div>
        )}

        {/* FW-24: reschedule lives ON the job, for EITHER side — "need to
            simplify the back and forth". No re-booking, no second job row. */}
        <div className="pt-6">
          {open ? (
            <div>
              <input
                type="datetime-local"
                value={when}
                onChange={e => setWhen(e.target.value)}
                className="w-full border border-bdr rounded-[12px] px-3 py-3 text-body-sm text-black bg-white outline-none focus:border-g"
              />
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={saveNewTime}
                  className="flex-1 bg-g text-white rounded-[24px] py-3.5 text-body-lg font-extrabold disabled:opacity-60"
                >
                  Save new time
                </button>
                <button type="button" onClick={() => setOpen(false)} className="text-body-sm text-b3 font-extrabold px-4">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setWhen(toLocalInput(job.scheduledAt)); setOpen(true); }}
              className="w-full bg-white border border-bdr text-black rounded-[24px] py-3.5 text-body-lg font-extrabold active:scale-[.97] transition-all"
            >
              Reschedule
            </button>
          )}
        </div>

        {/* The provider owns "done" — the consumer rates afterwards. */}
        {!job.isConsumer && (
          <div className="pt-3">
            <button onClick={() => navigate('/rate', { state: { bookingId: job.id } })}
              className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
              Mark service complete
            </button>
          </div>
        )}
        {job.isConsumer && (
          <div className="pt-3">
            <button onClick={() => navigate('/inbox')}
              className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
              Back to Inbox
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
