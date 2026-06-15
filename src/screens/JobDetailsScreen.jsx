// Provider's view of a booked job. CERGIO-GUARD (2026-06-14): rebuilt on the
// REAL booking (getBooking) — no more mock Jennifer/David/Broadway (SPEC-12).
import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { getBooking } from '../lib/api';

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}
function formatWhen(iso) {
  if (!iso) return 'Time TBD';
  const d = new Date(iso);
  return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

export function JobDetailsScreen() {
  const navigate = useNavigate();
  const routerLoc = useLocation();
  const { showToast } = useOutletContext();
  const bookingId = routerLoc.state?.bookingId;
  const [job, setJob] = useState(null); // null = loading · false = none

  useEffect(() => {
    if (!bookingId) { setJob(false); return; }
    let cancelled = false;
    getBooking(bookingId).then(({ data: b, error }) => {
      if (cancelled) return;
      if (error || !b) { setJob(false); return; }
      const isFree = b.is_free_for_rainmaker;
      const priceCents = b.offering?.price_cents ?? b.total_cents ?? 0;
      setJob({
        id:          b.id,
        jobType:     b.service?.title || 'Job',
        clientName:  b.consumer?.display_name || 'Cergio user',
        category:    b.service?.taxonomy_provider_type || b.service?.category || '',
        isFree,
        earnings:    isFree ? 'Instagram marketing' : (priceCents > 0 ? `$${Math.round(priceCents / 100)} · via Stripe` : 'Paid via Stripe'),
        when:        formatWhen(b.scheduled_at),
        location:    b.service?.location_text || null,
        details:     (b.service?.description || b.notes || '').trim(),
      });
    });
    return () => { cancelled = true; };
  }, [bookingId]);

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
    { label: 'Your earnings', sub: job.earnings, action: 'Benefits', to: '/benefits' },
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
        <h1 className="text-heading-1 font-extrabold text-black mb-4">{job.jobType}</h1>

        {/* client row */}
        <div className="flex items-center justify-between py-4 border-b border-bdr">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-g to-gd flex items-center justify-center text-white font-extrabold text-body">
              {getInitials(job.clientName)}
            </div>
            <div>
              <p className="text-body-lg font-extrabold text-black">{job.clientName}</p>
              {job.category && <p className="text-meta text-g font-extrabold">{job.category}</p>}
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

        <div className="pt-6">
          <button onClick={() => navigate('/rate', { state: { bookingId: job.id } })}
            className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold hover:opacity-90 active:scale-[.97] transition-all">
            Mark service complete
          </button>
        </div>
      </div>
    </div>
  );
}
