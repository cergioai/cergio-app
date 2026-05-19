// Per design-spec.md — Balance breakdown with footer invite/reco card.
import { useNavigate } from 'react-router-dom';
import { BREAKDOWN } from '../data/mock';

export function EarningsBreakdownScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      {/* close */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ✕
        </button>
      </div>

      {/* balance */}
      <div className="px-5 pt-5 flex items-start justify-between">
        <div>
          <p className="text-[13px] font-extrabold text-b3 uppercase tracking-widest mb-1">Balance</p>
          <p className="text-[44px] font-extrabold text-black leading-none">
            {BREAKDOWN.balance}<span className="text-[15px] text-b3 font-bold ml-1">.00 {BREAKDOWN.balanceUnit}</span>
          </p>
        </div>
        <div className="w-14 h-14 rounded-full bg-g flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </div>
      </div>

      {/* breakdown rows */}
      <p className="px-5 pt-8 pb-4 text-[13px] font-extrabold text-b3 uppercase tracking-widest">Breakdown</p>
      <div className="px-5 flex flex-col gap-5 mb-10">
        {BREAKDOWN.rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-[15px] text-black">{r.label}</span>
            <span className="text-[15px] font-extrabold text-black">{r.amount}</span>
          </div>
        ))}
      </div>

      {/* footer card */}
      <div className="mx-5 rounded-[20px] bg-gradient-to-br from-gm to-g p-5 mt-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 21c0-3 3-5 6-5s6 2 6 5"/><path d="M16 12c3 0 5 2 5 5"/></svg>
            </div>
            <div>
              <p className="text-[14px] font-medium text-white/90">Friends invited</p>
              <p className="text-[22px] font-extrabold text-white leading-tight">{BREAKDOWN.friendsInvited}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/invite/friends-popup')}
            className="bg-transparent border border-white/80 rounded-[24px] px-4 py-2.5 text-[13px] font-extrabold text-white"
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
              <p className="text-[14px] font-medium text-white/90">Services reco'd</p>
              <p className="text-[22px] font-extrabold text-white leading-tight">{BREAKDOWN.servicesRecoed}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/invite/recommend-popup')}
            className="bg-transparent border border-white/80 rounded-[24px] px-4 py-2.5 text-[13px] font-extrabold text-white"
          >
            Reco more
          </button>
        </div>
        <button
          onClick={() => navigate('/earnings/track')}
          className="w-full text-center text-[13px] font-bold text-white mt-4 underline underline-offset-2"
        >
          Track my invites
        </button>
      </div>
    </div>
  );
}
