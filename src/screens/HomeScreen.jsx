import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { CATEGORIES, FEED } from '../data/mock';

const BUNDLES = [
  { icon: '💍', label: 'Plan my wedding', task: 'Plan my wedding' },
  { icon: '🏠', label: 'Move in bundle',  task: 'Set up my new home' },
  { icon: '🎂', label: 'Birthday party',  task: 'Birthday party' },
  { icon: '🔨', label: 'Kitchen reno',    task: 'Renovate my kitchen' },
];

export function HomeScreen() {
  const navigate = useNavigate();
  const { showToast, startTask } = useOutletContext();
  const [activeCat, setActiveCat] = useState('cleaning');

  return (
    <div className="flex-1 overflow-y-auto pb-20 bg-cr">

      {/* header */}
      <div className="flex justify-between items-center px-5 pt-4">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="text-[13px] font-extrabold tracking-widest uppercase text-g">Cergio AI</span>
        </div>
        <button
          onClick={() => navigate('/profile')}
          className="w-10 h-10 rounded-full bg-gl flex items-center justify-center border-none text-lg cursor-pointer"
          aria-label="Profile"
        >
          👤
        </button>
      </div>

      {/* greeting */}
      <div className="px-5 pt-4 pb-1">
        <h1 className="text-[22px] font-extrabold text-black leading-tight">
          Hi there 👋<br />What do you <span className="text-g">need today?</span>
        </h1>
      </div>

      {/* search bar */}
      <div className="px-5 py-3">
        <div
          onClick={() => navigate('/intake')}
          className="flex items-center gap-2.5 bg-white border border-bdr rounded-pill
                     px-4 py-3 cursor-pointer transition-all hover:border-g hover:shadow-[0_0_0_3px_#F3FFEA]"
        >
          <span className="flex-1 text-[14px] text-b3 font-medium">Describe what you need…</span>
          <div className="w-9 h-9 bg-g rounded-full flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="2.5" />
              <path d="M16 16l4 4" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>

      {/* categories */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">Services</p>
      <div className="flex gap-2.5 overflow-x-auto px-5 pb-1 scrollbar-hide mb-5">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCat(cat.id); startTask(cat.label); }}
            className={`flex-shrink-0 flex items-center gap-1.5 border rounded-pill
                        px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all
                        ${activeCat === cat.id
                          ? 'border-g bg-gl text-gd'
                          : 'border-bdr bg-white text-b2 hover:border-g hover:bg-gl'}`}
          >
            <span className="text-base">{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* bundles */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">Bundle requests</p>
      <div className="flex flex-wrap gap-2 px-5 mb-6">
        {BUNDLES.map(b => (
          <button
            key={b.label}
            onClick={() => startTask(b.task)}
            className="bg-white border border-bdr rounded-pill px-3.5 py-1.5
                       text-[12px] font-bold text-b2 cursor-pointer hover:border-g hover:text-gd transition-colors"
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>

      {/* rainmaker banner */}
      <div
        onClick={() => navigate('/rainmakers')}
        className="mx-5 mb-5 p-4 rounded-[18px] bg-gradient-to-br from-[#0D0D0D] to-[#0F2418]
                   flex items-center gap-3.5 cursor-pointer"
      >
        <span className="text-[28px]">🌧️</span>
        <div className="flex-1">
          <p className="text-[14px] font-extrabold text-white mb-0.5">Are you a Rainmaker?</p>
          <p className="text-[12px] text-white/60 font-medium">Spotlight the best services and earn with them</p>
        </div>
        <span className="text-[18px] text-white/70">→</span>
      </div>

      {/* friend activity */}
      <p className="px-5 text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">Friends recently booked</p>
      {FEED.map(item => (
        <div key={item.id} className="mx-5 mb-3 bg-soft rounded-[20px] p-3.5 flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gl flex items-center justify-center text-lg flex-shrink-0">😊</div>
          <div>
            <p className="text-[13px] font-bold text-black">{item.name}</p>
            <p className="text-[12px] text-b3 font-medium mt-0.5">
              booked <span className="font-bold text-g">{item.service}</span>
            </p>
            <p className="text-[11px] text-b3 mt-1">{item.time}{item.saved ? ` · saved ${item.saved}` : ''}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
