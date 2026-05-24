// Per design-spec.md — notifies that a recommendation was received.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

const NOTIFICATION = {
  senderName: 'Gervon',
  badgeCount: 3,
  requests: [],
};

const TABS = ['Requests', 'Upcoming', 'Past'];

export function RecoNotificationScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const [activeTab, setActiveTab] = useState('Requests');
  const { senderName, badgeCount, requests } = NOTIFICATION;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      {/* dark notification banner */}
      <div className="mx-4 mt-4 bg-black rounded-[18px] p-4 flex items-center gap-3 cursor-pointer"
           onClick={() => navigate('/inbox')}>
        <div className="w-11 h-11 min-w-11 rounded-full border border-g/40
                        flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              stroke="#4AA901" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d="M12 8l1.09 2.26L15.5 10.5l-1.73 1.68.41 2.37L12 13.25l-2.18 1.3.41-2.37L8.5 10.5l2.41-.24L12 8z"
              fill="#4AA901"
            />
          </svg>
        </div>
        <p className="flex-1 text-[15px] font-extrabold text-white leading-tight">
          You received a recommendation from {senderName}!
        </p>
        <span className="text-white/60 text-base">›</span>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-6 px-5 pt-5 border-b border-bdr">
        {TABS.map(tab => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative pb-3 flex items-center gap-1.5"
            >
              <span className={`text-[14px] ${active ? 'font-extrabold text-black' : 'font-medium text-b3'}`}>
                {tab}
              </span>
              {active && tab === 'Requests' && badgeCount > 0 && (
                <div className="bg-g text-white text-[10px] font-extrabold rounded-full
                                min-w-[18px] h-[18px] flex items-center justify-center px-1.5">
                  {badgeCount}
                </div>
              )}
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-g rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* filters */}
      <div className="flex gap-2 px-5 py-3.5">
        {['Filter (All)', 'Status'].map(f => (
          <button
            key={f}
            onClick={() => showToast(`${f} — filters coming soon`)}
            className="border border-bdr rounded-pill px-3.5 py-1.5
                       text-[13px] font-semibold text-b2 bg-white"
          >
            {f}
          </button>
        ))}
      </div>

      {/* empty state */}
      <div className="px-5 pt-12 text-center">
        <p className="text-[14px] text-b3 leading-relaxed">
          {requests.length === 0
            ? <>No pending requests right now.<br />New Connector requests will appear here.</>
            : null}
        </p>
      </div>
    </div>
  );
}
