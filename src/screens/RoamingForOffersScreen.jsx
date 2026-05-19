// Per design-spec.md — post-submit confirmation: Cergio is hunting offers in background.
import { useNavigate } from 'react-router-dom';

const REQUEST = {
  category: 'Housekeepers',
  detail:   'Apartment Clean',
  details2: '2 Bedroom, 1 Laundry, Needs Supplies',
  date:     'Wednesday, May 27',
  time:     'at 10:00 AM',
  line1:    '1145 Broadway St',
  line2:    'New York, NY',
};

function getInitials(s) {
  return s.split(' ').map(x => x[0] || '').join('').slice(0, 2).toUpperCase();
}

export function RoamingForOffersScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-cr pb-8 overflow-y-auto">
      {/* close */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate('/home')}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ✕
        </button>
      </div>

      {/* avatars: requester + Rainmaker badge */}
      <div className="flex items-center justify-center gap-3 pt-2 pb-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#4478aa] to-[#2a5070]
                        flex items-center justify-center text-white text-[22px] font-extrabold">
          You
        </div>
        <div className="w-20 h-20 rounded-full bg-gl flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-g flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="rgba(255,255,255,0.18)" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
        </div>
      </div>

      {/* headline + body — updated copy per Tarik */}
      <div className="px-7 text-center">
        <h1 className="text-[24px] font-extrabold text-black mb-3">We're roaming for offers!</h1>
        <p className="text-[15px] text-b3 leading-relaxed">
          Cergio is roaming and negotiating offers for you. We'll notify you with a few options
          once they're confirmed.
        </p>
      </div>

      {/* request details */}
      <div className="px-7 pt-8 flex flex-col gap-4 flex-1">
        <Row icon="user" title={REQUEST.category} />
        <Row icon="square" title={REQUEST.detail} sub={REQUEST.details2} />
        <Row icon="calendar" title={REQUEST.date} sub={REQUEST.time} />
        <Row icon="pin" title={REQUEST.line1} sub={REQUEST.line2} />
      </div>

      {/* CTAs */}
      <div className="px-5 pt-6 flex flex-col gap-3">
        <button
          onClick={() => navigate('/inbox')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Go to inbox
        </button>
        <button
          onClick={() => navigate(-1)}
          className="w-full bg-soft rounded-[24px] py-4 text-[15px] font-extrabold text-b2"
        >
          Share request with friends
        </button>
      </div>
    </div>
  );
}

function Row({ icon, title, sub }) {
  const Icon = ICONS[icon];
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center flex-shrink-0">
        <Icon />
      </div>
      <div className="flex-1">
        <p className="text-[15px] font-extrabold text-black leading-tight">{title}</p>
        {sub && <p className="text-[13px] text-b3 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const ICONS = {
  user:     () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><circle cx="12" cy="9" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" strokeLinecap="round"/></svg>,
  square:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  calendar: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>,
  pin:      () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>,
};
