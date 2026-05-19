// Per design-spec.md — Activity tab: unified feed of bookings/jobs/social.
import { ACTIVITY } from '../data/mock';

const TYPE_ICONS = {
  booked:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>,
  completed: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>,
  shared:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none"/></svg>,
  reco:      () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  invite:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="9" cy="9" r="3"/><path d="M16 11v6M19 14h-6M3 21c0-3 3-5 6-5s6 2 6 5"/></svg>,
};

const TYPE_BG = {
  booked:    'bg-g',
  completed: 'bg-g',
  shared:    'bg-black',
  reco:      'bg-black',
  invite:    'bg-g',
};

export function ActivityScreen() {
  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-[28px] font-extrabold text-black tracking-tight">Activity</h1>
        <p className="text-[14px] text-b3 mt-1">Bookings, jobs, and shares</p>
      </div>

      {/* filters */}
      <div className="flex gap-2 px-5 pb-3 overflow-x-auto scrollbar-hide">
        {['All', 'Bookings', 'Jobs', 'Shares', 'Recos'].map((f, i) => (
          <button
            key={f}
            className={`flex-shrink-0 border rounded-pill px-3.5 py-1.5 text-[13px] font-extrabold
              ${i === 0 ? 'bg-black text-white border-black' : 'bg-white text-b2 border-bdr'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* feed */}
      <div className="px-5 flex flex-col gap-2 pt-2">
        {ACTIVITY.map(item => {
          const Icon = TYPE_ICONS[item.type];
          return (
            <div key={item.id} className="bg-white border border-bdr rounded-[16px] p-4 flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${TYPE_BG[item.type]}`}>
                <Icon />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-extrabold text-black leading-tight">{item.title}</p>
                <p className="text-[13px] text-b3 mt-0.5">{item.sub}</p>
                <p className="text-[11px] text-b3 mt-1">{item.time}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
