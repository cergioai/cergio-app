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
} from '../lib/api';
import { fmtDollars, sellerEarningsCents, platformFeeCents, PLATFORM_FEE_RATE } from '../lib/fees';
import { CounterSpotlightModal } from '../components/ui/CounterSpotlightModal';
import { SpotlightPaymentModal } from '../components/ui/SpotlightPaymentModal';

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
  const [counterTarget, setCounterTarget] = useState(null);  // request open in counter modal
  const [payTarget,     setPayTarget]     = useState(null);  // request open in payment modal

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

  const list = tab === 'inbound' ? inbound : outbound;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      <div className="px-5 pt-10 pb-2 flex items-start justify-between gap-4">
        <h1 className="text-[28px] font-extrabold text-black leading-tight">
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
            className={`flex-1 rounded-pill py-2.5 text-[13px] font-extrabold transition-all
              ${tab === t.id ? 'bg-white text-black shadow-card' : 'text-b3'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="px-5 mt-10 text-[14px] text-b3">Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState tab={tab} navigate={navigate} />
      ) : (
        <div className="mt-5 flex flex-col gap-3 px-5">
          {list.map(r => tab === 'inbound'
            ? <InboundCard key={r.id} request={r}
                onAccept={() => handleAccept(r)}
                onCounter={() => setCounterTarget(r)}
                onDecline={() => handleDecline(r)} />
            : <OutboundCard key={r.id} request={r}
                onAccept={() => handleAccept(r)}
                onCounter={() => setCounterTarget(r)}
                onDecline={() => handleDecline(r)}
                onPay={() => setPayTarget(r)}
                onCancel={() => handleCancel(r)} />
          )}
        </div>
      )}

      {counterTarget && (
        <CounterSpotlightModal
          request={counterTarget}
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
    </div>
  );
}

function InboundCard({ request: r, onAccept, onCounter, onDecline }) {
  const pill = STATUS_PILL[r.status] || STATUS_PILL.pending;
  const platformLabel = r.platform === 'instagram' ? 'Instagram' : 'TikTok';
  const effective = r.offered_price_cents ?? r.official_price_cents;
  // Connector's turn to act: pending (initial request) OR provider just countered.
  // If Connector themselves countered (last_counter_by='connector'), waiting on Provider.
  const isMyTurn =
    r.status === 'pending' ||
    (r.status === 'countered' && r.last_counter_by === 'provider');
  return (
    <div className="bg-white border border-bdr rounded-[18px] p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <p className="text-[15px] font-extrabold text-black leading-tight">
            {platformLabel} spotlight request
          </p>
          <p className="text-[11px] text-b3 mt-0.5">{timeAgo(r.created_at)}</p>
        </div>
        <span className={`${pill.bg} ${pill.text} rounded-pill px-2.5 py-0.5 text-[11px] font-extrabold whitespace-nowrap`}>
          {pill.label}
        </span>
      </div>
      {r.message && (
        <p className="text-[13px] text-b2 leading-relaxed mb-3 line-clamp-3">"{r.message}"</p>
      )}
      <div className="bg-bg5/60 rounded-[12px] px-3 py-2 mb-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-b2">{r.status === 'countered' ? 'Your counter' : 'Rate card'}</span>
          <span className="font-extrabold text-black">{fmtDollars(effective)}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-b3 mt-0.5">
          <span>You earn</span>
          <span>{fmtDollars(sellerEarningsCents(effective))} (after {Math.round(PLATFORM_FEE_RATE * 100)}% fee)</span>
        </div>
      </div>
      {isMyTurn && (
        <div className="flex gap-2">
          <button onClick={onDecline}
            className="flex-1 bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-[13px] font-extrabold hover:bg-bg5/40">
            Decline
          </button>
          <button onClick={onCounter}
            className="flex-1 bg-white border-2 border-black text-black rounded-[14px] py-2.5 text-[13px] font-extrabold hover:bg-bg5/40">
            Counter
          </button>
          <button onClick={onAccept}
            className="flex-1 bg-g text-white rounded-[14px] py-2.5 text-[13px] font-extrabold hover:opacity-90">
            Accept
          </button>
        </div>
      )}
      {/* Connector countered + waiting on Provider */}
      {r.status === 'countered' && r.last_counter_by === 'connector' && (
        <p className="text-[12px] text-b3 text-center font-medium mt-1">
          Waiting on Provider to respond to your counter of {fmtDollars(effective)}…
        </p>
      )}
    </div>
  );
}

function OutboundCard({ request: r, onAccept, onCounter, onDecline, onPay, onCancel }) {
  const pill = STATUS_PILL[r.status] || STATUS_PILL.pending;
  const platformLabel = r.platform === 'instagram' ? 'Instagram' : 'TikTok';
  const isCountered = r.status === 'countered' && r.offered_price_cents != null;
  const savings = isCountered ? Math.max(0, r.official_price_cents - r.offered_price_cents) : 0;
  return (
    <div className="bg-white border border-bdr rounded-[18px] p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <p className="text-[15px] font-extrabold text-black leading-tight">
            {platformLabel} spotlight request
          </p>
          <p className="text-[11px] text-b3 mt-0.5">Sent {timeAgo(r.created_at)}</p>
        </div>
        <span className={`${pill.bg} ${pill.text} rounded-pill px-2.5 py-0.5 text-[11px] font-extrabold whitespace-nowrap`}>
          {pill.label}
        </span>
      </div>

      <div className="bg-bg5/60 rounded-[12px] px-3 py-2 mb-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-b2">{isCountered ? 'Counter-offer' : 'Asking price'}</span>
          <span className="font-extrabold text-black">
            {fmtDollars(isCountered ? r.offered_price_cents : r.official_price_cents)}
          </span>
        </div>
        {isCountered && (
          <div className="flex items-center justify-between text-[11px] mt-1">
            <span className="text-gd font-bold">Save vs official</span>
            <span className="text-gd font-extrabold">
              {fmtDollars(savings)} (official {fmtDollars(r.official_price_cents)})
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-[11px] text-b3 mt-0.5">
          <span>Includes {Math.round(PLATFORM_FEE_RATE * 100)}% Cergio fee</span>
          <span>{fmtDollars(platformFeeCents(isCountered ? r.offered_price_cents : r.official_price_cents))}</span>
        </div>
      </div>

      {/* Connector countered → Provider's turn (Accept · Counter back · Decline) */}
      {r.status === 'countered' && r.last_counter_by === 'connector' && (
        <div className="flex gap-2">
          <button onClick={onDecline}
            className="flex-1 bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-[13px] font-extrabold hover:bg-bg5/40">
            Decline
          </button>
          <button onClick={onCounter}
            className="flex-1 bg-white border-2 border-black text-black rounded-[14px] py-2.5 text-[13px] font-extrabold hover:bg-bg5/40">
            Counter
          </button>
          <button onClick={onAccept}
            className="flex-1 bg-g text-white rounded-[14px] py-2.5 text-[13px] font-extrabold hover:opacity-90">
            Accept {fmtDollars(r.offered_price_cents)}
          </button>
        </div>
      )}
      {/* Provider countered → waiting on Connector */}
      {r.status === 'countered' && r.last_counter_by === 'provider' && (
        <p className="text-[12px] text-b3 text-center font-medium">
          Waiting on Connector to respond to your counter of {fmtDollars(r.offered_price_cents)}…
        </p>
      )}
      {r.status === 'pending' && (
        <button onClick={onCancel}
          className="w-full bg-white border border-bdr text-danger rounded-[14px] py-2.5 text-[13px] font-extrabold hover:bg-bg5/40">
          Cancel request
        </button>
      )}
      {/* Pay button appears once the request is accepted but not yet paid */}
      {r.status === 'accepted' && !r.paid_at && (
        <button onClick={onPay}
          className="w-full bg-g text-white rounded-[14px] py-3 text-[14px] font-extrabold hover:opacity-90 active:scale-[.98] transition-all">
          Pay {fmtDollars(r.offered_price_cents ?? r.official_price_cents)} to confirm
        </button>
      )}
      {r.status === 'accepted' && r.paid_at && (
        <div className="bg-gl text-gd rounded-[14px] py-2.5 text-[13px] font-extrabold text-center">
          Paid ✓ — waiting for the post
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
      <h2 className="text-[18px] font-extrabold text-black mb-2">
        {tab === 'inbound' ? 'No requests yet' : 'You haven\'t asked anyone yet'}
      </h2>
      <p className="text-[14px] text-b3 leading-relaxed mb-5">
        {tab === 'inbound'
          ? 'Providers will request spotlights from you here. Set your rate card so people know what you charge.'
          : 'Ask a Connector to spotlight your service on Instagram or TikTok.'}
      </p>
      <button
        onClick={() => navigate(tab === 'inbound' ? '/rainmaker/apply/instagram' : '/connectors/browse')}
        className="bg-g text-white rounded-[24px] px-6 py-3 text-[14px] font-extrabold"
      >
        {tab === 'inbound' ? 'Set your rate card' : 'Browse Connectors'}
      </button>
    </div>
  );
}
