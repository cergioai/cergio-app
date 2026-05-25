// Per design-spec.md — Earnings tab: balance, network feed, invite cards.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getMyEarnings } from '../lib/api';
import { fmtDollars } from '../lib/fees';
import { REWARDS, REWARD_COPY } from '../lib/rewards';

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
  const { showToast, auth } = useOutletContext();

  // Real earnings from the ledger (bookings + spotlights). Drives the
  // balance card, the filter pills, and the row list. No more mock $1000.
  const [earnings, setEarnings]   = useState([]);
  const [earnFilter, setEarnFilter] = useState('all'); // 'all' | 'booking' | 'spotlight'
  useEffect(() => {
    if (!auth?.isSignedIn) { setEarnings([]); return; }
    getMyEarnings({ limit: 50 }).then(({ data }) => setEarnings(data || []));
  }, [auth?.isSignedIn]);
  const filtered = earnFilter === 'all' ? earnings : earnings.filter(e => e.kind === earnFilter);
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
            You're eligible to cash out because your Cergio Cash balance exceeds $250
          </p>
        )}
      </div>

      {/* ── Real earnings ledger (bookings + spotlights) ──────────────────
          Surfaces the rows the stripe-webhook writes on payment_intent.succeeded.
          Connectors see spotlight payouts; service providers see booking payouts. */}
      {earnings.length > 0 && (
        <>
          <div className="flex items-center justify-between px-5 mb-2">
            <p className="text-[16px] font-extrabold text-black">Your earnings</p>
            <p className="text-[14px] font-extrabold text-g">{fmtDollars(totals.all)}</p>
          </div>
          {/* Filter pills */}
          <div className="px-5 flex gap-2 mb-3">
            {[
              { id: 'all',       label: `All${earnings.length ? ` · ${earnings.length}` : ''}` },
              { id: 'spotlight', label: `Spotlights${totals.spotlight ? ` · ${fmtDollars(totals.spotlight)}` : ''}` },
              { id: 'booking',   label: `Bookings${totals.booking ? ` · ${fmtDollars(totals.booking)}` : ''}` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setEarnFilter(t.id)}
                className={`rounded-pill px-3 py-1.5 text-[12px] font-extrabold transition-all
                  ${earnFilter === t.id
                    ? 'bg-gl text-gd border border-g/30'
                    : 'bg-bg5 text-b2 border border-bdr hover:border-g/40'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="px-5 flex flex-col gap-2 mb-6">
            {filtered.map(e => (
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
            {filtered.length === 0 && (
              <p className="text-[13px] text-b3 text-center py-4">No {earnFilter !== 'all' ? earnFilter : ''} earnings yet.</p>
            )}
          </div>
        </>
      )}

      {/* Network feed removed (mock-only). Real referral counts come from
          the invitations system once that's wired — for now the Earn cards
          below carry the conversion message. */}

      {/* Earn — uses canonical rewards values from src/lib/rewards.js */}
      <div className="flex items-center gap-1.5 px-5 mb-3">
        <p className="text-[16px] font-extrabold text-black">{REWARD_COPY.maxPerInviteHero}</p>
        <button
          onClick={() => navigate('/earnings/how')}
          className="w-5 h-5 rounded-full border border-black flex items-center justify-center text-[10px] font-extrabold"
        >
          i
        </button>
      </div>
      <div className="px-5 flex flex-col gap-2 mb-6">
        <ActionCard
          onClick={() => navigate('/find-friends')}
          icon="people"
          label="Invite friends"
          right={<span className="text-[12px] text-g font-extrabold">${REWARDS.friendJoinCredit}/friend</span>}
        />
        <ActionCard
          onClick={() => navigate('/invite/recommend-popup')}
          icon="briefcase"
          label="Recommend services"
          right={<span className="text-[12px] text-g font-extrabold">${REWARDS.serviceRecoCredit}/service</span>}
        />
        <ActionCard
          onClick={() => navigate('/find-friends')}
          icon="track"
          label="Share Cergio with your network"
        />
      </div>

      {/* What can I do with Cergio Cash? */}
      <p className="px-5 text-[16px] font-extrabold text-black mb-3">What can I do with Cergio Cash?</p>
      <div className="mx-5 bg-soft rounded-[18px] p-4 flex flex-col gap-3 mb-2">
        {[
          { label: 'Use toward booking services' },
          { label: 'Cash out to your bank' },
          { label: 'Convert into stock-like instruments', soon: true },
        ].map((b, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-bdr flex-shrink-0" />
            <p className="flex-1 text-[14px] text-b2 font-medium">{b.label}</p>
            {b.soon && (
              <span className="bg-g text-white text-[10px] font-extrabold tracking-wide
                               rounded-pill px-2.5 py-1">COMING SOON</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionCard({ icon, label, right, onClick }) {
  const Icon = ICONS[icon];
  return (
    <button
      onClick={onClick}
      className="w-full bg-soft rounded-[14px] py-4 px-4 flex items-center gap-4 text-left hover:bg-bg5 transition-colors"
    >
      <Icon />
      <p className="flex-1 text-[15px] font-extrabold text-black">{label}</p>
      {right}
    </button>
  );
}

const ICONS = {
  people:    () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 21c0-3 3-5 6-5s6 2 6 5"/><path d="M16 12c3 0 5 2 5 5"/></svg>,
  briefcase: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/></svg>,
  track:     () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 4 4 8-8"/></svg>,
};
