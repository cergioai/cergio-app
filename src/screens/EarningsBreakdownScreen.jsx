// Earnings Breakdown — real ledger (cleared earnings + per-kind totals).
// CERGIO-GUARD: NO BREAKDOWN mock import. All numbers come from
// getMyEarnings(). Defaults to $0 + zero counters when there's no data.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getMyEarnings } from '../lib/api';
import { fmtDollars } from '../lib/fees';

export function EarningsBreakdownScreen() {
  const navigate = useNavigate();
  const { auth } = useOutletContext() || {};

  const [earnings, setEarnings] = useState([]);
  useEffect(() => {
    if (!auth?.isSignedIn) return;
    getMyEarnings({ limit: 200 }).then(({ data }) => setEarnings(data || []));
  }, [auth?.isSignedIn]);

  // Roll up cleared earnings by kind. We don't have invited / reco
  // counts yet (those require dedicated tables) so they default to 0.
  const totals = earnings.reduce((acc, e) => {
    if (e.status !== 'cleared') return acc;
    acc.all          += e.amount_cents;
    acc[e.kind]      = (acc[e.kind] || 0) + e.amount_cents;
    return acc;
  }, { all: 0 });
  const balanceCents = totals.all;

  const rows = [
    { label: 'Booking referrals',     cents: totals.booking   || 0 },
    { label: 'Spotlight payouts',     cents: totals.spotlight || 0 },
    { label: 'Friend joins + first booking', cents: totals.invite || 0 },
  ];

  const friendsInvited = 0;
  const servicesRecoed = 0;

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ✕
        </button>
      </div>

      <div className="px-5 pt-5 flex items-start justify-between">
        <div>
          <p className="text-body-sm font-extrabold text-b3 uppercase tracking-widest mb-1">Balance</p>
          <p className="text-[44px] font-extrabold text-black leading-none">
            {fmtDollars(balanceCents)}<span className="text-body-lg text-b3 font-extrabold ml-1">USD</span>
          </p>
        </div>
        <div className="w-14 h-14 rounded-full bg-gl border border-g/25 flex items-center justify-center">
          <span className="text-gd text-heading-1 font-extrabold">★</span>
        </div>
      </div>

      <p className="px-5 pt-8 pb-4 text-body-sm font-extrabold text-b3 uppercase tracking-widest">Breakdown</p>
      <div className="px-5 flex flex-col gap-4 mb-8">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-body-lg text-black">{r.label}</span>
            <span className="text-body-lg font-extrabold text-black">{fmtDollars(r.cents)}</span>
          </div>
        ))}
      </div>

      {balanceCents === 0 && (
        <div className="mx-5 mb-6 bg-soft rounded-[14px] p-4">
          <p className="text-body-sm text-b3 leading-snug">
            No earnings yet. Invite a friend or recommend a service to start your balance.
          </p>
        </div>
      )}

      <div className="mx-5 rounded-[20px] bg-gradient-to-br from-gm to-g p-5 mt-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 21c0-3 3-5 6-5s6 2 6 5"/><path d="M16 12c3 0 5 2 5 5"/></svg>
            </div>
            <div>
              <p className="text-body font-medium text-white/90">Friends invited</p>
              <p className="text-heading-1 font-extrabold text-white leading-tight">{friendsInvited}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/invite/friends-popup')}
            className="bg-transparent border border-white/80 rounded-[24px] px-4 py-2.5 text-body-sm font-extrabold text-white"
          >
            Invite more
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/></svg>
            </div>
            <div>
              <p className="text-body font-medium text-white/90">Services reco'd</p>
              <p className="text-heading-1 font-extrabold text-white leading-tight">{servicesRecoed}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/invite/recommend')}
            className="bg-transparent border border-white/80 rounded-[24px] px-4 py-2.5 text-body-sm font-extrabold text-white"
          >
            Reco more
          </button>
        </div>
        {/* CERGIO-GUARD: this used to navigate to /earnings/track,
            a mock-data screen. Until the real per-invite tracker
            ships (ROADMAP.md), funnel users to the earnings ledger
            which already shows real invite earnings rows. Label
            updated to match the destination. */}
        <button
          onClick={() => navigate('/earnings')}
          className="w-full text-center text-body-sm font-extrabold text-white mt-4 underline underline-offset-2"
        >
          See invite earnings ›
        </button>
      </div>
    </div>
  );
}
