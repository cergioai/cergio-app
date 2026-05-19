// Per design-spec.md — Network earnings activity feed with All/Friends/Services tabs.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NETWORK_EARNINGS } from '../data/mock';

const TABS = ['All Activity', 'Friends', 'Services'];

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function NetworkEarningsScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('All Activity');

  // Mock additional items to make the feed feel real
  const feed = [
    ...NETWORK_EARNINGS,
    ...NETWORK_EARNINGS.map(i => ({ ...i, id: i.id + '-2', amount: '+$141.52' })),
  ];

  return (
    <div className="flex-1 flex flex-col bg-white pb-24 overflow-y-auto">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ‹
        </button>
      </div>

      <h1 className="px-5 pt-4 pb-5 text-[28px] font-extrabold text-black tracking-tight">
        Network earnings
      </h1>

      {/* tabs */}
      <div className="flex items-center gap-6 px-5 border-b border-bdr">
        {TABS.map(t => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="relative pb-3"
            >
              <span className={`text-[15px] ${active ? 'font-extrabold text-black' : 'font-medium text-b3'}`}>
                {t}
              </span>
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-black rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* feed */}
      <div className="px-5 flex flex-col">
        {feed.map(item => (
          <div key={item.id} className="flex items-center gap-3 py-4 border-b border-bdr last:border-0">
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
    </div>
  );
}
