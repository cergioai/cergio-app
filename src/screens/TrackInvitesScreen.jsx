// Per design-spec.md — Track invites with Friends / Services toggles (from video).
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Toggle } from '../components/ui/Toggle';
import { NETWORK_EARNINGS, BREAKDOWN } from '../data/mock';

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

export function TrackInvitesScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const [friendsOn, setFriendsOn]   = useState(true);
  const [servicesOn, setServicesOn] = useState(true);

  // Filter feed by what's toggled on
  const feed = NETWORK_EARNINGS.filter(item => {
    if (item.isSystem) return false;
    const isService = item.what?.toLowerCase().includes('service') || item.what?.toLowerCase().includes('housekeeper') || item.what?.toLowerCase().includes('hairstylist');
    if (isService) return servicesOn;
    return friendsOn;
  });

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>

      <h1 className="px-5 pt-3 pb-2 text-[28px] font-extrabold text-black tracking-tight">Track my invites</h1>
      <p className="px-5 pb-5 text-[14px] text-b3 leading-relaxed">
        Filter what you're tracking. Toggle each source to focus your feed.
      </p>

      {/* toggles */}
      <div className="px-5 flex flex-col gap-3 mb-6">
        <ToggleRow
          icon="people"
          title="Friends I've invited"
          sub={`${BREAKDOWN.friendsInvited} invited · earnings shown when active`}
          on={friendsOn}
          onChange={setFriendsOn}
        />
        <ToggleRow
          icon="briefcase"
          title="Services I've reco'd"
          sub={`${BREAKDOWN.servicesRecoed} recommended · earnings shown when active`}
          on={servicesOn}
          onChange={setServicesOn}
        />
      </div>

      {/* feed */}
      <p className="px-5 text-[16px] font-extrabold text-black mb-3">Activity</p>
      <div className="px-5 flex flex-col">
        {feed.length === 0 ? (
          <div className="bg-soft rounded-[18px] py-10 text-center">
            <p className="text-[14px] text-b3 leading-relaxed">
              Nothing to show.<br />Turn at least one toggle on.
            </p>
          </div>
        ) : feed.map(item => (
          <div key={item.id} className="flex items-center gap-3 py-3 border-b border-bdr">
            <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${item.avatarBg || 'from-g to-gd'}
                             flex items-center justify-center text-white text-[14px] font-extrabold flex-shrink-0`}>
              {getInitials(item.who)}
            </div>
            <div className="flex-1">
              <p className="text-[14px] text-black leading-tight">
                <span className="font-extrabold">{item.who}</span> {item.action}{' '}
                <span className="font-extrabold">{item.what}</span>
              </p>
            </div>
            <span className="text-[15px] font-extrabold text-black">{item.amount}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate('/earnings/transactions')}
        className="px-5 mt-5 text-[14px] font-extrabold text-black underline underline-offset-2 text-left"
      >
        See all transactions ›
      </button>
    </div>
  );
}

function ToggleRow({ icon, title, sub, on, onChange }) {
  const Icon = ICONS[icon];
  return (
    <div className="bg-soft rounded-[16px] p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-g flex items-center justify-center text-white flex-shrink-0">
        <Icon />
      </div>
      <div className="flex-1">
        <p className="text-[15px] font-extrabold text-black leading-tight">{title}</p>
        <p className="text-[12px] text-b3 mt-0.5">{sub}</p>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

const ICONS = {
  people:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 21c0-3 3-5 6-5s6 2 6 5"/><path d="M16 12c3 0 5 2 5 5"/></svg>,
  briefcase: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/></svg>,
};
