// Two-tab inbox for spotlight requests.
//   Inbound  — for Connectors: requests providers sent THEM. Accept / Counter / Decline.
//   Outbound — for providers: requests they've SENT. See status (pending / countered /
//              accepted / declined / cancelled). Accept a counter from here.
//
// Both tabs are visible to everyone since most users are both a provider and
// (eventually) a Connector. The empty states explain.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  listMyInboundSpotlightRequests,
  listMyOutboundSpotlightRequests,
  setSpotlightRequestStatus,
  confirmSpotlightPost,
} from '../lib/api';
import { fmtDollars, sellerEarningsCents, platformFeeCents, PLATFORM_FEE_RATE } from '../lib/fees';
import { CounterSpotlightModal } from '../components/ui/CounterSpotlightModal';
import { SpotlightPaymentModal } from '../components/ui/SpotlightPaymentModal';
import { MarkPostedModal } from '../components/ui/MarkPostedModal';

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)   return 'just now';
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}

const STATUS_PILL = {
  pending:   { bg: 'bg-bg5',         text: 'text-b2', label: 'Pending' },
  countered: { bg: 'bg-warnBg',      text: 'text-warnText', label: 'Countered' },
  accepted:  { bg: 'bg-gl',          text: 'text-gd', label: 'Accepted' },
  declined:  { bg: 'bg-bg5',         text: 'text-danger', label: 'Declined' },
  cancelled: { bg: 'bg-bg5',         text: 'text-b3', label: 'Cancelled' },
  expired:   { bg: 'bg-bg5',         text: 'text-b3', label: 'Expired' },
};

export function ConnectorRequestsScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
  const [tab, setTab] = useState('inbound');   // 'inbound' | 'outbound'
  const [inbound, setInbound] = useState([]);
  const [outbound, setOutbound] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counterTarget, setCounterTarget] = useState(null);  // { request, role } open in counter modal
  const [payTarget,     setPayTarget]     = useState(null);  // request open in payment modal
  const [postedTarget,  setPostedTarget]  = useState(null);  // request open in "mark posted" modal

  const refresh = async () => {
    setLoading(true);
    const [inb, out] = await Promise.all([
      listMyInboundSpotlightRequests(),
      listMyOutboundSpotlightRequests(),
    ]);
    setInbound(inb.data || []);
    setOutbound(out.data || []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [auth?.isSignedIn]);

  const handleAccept = async (r) => {
    const { error } = await setSpotlightRequestStatus(r.id, 'accepted');
    if (error) { showToast(error.message); return; }
    showToast('Accepted ✓');
    refresh();
  };
  const handleDecline = async (r) => {
    const { error } = await setSpotlightRequestStatus(r.id, 'declined');
    if (error) { showToast(error.message); return; }
    showToast('Declined');
    refresh();
  };
  const handleCancel = async (r) => {
    const { error } = await setSpotlightRequestStatus(r.id, 'cancelled');
    if (error) { showToast(error.message); return; }
    showToast('Cancelled');
    refresh();
  };
  const handleConfirmPost = async (r) => {
    const { error } = await confirmSpotlightPost(r.id);
    if (error) { showToast(error.message); return; }
    const free = (r.offered_price_cents ?? r.official_price_cents ?? 0) === 0;
    showToast(free ? 'Post confirmed ✓' : 'Confirmed — funds released ✓');
    refresh();
  };

  const list = tab === 'inbound' ? inbound : outbound;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-display-2 font-extrabold text-black leading-tight">
          Spotlight<br />requests
        </h1>
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-bg5 flex items-center justify-center text-b2 hover:bg-bdr transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="mx-5 mt-3 bg-bg5 rounded-pill p-1 flex">
        {[
          { id: 'inbound',  label: `Inbound${inbound.filter(r => r.status === 'pending').length ? ` · ${inbound.filter(r => r.status === 'pending').length}` : ''}` },
          { id: 'outbound', label: `Sent${outbound.filter(r => r.status === 'countered').length ? ` · ${outbound.filter(r => r.status === 'countered').length}` : ''}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-pill py-2.5 text-body-sm font-extrabold transition-all
              ${tab === t.id ? 'bg-white text-black shadow-card' : 'text-b3'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="px-5 mt-10 text-body text-b3">Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState tab={tab} navigate={navigate} />
      ) : (
        <div className="mt-5 flex flex-col gap-3 px-5">
          {list.map(r => tab === 'inbound'
            ? <InboundCard key={r.id} request={r}
                onAccept={() => handleAccept(r)}
                onCounter={() => setCounterTarget({ request: r, role: 'connector' })}
                onDecline={() => handleDecline(r)}
                onMarkPosted={() => setPostedTarget(r)} />
            : <OutboundCard key={r.id} request={r}
                onAccept={() => handleAccept(r)}
                onCounter={() => setCounterTarget({ request: r, role: 'provider' })}
                onDecline={() => handleDecline(r)}
                onPay={() => setPayTarget(r)}
                onConfirmPost={() => handleConfirmPost(r)}
                onCancel={() => handleCancel(r)} />
          )}
        </div>
      )}

      {counterTarget && (
        <CounterSpotlightModal
          request={counterTarget.request}
          role={counterTarget.role}
          onClose={() => setCounterTarget(null)}
          onCountered={() => { showToast('Counter sent ✓'); refresh(); }}
        />
      )}

      {payTarget && (
        <SpotlightPaymentModal
          spotlightRequestId={payTarget.id}
          connectorName={null /* could enrich with profile lookup later */}
          onClose={() => setPayTarget(null)}
          onSuccess={() => { showToast('Paid ✓ — Connector notified'); setPayTarget(null); refresh(); }}
        />
      )}

      {postedTarget && (
        <MarkPostedModal
          request={postedTarget}
          onClose={() => setPostedTarget(null)}
          onPosted={() => { showToast('Marked as posted ✓ — Provider notified'); refresh(); }}
        />
      )}
    </div>
  );
}

// CERGIO-GUARD (2026-06-05): InboundCard restructured per Tarik —
// "this needs to click to profile of the service asking for free
// spotlight ... bio added by provider.. and msg Jane is requestiong to
// offer you a free personal training session in return to IG post ..
// make succinct and solid". Three shifts:
//   1. The whole card body (above the action row) is a Link to
//      /u/{provider.id} so a tap drills into the provider's profile
//      (where the viewer can see their headline + bio + services).
//   2. The dense "For service / Rate card / You earn" block collapses
//      into ONE succinct sentence keyed on free-vs-paid:
//        free  → "Jane is offering you a free Personal Trainer session
//                 in return for an IG post."
//        paid  → "Jane is asking for an IG post — rate card $500
//                 ($450 to you after 10% Cergio fee)."
//   3. Provider headline (when set) renders as a small subtitle so
//      the viewer's eye lands on a person, not a price.
//
// Action row sits below the Link so taps on Accept/Counter/Decline don't
// accidentally trigger the profile drill.
function InboundCard({ request: r, onAccept, onCounter, onDecline, onMarkPosted }) {
  const navigate = useNavigate();
  const pill = STATUS_PILL[r.status] || STATUS_PILL.pending;
  const platformLabel = r.platform === 'instagram' ? 'Instagram' : 'TikTok';
  const effective = r.offered_price_cents ?? r.official_price_cents ?? 0;
  // Connector's turn to act: pending (initial request) OR provider just countered.
  // If Connector themselves countered (last_counter_by='connector'), waiting on Provider.
  const isMyTurn =
    r.status === 'pending' ||
    (r.status === 'countered' && r.last_counter_by === 'provider');

  // Provider context for the headline + drill-to-profile.
  const providerName = r.provider?.display_name || r.service?.title || 'A provider';
  const providerFirst = providerName.split(' ')[0];
  const providerHeadline = r.provider?.headline || null;
  // Service reputation — what a Connector judges a spotlight on (not IG reach).
  const providerBio = r.provider?.bio || null;
  const providerServices = r.providerServices || [];
  const providerRecosReceived = r.providerRecosReceived || 0;
  // Service-type label — prefer the formal taxonomy (Personal Trainer,
  // Plumber), fall back to the listing title (Trainer at Beach Park).
  const serviceLabel =
    r.service?.taxonomy_provider_type ||
    r.service?.title ||
    'service';
  const isFree = effective === 0;

  // Tappable profile target — service.owner_id when present, else
  // spotlight_requests.provider_id. If neither resolves we silently
  // disable the drill so the card never dead-ends.
  const profileTarget = r.provider?.id || r.service?.owner_id || null;
  const onCardTap = () => {
    navigate(`/spotlight/${r.id}`);   // full frame-3-quality detail screen
  };

  return (
    <div className="bg-white border border-bdr rounded-[18px] p-4">
      {/* Tappable header — drills into provider profile */}
      <button
        type="button"
        onClick={onCardTap}
        disabled={!profileTarget}
        className="w-full text-left -m-1 p-1 rounded-[14px] hover:bg-bg5/30 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-body-lg font-extrabold text-black leading-tight">
              {providerName}
            </p>
            {providerHeadline && (
              <p className="text-meta-sm text-b3 mt-0.5 leading-snug truncate">
                {providerHeadline}
              </p>
            )}
            {/* lead with SERVICE reputation: services + reco's received, bio */}
            {(providerServices.length > 0 || providerRecosReceived > 0) && (
              <p className="text-meta-sm text-gd font-extrabold mt-1 leading-snug">
                {providerServices.length > 0
                  ? providerServices.map(s => `${s.name} (${s.recos} reco${s.recos === 1 ? '' : 's'} received)`).join(', ')
                  : `${providerRecosReceived} reco${providerRecosReceived === 1 ? '' : 's'} received`}
              </p>
            )}
            {providerBio && (
              <p className="text-meta text-b3 mt-1 leading-snug line-clamp-2">{providerBio}</p>
            )}
            <p className="text-meta-sm text-b3 mt-1">
              {platformLabel} spotlight · {timeAgo(r.created_at)}
            </p>
          </div>
          <span className={`${pill.bg} ${pill.text} rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold whitespace-nowrap`}>
            {pill.label}
          </span>
        </div>

        {/* Succinct, human offer line — free vs paid */}
        <p className="text-body-sm text-black leading-snug mb-2">
          {isFree ? (
            <>
              <strong>{providerFirst}</strong> is offering you a <strong>free {serviceLabel}</strong> session in return for {platformLabel === 'TikTok' ? 'a TikTok' : 'an IG'} post.
            </>
          ) : (
            <>
              <strong>{providerFirst}</strong> wants {platformLabel === 'TikTok' ? 'a TikTok' : 'an Instagram'} post for their <strong>{serviceLabel}</strong> listing —{' '}
              <span className="font-extrabold">{fmtDollars(effective)}</span>{' '}
              <span className="text-b3">({fmtDollars(sellerEarningsCents(effective))} to you, after {Math.round(PLATFORM_FEE_RATE * 100)}% fee)</span>.
            </>
          )}
        </p>

        {r.message && (
          <p className="text-meta text-b2 leading-snug mb-2 line-clamp-3 italic">
            &ldquo;{r.message}&rdquo;
          </p>
        )}
      </button>

      {isMyTurn && (
        <div className="flex gap-2 mt-2">
          <button onClick={onDecline}
            className="flex-1 bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40">
            Decline
          </button>
          {/* CERGIO-GUARD: countering a $0 free-swap ask is impossible
              (counters must be LOWER than the current ask) — hide the
              dead button on free requests. */}
          {!isFree && (
            <button onClick={onCounter}
              className="flex-1 bg-white border-2 border-black text-black rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40">
              Counter
            </button>
          )}
          <button onClick={onAccept}
            className="flex-1 bg-g text-white rounded-[14px] py-2.5 text-body-sm font-extrabold hover:opacity-90">
            Accept
          </button>
        </div>
      )}
      {/* Connector countered + waiting on Provider */}
      {r.status === 'countered' && r.last_counter_by === 'connector' && (
        <p className="text-meta text-b3 text-center font-medium mt-1">
          Waiting on Provider to respond to your counter of {fmtDollars(effective)}…
        </p>
      )}

      {/* Accepted → time to post (Connector action).
          CERGIO-GUARD (2026-06-05): the old gate required r.paid_at —
          but FREE swaps never get paid, so the Connector could never
          mark a free spotlight as posted and the flow deadlocked
          forever. Free requests skip payment entirely. */}
      {r.status === 'accepted' && !r.posted_at && (r.paid_at || isFree) && (
        <button onClick={onMarkPosted}
          className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold hover:opacity-90 active:scale-[.98] transition-all mt-1">
          Mark posted
        </button>
      )}
      {r.status === 'accepted' && !r.posted_at && !r.paid_at && !isFree && (
        <div className="bg-bg5 text-b2 rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-1">
          Accepted · awaiting provider payment
        </div>
      )}
      {r.status === 'accepted' && r.posted_at && !r.confirmed_at && (
        <div className="bg-warnBg border border-warn/40 text-warnText rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-1">
          Posted · awaiting confirmation
        </div>
      )}
      {r.confirmed_at && (
        <div className="bg-gl text-gd rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-1">
          {isFree ? 'Confirmed ✓' : 'Funds released'}
        </div>
      )}
    </div>
  );
}

function OutboundCard({ request: r, onAccept, onCounter, onDecline, onPay, onConfirmPost, onCancel }) {
  const pill = STATUS_PILL[r.status] || STATUS_PILL.pending;
  const platformLabel = r.platform === 'instagram' ? 'Instagram' : 'TikTok';
  const isCountered = r.status === 'countered' && r.offered_price_cents != null;
  const savings = isCountered ? Math.max(0, r.official_price_cents - r.offered_price_cents) : 0;
  // CERGIO-GUARD (2026-06-05): free swap = $0 effective price. No payment
  // step, no fees, no "Pay $0" dead-end (Stripe rejects $0 intents).
  const effective = r.offered_price_cents ?? r.official_price_cents ?? 0;
  const isFree = effective === 0;
  return (
    <div className="bg-white border border-bdr rounded-[18px] p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <p className="text-body-lg font-extrabold text-black leading-tight">
            {platformLabel} spotlight request
          </p>
          <p className="text-meta-sm text-b3 mt-0.5">Sent {timeAgo(r.created_at)}</p>
        </div>
        <span className={`${pill.bg} ${pill.text} rounded-pill px-2.5 py-0.5 text-meta-sm font-extrabold whitespace-nowrap`}>
          {pill.label}
        </span>
      </div>

      <div className="bg-bg5/60 rounded-[12px] px-3 py-2 mb-3">
        <div className="flex items-center justify-between text-meta">
          <span className="text-b2">{isFree ? 'Free swap' : isCountered ? 'Counter-offer' : 'Asking price'}</span>
          <span className="font-extrabold text-black">
            {isFree ? 'Service for post' : fmtDollars(isCountered ? r.offered_price_cents : r.official_price_cents)}
          </span>
        </div>
        {isCountered && !isFree && (
          <div className="flex items-center justify-between text-meta-sm mt-1">
            <span className="text-gd font-extrabold">Save vs official</span>
            <span className="text-gd font-extrabold">
              {fmtDollars(savings)} (official {fmtDollars(r.official_price_cents)})
            </span>
          </div>
        )}
        {!isFree && (
          <div className="flex items-center justify-between text-meta-sm text-b3 mt-0.5">
            <span>Includes {Math.round(PLATFORM_FEE_RATE * 100)}% Cergio fee</span>
            <span>{fmtDollars(platformFeeCents(isCountered ? r.offered_price_cents : r.official_price_cents))}</span>
          </div>
        )}
      </div>

      {/* CERGIO-GUARD (2026-06-05): Sent-side action set fix.
          Tarik: "this shouldn't be under sent with ability to accept
          (since it's the one I sent to counter)". The original code
          gated Accept on last_counter_by === 'connector', but if that
          stamp was null/missing the row still rendered Decline/Counter/
          Accept — letting the provider Accept their own counter, which
          is nonsense.
          Resolution:
            • Connector countered (their offer on the table) → Accept/
              Counter back/Decline (this is YOUR turn as provider).
            • Provider countered last → wait + Cancel/Withdraw option.
            • Status unknown / last_counter_by missing → wait + Cancel.
          The result: Accept never appears on YOUR own counter. */}
      {r.status === 'countered' && r.last_counter_by === 'connector' && (
        <div className="flex gap-2">
          <button onClick={onDecline}
            className="flex-1 bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40">
            Decline
          </button>
          <button onClick={onCounter}
            className="flex-1 bg-white border-2 border-black text-black rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40">
            Counter
          </button>
          <button onClick={onAccept}
            className="flex-1 bg-g text-white rounded-[14px] py-2.5 text-body-sm font-extrabold hover:opacity-90">
            Accept {fmtDollars(r.offered_price_cents)}
          </button>
        </div>
      )}
      {/* Provider countered last → waiting on Connector. Show the
          waiting note + a Cancel action so the user can withdraw their
          counter if they change their mind. */}
      {r.status === 'countered' && r.last_counter_by !== 'connector' && (
        <>
          <p className="text-meta text-b3 text-center font-medium mb-2">
            Waiting on Connector to respond to your counter of {fmtDollars(r.offered_price_cents)}…
          </p>
          <button onClick={onCancel}
            className="w-full bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40">
            Withdraw counter
          </button>
        </>
      )}
      {r.status === 'pending' && (
        <button onClick={onCancel}
          className="w-full bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-body-sm font-extrabold hover:bg-bg5/40">
          Cancel request
        </button>
      )}
      {/* Pay button appears once the request is accepted but not yet
          paid. FREE swaps skip payment entirely — no $0 PaymentIntent. */}
      {r.status === 'accepted' && !r.paid_at && !isFree && (
        <button onClick={onPay}
          className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold hover:opacity-90 active:scale-[.98] transition-all">
          Pay {fmtDollars(effective)} to confirm
        </button>
      )}
      {r.status === 'accepted' && !r.posted_at && (r.paid_at || isFree) && (
        <div className="bg-gl text-gd rounded-[12px] px-3 py-2 text-meta font-extrabold text-center">
          {isFree ? 'Free swap accepted · awaiting post' : 'Paid · awaiting post'}
        </div>
      )}
      {/* Connector posted → Provider needs to confirm */}
      {r.posted_at && !r.confirmed_at && (
        <div className="flex flex-col gap-2 mt-1">
          {r.posted_url && (
            <a href={r.posted_url} target="_blank" rel="noopener noreferrer"
               className="text-meta font-extrabold text-g underline underline-offset-2 text-center">
              View post →
            </a>
          )}
          <button onClick={onConfirmPost}
            className="w-full bg-g text-white rounded-[14px] py-3 text-body font-extrabold hover:opacity-90 active:scale-[.98] transition-all">
            {isFree ? 'Confirm post' : 'Confirm · release funds'}
          </button>
        </div>
      )}
      {r.confirmed_at && (
        <div className="bg-gl text-gd rounded-[12px] px-3 py-2 text-meta font-extrabold text-center mt-1">
          {isFree ? 'Confirmed ✓' : 'Confirmed · released'}
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab, navigate }) {
  return (
    <div className="px-5 mt-12 text-center">
      <div className="w-16 h-16 rounded-full bg-gl flex items-center justify-center mx-auto mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
             stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </div>
      <h2 className="text-heading-2 font-extrabold text-black mb-2">
        {tab === 'inbound' ? 'No requests yet' : 'You haven\'t asked anyone yet'}
      </h2>
      <p className="text-body text-b3 leading-relaxed mb-5">
        {tab === 'inbound'
          ? 'Providers will request spotlights from you here. Set your rate card so people know what you charge.'
          : 'Ask a Connector to spotlight your service on Instagram or TikTok.'}
      </p>
      <button
        onClick={() => navigate(tab === 'inbound' ? '/rainmaker/apply/instagram' : '/connectors/browse')}
        className="bg-g text-white rounded-[24px] px-6 py-3 text-body font-extrabold"
      >
        {tab === 'inbound' ? 'Set your rate card' : 'Browse Connectors'}
      </button>
    </div>
  );
}
