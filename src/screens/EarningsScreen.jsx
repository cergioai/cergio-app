// Per design-spec.md — Earnings tab: balance, network feed, invite cards.
// All hardcoded mock numbers stripped; filter pills removed; copy uses
// REWARDS canonical $250-per-friend across every CTA.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getMyEarnings, listMyServices } from '../lib/api';
import { fmtDollars } from '../lib/fees';
import { REWARDS } from '../lib/rewards';

function timeAgo(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)   return 'just now';
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}

const BALANCE_UNIT = 'USD';
const CASH_OUT_THRESHOLD_CENTS = 250 * 100; // $250 to cash out (matches reward ceiling)

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function EarningsScreen() {
  const navigate = useNavigate();
  const { showToast, auth, serviceMode } = useOutletContext();
  const [showGrowthInfo, setShowGrowthInfo] = useState(false);

  // Real earnings from the ledger (bookings + spotlights). No filter pills
  // — single chronological list keeps things simple when there's nothing
  // to filter yet (and even when there is).
  const [earnings, setEarnings] = useState([]);
  // Provider check — if signed in user has at least one listed service,
  // OR they're toggled into service view, we show provider-flavored
  // benefit copy. Consumers see the friend-referral angle instead.
  const [hasService, setHasService] = useState(false);
  useEffect(() => {
    if (!auth?.isSignedIn) { setEarnings([]); setHasService(false); return; }
    getMyEarnings({ limit: 50 }).then(({ data }) => setEarnings(data || []));
    listMyServices().then(({ data }) => setHasService((data || []).length > 0));
  }, [auth?.isSignedIn]);
  const isProvider = serviceMode || hasService;
  const totals = earnings.reduce((acc, e) => {
    if (e.status !== 'cleared') return acc;
    acc.all       += e.amount_cents;
    acc[e.kind]   = (acc[e.kind] || 0) + e.amount_cents;
    return acc;
  }, { all: 0 });
  const balanceCents = totals.all;
  const balanceStr   = fmtDollars(balanceCents);
  const canCashOut   = balanceCents >= CASH_OUT_THRESHOLD_CENTS;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* Page title aligns with Profile canon: 30px / 800 / leading-tight,
          generous top padding to match the rhythm Profile sets. */}
      <h1 className="px-5 pt-10 pb-4 text-[30px] font-extrabold text-black leading-tight">Earnings</h1>

      {/* hero balance card — kelly-green gradient outer, white inner.
          Balance = real summed cleared earnings (booking + spotlight). */}
      <div className="mx-5 rounded-[20px] bg-gradient-to-br from-gm to-g p-3 mb-5 shadow-card">
        <div className="bg-white rounded-[14px] p-4 flex items-center justify-between">
          <div>
            <p className="text-[28px] font-extrabold text-black leading-none">
              {balanceStr}<span className="text-[14px] text-b3 font-bold ml-1">{BALANCE_UNIT}</span>
            </p>
            {!canCashOut && balanceCents > 0 && (
              <p className="text-[11px] text-b3 mt-1">
                ${(CASH_OUT_THRESHOLD_CENTS - balanceCents) / 100} more to cash out
              </p>
            )}
          </div>
          <button
            onClick={() => navigate('/earnings/breakdown')}
            className="w-12 h-12 rounded-full bg-g flex items-center justify-center"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </button>
        </div>
        {canCashOut ? (
          <button
            onClick={() => showToast('Cashing out — coming soon')}
            className="w-full bg-white rounded-[14px] py-3.5 mt-2 text-[15px] font-extrabold text-black"
          >
            Cash out
          </button>
        ) : (
          <button
            onClick={() => navigate('/earnings/breakdown')}
            className="w-full bg-white rounded-[14px] py-3 mt-2 flex items-center justify-between px-4
                       text-[14px] font-extrabold text-black"
          >
            See Earnings Breakdown
            <span className="text-b3 text-base">›</span>
          </button>
        )}
        {canCashOut && (
          <p className="text-center text-[12px] text-white font-medium mt-3 px-2">
            You're eligible to cash out — your balance is over ${REWARDS.perFriend}.
          </p>
        )}
      </div>

      {/* ── Real earnings ledger (bookings + spotlights) ──────────────────
          Surfaces the rows the stripe-webhook writes on payment_intent.succeeded.
          Connectors see spotlight payouts; service providers see booking payouts. */}
      {earnings.length > 0 ? (
        <>
          <div className="flex items-center justify-between px-5 mb-2">
            <p className="text-[14px] font-extrabold uppercase tracking-widest text-b3">Your earnings</p>
            <p className="text-[14px] font-extrabold text-g">{fmtDollars(totals.all)}</p>
          </div>
          <div className="px-5 flex flex-col gap-2 mb-6">
            {earnings.map(e => (
              <div key={e.id} className="bg-white border border-bdr rounded-[14px] p-3.5 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
                                  ${e.kind === 'spotlight' ? 'bg-gl text-gd' : 'bg-bg5 text-b2'}`}>
                  {e.kind === 'spotlight' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/>
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-extrabold text-black leading-tight">
                    {e.kind === 'spotlight'
                      ? `${(e.meta?.platform === 'tiktok' ? 'TikTok' : 'Instagram')} spotlight`
                      : 'Service booking'}
                  </p>
                  <p className="text-[11px] text-b3 mt-0.5">
                    {timeAgo(e.created_at)} · {e.status === 'cleared' ? 'cleared' : e.status}
                  </p>
                </div>
                <span className="text-[15px] font-extrabold text-black">
                  +{fmtDollars(e.amount_cents)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        // Empty state — counters + benefit summary. Copy adapts to
        // whether the user is on the consumer or provider side, mirroring
        // the Home invite house ad. CERGIO-GUARD: don't reintroduce
        // hardcoded mock totals here — counts come from earnings (real).
        <div className="mx-5 mb-6 bg-white border border-bdr rounded-[18px] p-4">
          {/* Real counters — both 0 until activity lands. */}
          <div className="flex items-center gap-4 mb-3">
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">0</p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug">friends invited</p>
            </div>
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">0</p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug">services reco'd</p>
            </div>
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">$0</p>
              <p className="text-[11px] text-b3 mt-0.5 leading-snug">earned</p>
            </div>
          </div>

          {/* Counter row with INLINE action buttons. Replaces the
              old below-the-card bullet list. Provider + Consumer get
              different button labels + counter labels. */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1">
              <p className="text-[18px] font-extrabold text-black leading-none">0</p>
              <p className="text-[10px] text-b3 mt-0.5 leading-snug uppercase tracking-wide">
                {isProvider ? 'Clients invited' : 'Friends invited'}
              </p>
            </div>
            <button
              onClick={() => navigate('/find-friends')}
              className="bg-g text-white rounded-pill px-3 py-1.5 text-[11px] font-extrabold whitespace-nowrap"
            >
              Invite
            </button>
            <button
              onClick={() => navigate('/invite/recommend-popup')}
              className="bg-white border border-bdr rounded-pill px-3 py-1.5 text-[11px] font-extrabold text-b2 whitespace-nowrap"
            >
              Reco
            </button>
          </div>

          <div className="flex items-center gap-4 mb-3 border-t border-bdr pt-3">
            <div className="flex-1">
              <p className="text-[16px] font-extrabold text-black leading-none">0</p>
              <p className="text-[10px] text-b3 mt-0.5 leading-snug">services reco'd</p>
            </div>
            <div className="flex-1">
              <p className="text-[16px] font-extrabold text-black leading-none">$0</p>
              <p className="text-[10px] text-b3 mt-0.5 leading-snug">earned</p>
            </div>
            <div className="flex-1">
              <p className="text-[16px] font-extrabold text-black leading-none">0</p>
              <p className="text-[10px] text-b3 mt-0.5 leading-snug">
                {isProvider ? 'spotlights' : 'free credits'}
              </p>
            </div>
          </div>

          {/* Mode-tailored one-liner — provider vs consumer is genuinely
              different audiences. CERGIO-GUARD: do NOT use 'invite
              clients' copy in consumer mode and vice versa. */}
          <p className="text-[12px] text-b3 leading-snug">
            {isProvider
              ? <>Turn your client list into your referral network. Every client that joins + books earns you <span className="font-bold text-black">${REWARDS.perFriend}</span> + Growth Participation Income.{' '}
                  <button type="button" onClick={() => setShowGrowthInfo(true)} className="text-gd underline underline-offset-2 font-bold">ⓘ</button>
                </>
              : <>Help friends find trusted services and earn <span className="font-bold text-black">${REWARDS.perFriend}</span> per friend who joins + books, plus free credits + Growth Participation Income.{' '}
                  <button type="button" onClick={() => setShowGrowthInfo(true)} className="text-gd underline underline-offset-2 font-bold">ⓘ</button>
                </>}
          </p>
        </div>
      )}

      {/* "How earnings work" link — replaces the old action-card stack
          + earnings benefit list. Action buttons (Invite / Reco) now
          live inline next to the counters above. Growth Participation
          Income is also there with its ⓘ; no need to repeat the long
          block here. */}
      <div className="px-5 mb-4">
        <button
          onClick={() => navigate('/earnings/how')}
          className="w-full bg-soft rounded-[14px] py-3 px-4 flex items-center justify-between
                     text-left hover:bg-bg5 transition-colors"
        >
          <span className="text-[13px] font-extrabold text-black">How earnings work</span>
          <span className="text-b3 text-base">›</span>
        </button>
      </div>

      {/* Popup explainer — airmiles analogy + IPO contingency + mission. */}
      {showGrowthInfo && (
        <div
          className="fixed inset-0 z-[80] bg-black/40 flex items-end justify-center"
          onClick={() => setShowGrowthInfo(false)}
        >
          <div
            className="w-full max-w-[390px] bg-cream rounded-t-[24px] p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-[18px] font-extrabold text-black leading-tight">
                Growth Participation Income
              </h3>
              <button
                onClick={() => setShowGrowthInfo(false)}
                className="text-[20px] text-b3 font-bold px-2 -mt-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              Like airmiles — but tied to Cergio's growth instead of flights.
              The more you make on Cergio, the higher your participation score, the bigger your bonus.
            </p>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              <span className="font-bold">How it works:</span> every dollar of cash income you earn
              also accrues a Growth Participation Score. We track it from day one.
            </p>
            <p className="text-[13px] text-b2 leading-relaxed mb-3">
              <span className="font-bold">When it activates:</span> if Cergio goes public (IPO).
              IPO isn't guaranteed — community participation in our growth helps accelerate it.
            </p>
            <div className="bg-gl border border-g/25 rounded-[14px] p-3 mt-4">
              <p className="text-[12px] text-gd font-extrabold leading-snug">
                Cergio's mission
              </p>
              <p className="text-[12px] text-gd/85 mt-1 leading-snug font-normal">
                Build human-powered AI that enables shared prosperity. Your bonus is directly
                tied to your participation in that growth.
              </p>
            </div>
            <p className="text-[10px] text-b3 mt-4 leading-relaxed">
              Growth Participation Income is a loyalty-style bonus, not a security.
              No guaranteed payout. Final terms set at activation.
            </p>
            <button
              onClick={() => setShowGrowthInfo(false)}
              className="w-full mt-5 bg-g text-white rounded-[14px] py-3 text-[14px] font-extrabold"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ActionCard + ICONS helpers removed — replaced by the inline Invite
// + Reco buttons next to the counter row + the "How earnings work"
// link. Less surface, clearer signal.
