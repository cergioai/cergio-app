// Per design-spec.md — provider sees an inbound request/booking.
// When a UUID is in the URL, fetch the real booking; otherwise show the
// legacy mock pitch for demo purposes.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { getBooking, updateBookingStatus } from '../lib/api';
import { useProviderReady } from '../hooks/useProviderReady';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FALLBACK = {
  consumerName: 'Reyna',
  serviceType:  'Housekeeper request',
  description:  'Apartment Clean — 1 BD / 2 BA (+ extras)',
  appointment:  'Tue, Feb 27 — 10:00 AM',
  message:      "Hi, my name is Gervon. I'm eager to try out your service and blast it on socials. Looking forward to the house clean. Should be light :)",
  sentDate:     'Feb 13',
  isFree:       true,
  status:       'pending',
  real:         false,
};

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function GradientAvatar({ name }) {
  return (
    <div
      className="rounded-full bg-gradient-to-br from-[#b06090] to-[#703050]
                 flex items-center justify-center text-white font-extrabold flex-shrink-0
                 w-11 h-11 text-[14px]"
    >
      {getInitials(name)}
    </div>
  );
}

function formatAppointment(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function RequestDetailScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast, auth } = useOutletContext();
  const [data, setData] = useState(null);   // null = loading
  const [busy, setBusy] = useState(false);
  // Provider must have Stripe payouts enabled before they can accept a paid
  // booking (per Phase B decision: "block accept until payouts_enabled").
  const provider = useProviderReady(auth);

  useEffect(() => {
    let cancelled = false;
    if (!UUID_RE.test(id || '')) {
      setData(FALLBACK);
      return;
    }
    getBooking(id).then(({ data: b, error }) => {
      if (cancelled) return;
      if (error || !b) { setData(FALLBACK); return; }
      setData({
        id:            b.id,
        consumerName:  b.consumer?.display_name || 'Cergio user',
        serviceType:   b.service?.title || 'Service request',
        description:   b.service?.description || b.notes || '',
        appointment:   formatAppointment(b.scheduled_at),
        message:       b.notes || b.service?.description || 'Tap to view full request.',
        sentDate:      b.created_at ? new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
        isFree:        b.is_free_for_rainmaker,
        status:        b.status,
        real:          true,
      });
    });
    return () => { cancelled = true; };
  }, [id]);

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cr">
        <p className="text-[14px] text-b3">Loading request…</p>
      </div>
    );
  }

  const handleAccept = async () => {
    if (!data.real) {
      showToast('Accepted (demo)');
      navigate('/job');
      return;
    }
    // CERGIO-GUARD (2026-05-30): the Stripe-ready check used to BLOCK
    // acceptance for paid bookings. Tarik: "disable the payment setup
    // condition... we can enable this regardless and then services are
    // notified to set up to receive payment". New policy: always allow
    // acceptance; remind the provider afterward (via toast + the
    // non-blocking banner above the CTA) to finish payouts setup so
    // funds actually land.
    setBusy(true);
    const { error } = await updateBookingStatus(data.id, 'confirmed');
    setBusy(false);
    if (error) { showToast(`Failed: ${error.message}`); return; }
    if (!data.isFree && !provider.ready) {
      // Sticky so the provider sees the payouts-setup reminder long
      // enough to act on it.
      showToast('Accepted! Finish Stripe payouts setup to get paid.', { sticky: true });
    } else {
      showToast('Accepted!');
    }
    navigate('/job', { state: { bookingId: data.id } });
  };

  const handleDecline = async () => {
    if (!data.real) {
      showToast('Declined (demo)');
      navigate(-1);
      return;
    }
    setBusy(true);
    const { error } = await updateBookingStatus(data.id, 'cancelled');
    setBusy(false);
    if (error) { showToast(`Failed: ${error.message}`); return; }
    showToast('Declined');
    navigate(-1);
  };

  const alreadyResolved = data.status && data.status !== 'pending';
  const statusLabel = {
    confirmed:  'Confirmed',
    completed:  'Completed',
    cancelled:  'Declined',
    in_progress:'In progress',
  }[data.status];

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      {/* nav */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-card border border-bdr
                     flex items-center justify-center text-b2 text-base"
        >
          ←
        </button>
        <span className="text-[15px] font-extrabold text-black">{data.consumerName}</span>
        {data.real ? (
          <button
            onClick={() => navigate(`/messages/${data.id}`)}
            className="w-9 h-9 rounded-full bg-card border border-bdr
                       flex items-center justify-center text-b2"
            aria-label="Message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        ) : <div className="w-9" />}
      </div>

      {/* status pill */}
      <div className="px-5 pb-3">
        {alreadyResolved ? (
          <div className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-1 rounded-pill
            ${data.status === 'cancelled' ? 'bg-bg5 text-b2' : 'bg-gl text-gd'}`}>
            <span className={`w-2 h-2 rounded-full ${data.status === 'cancelled' ? 'bg-b3' : 'bg-g'}`} />
            {statusLabel}
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 bg-g text-white
                          text-[11px] font-extrabold px-2.5 py-1 rounded-pill">
            <span className="w-3.5 h-3.5 rounded-full bg-white text-g
                             flex items-center justify-center text-[9px] font-extrabold">!</span>
            Needs Response
          </div>
        )}
      </div>

      {/* Purpose banner — Phase 6 (2026-06-01): tell the provider what
          THIS booking actually represents, so the Accept CTA reads as
          a meaningful exchange instead of a generic calendar event.
          Two cases:
            • is_free_for_rainmaker = true  → Connector is asking for a
              free slot in exchange for spotlighting the service on
              their socials (free service ↔ free social reach).
            • is_free_for_rainmaker = false → paid booking; just a
              consumer asking to book the listed service.
          Banner sits above the service info so the user reads
          "what is this?" before "when / where". */}
      <div className="px-5 pb-3">
        {data.isFree ? (
          <div className="bg-gl/60 border border-g/30 rounded-[14px] p-3.5">
            <p className="text-[13px] font-extrabold text-gd leading-snug">
              Free spotlight exchange
            </p>
            <p className="text-[12px] text-b2 mt-1 leading-snug">
              <span className="font-extrabold text-black">{data.consumerName}</span> is asking for
              a free slot of <span className="font-extrabold text-black">{data.serviceType || 'your service'}</span>.
              In exchange, they'll spotlight it to their social audience —
              no cash changes hands.
            </p>
          </div>
        ) : (
          <div className="bg-cr2 border border-bdr rounded-[14px] p-3.5">
            <p className="text-[13px] font-extrabold text-black leading-snug">
              Paid booking request
            </p>
            <p className="text-[12px] text-b2 mt-1 leading-snug">
              <span className="font-extrabold text-black">{data.consumerName}</span> wants to book
              <span className="font-extrabold text-black"> {data.serviceType || 'your service'}</span>.
              You'll be paid out after the job (via Stripe).
            </p>
          </div>
        )}
      </div>

      {/* service info */}
      <div className="px-5 pb-4">
        <h2 className="text-[22px] font-extrabold text-black leading-tight mb-2">
          {data.serviceType}
        </h2>
        {data.isFree && (
          <div className="inline-flex items-center gap-1 bg-gl text-gd
                          text-[11px] font-bold px-2 py-0.5 rounded-pill mb-3">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
            </svg>
            Free for Connectors
          </div>
        )}
        {data.description && <p className="text-[15px] text-black mb-1">{data.description}</p>}
        <p className="text-[14px] text-b3">{data.appointment}</p>
      </div>

      {/* message bubble */}
      <div className="mx-5 mb-3 bg-soft rounded-[18px] p-4">
        <div className="flex items-start gap-3 mb-2">
          <GradientAvatar name={data.consumerName} />
          <p className="text-[14px] font-extrabold text-black flex-1">{data.consumerName}</p>
        </div>
        <p className="text-[14px] text-black leading-relaxed mb-2">{data.message}</p>
        <p className="text-[11px] text-b3">Sent — {data.sentDate}</p>
      </div>

      {/* actions */}
      {!alreadyResolved && (
        <>
          {/* CERGIO-GUARD (2026-05-30): non-blocking Stripe reminder.
              Used to disable Accept; now informs only. Provider can
              accept + finish Stripe setup afterward to get paid out. */}
          {data.real && !data.isFree && !provider.loading && !provider.ready && (
            <div className="mx-5 mt-3 mb-1 bg-warnBg border border-warn/40 rounded-[14px] p-3">
              <p className="text-[13px] font-extrabold text-warnText mb-0.5">
                {provider.hasAccount ? 'Payouts not yet enabled' : 'Stripe payouts not set up yet'}
              </p>
              <p className="text-[12px] text-warnText leading-relaxed">
                You can accept now — finish Stripe payouts setup in
                <span className="font-extrabold"> Profile → Service view </span>
                so funds reach your bank.
              </p>
            </div>
          )}
          <div className="px-5 pt-4 pb-2 mt-auto text-center">
            <p className="text-[15px] font-extrabold text-black">
              {data.isFree
                ? `Accept to confirm this free spotlight slot`
                : `Accept to confirm this booking`}
            </p>
            <p className="text-[13px] text-b3 mb-4">
              {data.isFree
                ? 'It will appear on your calendar — they post the spotlight in return.'
                : 'It will appear on your calendar.'}
            </p>
          </div>
          <div className="px-5 pb-3 flex flex-col gap-2">
            <button
              onClick={handleAccept}
              disabled={busy}
              className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                         hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Working…' : 'Accept'}
            </button>
            <button
              onClick={handleDecline}
              disabled={busy}
              className="w-full text-center text-[14px] font-extrabold text-g py-2 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </>
      )}
    </div>
  );
}
