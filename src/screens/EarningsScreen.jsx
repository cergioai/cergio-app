// Per design-spec.md — Earnings tab: balance, network feed, invite cards.
import { useNavigate, useOutletContext } from 'react-router-dom';
import { NETWORK_EARNINGS } from '../data/mock';

// For demo: balance is $1000 (Cash-out eligible). Tarik can flip to $0 or $75.
const BALANCE = '$1000';
const BALANCE_UNIT = 'RC';
const CASH_OUT_THRESHOLD = 250; // numeric for compare; UI shows $250

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function EarningsScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const balanceNum = parseFloat(BALANCE.replace(/[^0-9.]/g, '')) || 0;
  const canCashOut = balanceNum >= CASH_OUT_THRESHOLD;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      <h1 className="px-5 pt-6 pb-4 text-[28px] font-extrabold text-black tracking-tight">Earnings</h1>

      {/* hero balance card — kelly-green gradient outer, white inner */}
      <div className="mx-5 rounded-[20px] bg-gradient-to-br from-gm to-g p-3 mb-5 shadow-card">
        <div className="bg-white rounded-[14px] p-4 flex items-center justify-between">
          <div>
            <p className="text-[28px] font-extrabold text-black leading-none">
              {BALANCE}<span className="text-[14px] text-b3 font-bold ml-1">.00 {BALANCE_UNIT}</span>
            </p>
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

      {/* latest network earnings */}
      <p className="px-5 text-[16px] font-extrabold text-black mb-3">Latest network earnings</p>
      {NETWORK_EARNINGS.length === 0 ? (
        <div className="mx-5 bg-soft rounded-[18px] py-10 text-center">
          <p className="text-[14px] text-b3 leading-relaxed">
            You haven't received<br />earnings from redeemed invites
          </p>
        </div>
      ) : (
        <div className="px-5 flex flex-col gap-3 mb-2">
          {NETWORK_EARNINGS.slice(0, 3).map(item => (
            <div key={item.id} className="flex items-center gap-3 py-2 border-b border-bdr last:border-0">
              {item.isSystem ? (
                <div className="w-11 h-11 rounded-full bg-g flex items-center justify-center flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                </div>
              ) : (
                <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${item.avatarBg}
                                 flex items-center justify-center text-white text-[14px] font-extrabold flex-shrink-0`}>
                  {getInitials(item.who)}
                </div>
              )}
              <div className="flex-1">
                <p className="text-[14px] text-black leading-tight">
                  <span className="font-extrabold">{item.who}</span> {item.action}{' '}
                  <span className="font-extrabold">{item.what}</span>
                </p>
              </div>
              <span className="text-[15px] font-extrabold text-black flex-shrink-0">{item.amount}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => navigate('/earnings/network')}
        className="px-5 mb-6 text-[14px] font-extrabold text-black underline underline-offset-2 text-left"
      >
        View all network earnings (154) ›
      </button>

      {/* Earn up to $250 per invite */}
      <div className="flex items-center gap-1.5 px-5 mb-3">
        <p className="text-[16px] font-extrabold text-black">Earn up to $250 per invite</p>
        <button
          onClick={() => navigate('/earnings/how')}
          className="w-5 h-5 rounded-full border border-black flex items-center justify-center text-[10px] font-extrabold"
        >
          i
        </button>
      </div>
      <div className="px-5 flex flex-col gap-2 mb-6">
        <ActionCard
          onClick={() => navigate('/invite/friends-popup')}
          icon="people"
          label="Invite friends"
          right={<span className="text-[13px] text-g font-bold">23 joined</span>}
        />
        <ActionCard
          onClick={() => navigate('/invite/recommend-popup')}
          icon="briefcase"
          label="Recommend services"
          right={<span className="text-[13px] text-g font-bold">13 joined</span>}
        />
        <ActionCard
          onClick={() => navigate('/earnings/track')}
          icon="track"
          label="Track my invites"
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
