// Per design-spec.md — provider sees an inbound request/booking.
// When a UUID is in the URL, fetch the real booking; otherwise show the
// legacy mock pitch for demo purposes.
//
// CERGIO-GUARD (2026-06-13): screen rebuilt to match the "Accepting Free
// Service request" mockup (Tarik flow board). Elements added:
//   • Approximate-location card — exact address gated until the user
//     confirms the booking (no live map tile / no fake pinpoint).
//   • Instagram block — consumer handle + follower count + "See Instagram"
//     deep link (real data via getBooking; hidden when no handle).
//   • Friends-in-common — mutual network connections with the requester
//     (getMutualConnections; hidden when zero).
//   • Free-marketing benefit subcopy + "Accept free request" CTA.
// NO IG photo grid: we don't store anyone's IG media, so the "+N more"
// thumbnail strip from the mockup is intentionally omitted rather than
// faked (SPEC-12 — no fake data on real screens).
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { getBooking, updateBookingStatus, notifyBookingAccepted, getMutualConnections, isConnectorProfile } from '../lib/api';
import { usePartyCounts, formatKeyCounts } from '../hooks/usePartyCounts';
import { useProviderReady } from '../hooks/useProviderReady';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getInitials(name = '') {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function GradientAvatar({ name }) {
  return (
    <div
      className="rounded-full bg-gradient-to-br from-[#b06090] to-[#703050]
                 flex items-center justify-center text-white font-extrabold flex-shrink-0
                 w-11 h-11 text-body"
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

// "3 friends and 1 Connector in common" — bucketed, grammatically correct.
function mutualSummaryText({ count, connectors }) {
  const friends = Math.max(0, count - connectors);
  const parts = [];
  if (friends > 0)    parts.push(`${friends} ${friends === 1 ? 'friend' : 'friends'}`);
  if (connectors > 0) parts.push(`${connectors} ${connectors === 1 ? 'Connector' : 'Connectors'}`);
  return `${parts.join(' and ')} in common`;
}

export function RequestDetailScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast, auth } = useOutletContext();
  const [data, setData] = useState(null);   // null = loading
  const [mutuals, setMutuals] = useState(null);
  const [busy, setBusy] = useState(false);
  // Provider must have Stripe payouts enabled before they can accept a paid
  // booking (per Phase B decision: "block accept until payouts_enabled").
  const provider = useProviderReady(auth);
  // Key counts about the requester (parity with /inbound & /spotlight). The
  // dedicated friends-in-common block below carries mutuals, so omit them here.
  const partyCounts = usePartyCounts(data?.consumerId ? [data.consumerId] : []);

  useEffect(() => {
    let cancelled = false;
    // QUARANTINE (2026-06-15, Tarik): the old demo FALLBACK pitch (hardcoded
    // mock requester) is unplugged — no fake data on a real screen (SPEC-12).
    // A missing/invalid booking now shows a clean not-found state (data=false).
    if (!UUID_RE.test(id || '')) { setData(false); return; }
    getBooking(id).then(({ data: b, error }) => {
      if (cancelled) return;
      if (error || !b) { setData(false); return; }
      const consumer = b.consumer || {};
      setData({
        id:            b.id,
        consumerId:    consumer.id || null,
        consumerName:  consumer.display_name || 'Cergio user',
        consumerIsConnector: !!consumer.cc_verified_at,
        igHandle:      consumer.instagram_handle || null,
        igFollowers:   consumer.instagram_followers ?? null,
        // Reserved for real IG media once Meta Graph access is approved.
        // null today → photo-grid slot stays silent (no fake thumbnails).
        igMedia:       null,
        serviceType:   b.service?.title || 'Service request',
        description:   b.service?.description || b.notes || '',
        appointment:   formatAppointment(b.scheduled_at),
        // Approximate area only — exact address is gated until confirmed.
        locationText:  b.location_text || b.service?.location_text || null,
        message:       b.notes || b.service?.description || 'Tap to view full request.',
        sentDate:      b.created_at ? new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
        isFree:        b.is_free_for_rainmaker,
        priceCents:    b.offering?.price_cents ?? b.total_cents ?? 0,
        status:        b.status,
        real:          true,
      });
      // Friends-in-common with the requester. Fire after we have the
      // consumer id; failures collapse to "no mutuals" (block hidden).
      if (consumer.id) {
        getMutualConnections(consumer.id).then(({ data: m }) => {
          if (!cancelled) setMutuals(m || { count: 0, connectors: 0, sample: [] });
        });
      } else {
        setMutuals({ count: 0, connectors: 0, sample: [] });
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  if (data === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cr">
        <p className="text-body text-b3">Loading request…</p>
      </div>
    );
  }
  if (data === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cr px-8 text-center">
        <p className="text-body font-extrabold text-black">This request is no longer available.</p>
        <button onClick={() => navigate('/inbox')} className="mt-4 bg-g text-white rounded-[24px] py-3 px-5 text-body-sm font-extrabold">Back to Inbox</button>
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
    // CERGIO-GUARD (2026-06-12): tell the consumer their booking was
    // accepted (email + in-app row). For free barters the email also
    // reminds them to post the IG spotlight after the job.
    notifyBookingAccepted(data.id);
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

  const hasMutuals = mutuals && mutuals.count > 0;

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
        <span className="text-body-lg font-extrabold text-black">{data.consumerName}</span>
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
          <div className={`inline-flex items-center gap-1.5 text-meta-sm font-extrabold px-2.5 py-1 rounded-pill
            ${data.status === 'cancelled' ? 'bg-bg5 text-b2' : 'bg-gl text-gd'}`}>
            <span className={`w-2 h-2 rounded-full ${data.status === 'cancelled' ? 'bg-b3' : 'bg-g'}`} />
            {statusLabel}
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 bg-g text-white
                          text-meta-sm font-extrabold px-2.5 py-1 rounded-pill">
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
            <p className="text-body-sm font-extrabold text-gd leading-snug">
              Free spotlight exchange
            </p>
            <p className="text-meta text-b2 mt-1 leading-snug">
              <span className="font-extrabold text-black">{data.consumerName}</span> is asking for
              a free slot of <span className="font-extrabold text-black">{data.serviceType || 'your service'}</span>.
              In exchange, they'll spotlight it to their social audience —
              no cash changes hands.
            </p>
          </div>
        ) : (
          <div className="bg-cr2 border border-bdr rounded-[14px] p-3.5">
            <p className="text-body-sm font-extrabold text-black leading-snug">
              Paid booking{data.priceCents > 0 ? ` · $${Math.round(data.priceCents / 100)}` : ''}
            </p>
            <p className="text-meta text-b2 mt-1 leading-snug">
              <span className="font-extrabold text-black">{data.consumerName}</span> wants to book
              <span className="font-extrabold text-black"> {data.serviceType || 'your service'}</span>.
              {data.priceCents > 0
                ? <> You'll earn <span className="font-extrabold text-black">${Math.round(data.priceCents / 100)}</span> after the job (via Stripe).</>
                : <> You'll be paid out after the job (via Stripe).</>}
            </p>
          </div>
        )}
      </div>

      {/* Requester signal — Connector status + key counts (network · reco's ·
          reach), parity with the /inbound frame-3 screen. SPEC-48: this screen
          carries the same elements. Mutuals live in the dedicated block below. */}
      {(() => {
        const counts = partyCounts[data.consumerId];
        const isConnector = data.consumerIsConnector || isConnectorProfile({ instagram_followers: data.igFollowers });
        const line = formatKeyCounts(counts, { recoKind: 'made', includeMutual: false });
        if (!isConnector && !line) return null;
        return (
          <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
            {isConnector && (
              <span className="inline-flex items-center gap-1 bg-gl text-gd rounded-pill px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                Connector
              </span>
            )}
            {line && <span className="text-meta-sm text-b2 font-medium">{line}</span>}
          </div>
        );
      })()}

      {/* service info / job details */}
      <div className="px-5 pb-4">
        <h2 className="text-heading-1 font-extrabold text-black leading-tight mb-2">
          {data.serviceType}
        </h2>
        {data.isFree && (
          <div className="inline-flex items-center gap-1 bg-gl text-gd
                          text-meta-sm font-extrabold px-2 py-0.5 rounded-pill mb-3">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" />
            </svg>
            Free for Connectors
          </div>
        )}
        {data.description && <p className="text-body-lg text-black mb-1">{data.description}</p>}
        <p className="text-body text-b3">{data.appointment}</p>
      </div>

      {/* Approximate-location card — mockup "Map shows approximate
          location". We don't render a live map tile (no maps key / no
          stored precise coords) and we never reveal the exact address
          before the booking is confirmed. The soft radius graphic +
          gated copy convey "somewhere around here". */}
      <div className="px-5 pb-3">
        <div className="relative overflow-hidden rounded-[18px] bg-gl border border-line p-4">
          {/* soft approximate-radius graphic */}
          <div className="absolute -right-6 -top-8 w-40 h-40 rounded-full bg-g/10" aria-hidden="true" />
          <div className="absolute right-6 top-6 w-20 h-20 rounded-full border-2 border-g/30" aria-hidden="true" />
          <div className="relative flex items-start gap-3">
            <span className="w-9 h-9 min-w-9 rounded-full bg-white border border-bdr flex items-center justify-center mt-0.5">
              {/* location pin with eye-off — "approximate / hidden" */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" />
                <path d="M3 3l18 18" />
              </svg>
            </span>
            <div className="flex-1">
              <p className="text-body-sm font-extrabold text-black leading-snug">
                Map shows approximate location
              </p>
              <p className="text-meta text-b2 mt-1 leading-snug">
                {data.locationText
                  ? <>Around <span className="font-extrabold text-black">{data.locationText}</span>. The exact address is shared after you confirm the booking.</>
                  : <>Exact address will be shared after the user confirms the booking.</>}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Instagram block — only when the requester has a connected handle.
          "See Instagram" opens their public profile in a new tab. */}
      {data.igHandle && (
        <div className="px-5 pb-3">
          <div className="bg-soft rounded-[18px] p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center justify-center w-9 h-9 min-w-9 rounded-md border-2 border-gd">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3D8B00" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1.2" fill="#3D8B00" stroke="none" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-body font-extrabold text-black truncate">{data.igHandle}</p>
                {data.igFollowers != null && data.igFollowers > 0 && (
                  <p className="text-meta-sm text-b3">{Number(data.igFollowers).toLocaleString()} followers</p>
                )}
              </div>
            </div>
            <a
              href={`https://instagram.com/${String(data.igHandle).replace(/^@/, '')}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 bg-salmon text-white rounded-pill px-3.5 py-2 text-meta-sm font-extrabold
                         hover:opacity-90 active:scale-[.97] transition-all"
            >
              See Instagram
            </a>
          </div>
        </div>
      )}

      {/* IG photo grid — layout slot reserved for the requester's real
          Instagram media. We do NOT fabricate thumbnails: this renders
          only when data.igMedia is populated, which happens once Meta
          Graph media access is approved and getBooking starts returning
          media URLs. Until then the slot is silent (SPEC-12). */}
      {data.igHandle && Array.isArray(data.igMedia) && data.igMedia.length > 0 && (
        <div className="px-5 pb-3">
          <div className="grid grid-cols-4 gap-2">
            {data.igMedia.slice(0, 3).map((m, i) => (
              <div key={i} className="aspect-square rounded-[12px] overflow-hidden bg-bg5">
                <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
            ))}
            {data.igMedia.length > 3 && (
              <a
                href={`https://instagram.com/${String(data.igHandle).replace(/^@/, '')}`}
                target="_blank"
                rel="noreferrer"
                className="aspect-square rounded-[12px] bg-black text-white flex flex-col items-center justify-center
                           text-meta-sm font-extrabold leading-tight hover:opacity-90 transition-opacity"
              >
                <span className="text-body-lg">+{data.igMedia.length - 3}</span>
                more
              </a>
            )}
          </div>
        </div>
      )}

      {/* Friends in common with the requester — hidden when zero. */}
      {hasMutuals && (
        <div className="px-5 pb-3">
          <div className="bg-card border border-line rounded-[18px] p-3.5 flex items-center gap-3">
            <div className="flex -space-x-2">
              {mutuals.sample.map(m => (
                <span
                  key={m.id}
                  className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center
                              text-meta-sm font-extrabold text-white
                              ${m.is_connector ? 'bg-g' : 'bg-gradient-to-br from-[#b06090] to-[#703050]'}`}
                  title={m.name}
                >
                  {m.initial}
                </span>
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-body-sm font-extrabold text-black leading-snug">
                {mutualSummaryText(mutuals)}
              </p>
              <p className="text-meta text-b3 leading-snug truncate">
                {mutuals.sample.map(m => m.name).join(', ')}
                {mutuals.count > mutuals.sample.length ? ` +${mutuals.count - mutuals.sample.length} more` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* messages divider */}
      <p className="text-center text-meta-sm text-b3 py-1">Scroll down for messages</p>

      {/* message bubble */}
      <div className="mx-5 mb-3 bg-soft rounded-[18px] p-4">
        <div className="flex items-start gap-3 mb-2">
          <GradientAvatar name={data.consumerName} />
          <p className="text-body font-extrabold text-black flex-1">{data.consumerName}</p>
        </div>
        <p className="text-body text-black leading-relaxed mb-2">{data.message}</p>
        <p className="text-meta-sm text-b3">Sent — {data.sentDate}</p>
      </div>

      {/* actions */}
      {!alreadyResolved && (
        <>
          {/* CERGIO-GUARD (2026-05-30): non-blocking Stripe reminder.
              Used to disable Accept; now informs only. Provider can
              accept + finish Stripe setup afterward to get paid out. */}
          {data.real && !data.isFree && !provider.loading && !provider.ready && (
            <div className="mx-5 mt-3 mb-1 bg-warnBg border border-warn/40 rounded-[14px] p-3">
              <p className="text-body-sm font-extrabold text-warnText mb-0.5">
                {provider.hasAccount ? 'Payouts not yet enabled' : 'Stripe payouts not set up yet'}
              </p>
              <p className="text-meta text-warnText leading-relaxed">
                You can accept now — finish Stripe payouts setup in
                <span className="font-extrabold"> Profile → Service view </span>
                so funds reach your bank.
              </p>
            </div>
          )}
          <div className="px-5 pt-4 pb-2 mt-auto text-center">
            <p className="text-body-lg font-extrabold text-black">
              {data.isFree
                ? "You'll get free marketing"
                : data.priceCents > 0
                  ? `Accept to earn $${Math.round(data.priceCents / 100)}`
                  : 'Accept to confirm this booking'}
            </p>
            <p className="text-body-sm text-b3 mb-4">
              {data.isFree
                ? 'and service verification with a 4+ star rating.'
                : data.priceCents > 0
                  ? `It will appear on your calendar. You're paid out via Stripe after the job.`
                  : 'It will appear on your calendar.'}
            </p>
          </div>
          <div className="px-5 pb-3 flex flex-col gap-2">
            <button
              onClick={handleAccept}
              disabled={busy}
              className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold
                         hover:opacity-90 active:scale-[.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Working…' : data.isFree ? 'Accept free request' : 'Accept'}
            </button>
            <button
              onClick={handleDecline}
              disabled={busy}
              className="w-full text-center text-body font-extrabold text-g py-2 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </>
      )}
    </div>
  );
}
