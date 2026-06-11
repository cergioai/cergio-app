// Post-submit "we're working on it" screen.
//
// The hardcoded "We're roaming for offers!" line has been replaced by a
// live Claude-style status ticker that cycles through the real steps:
//   1. Connecting with your friends' recommended providers
//   2. Notifying providers
//   3. Negotiating on your behalf
//   4. Watching for offers
// The cycle loops until the user navigates away — so they actually see
// something happening instead of a frozen confirmation. The request
// details (what/when/where/notes) come from router-state (passed by
// ConfirmSubmit) or fall back to live chat.state.
import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';

const STATUS_LINES = [
  "Connecting with your friends' recommended providers",
  'Notifying providers',
  'Negotiating on your behalf',
  'Watching for offers',
];

export function RoamingForOffersScreen() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { chat }  = useOutletContext() || {};

  // Prefer router-state (passed by ConfirmSubmit), then fall back to live
  // chat state. Either source — empty fields render an Add-style affordance.
  const from = location.state || {};
  const what  = from.what  ?? chat?.state?.what  ?? null;
  const when  = from.when  ?? chat?.state?.when  ?? null;
  const where = from.where ?? chat?.state?.where ?? null;
  const notes = from.notes ?? chat?.state?.notes ?? null;

  // Status ticker — advance every 1.4s, loop forever until the user leaves.
  const [statusIdx, setStatusIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStatusIdx(i => (i + 1) % STATUS_LINES.length);
    }, 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-cream pb-8 overflow-y-auto">
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

      {/* avatars: requester + animated leaf */}
      <div className="flex items-center justify-center gap-3 pt-2 pb-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#4478aa] to-[#2a5070]
                        flex items-center justify-center text-white text-[20px] font-extrabold">
          You
        </div>
        <div className="w-20 h-20 rounded-full bg-gl flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-g flex items-center justify-center cg-leaf-btn-working">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                 className="cg-leaf-open" style={{ transformOrigin: '50% 70%' }}>
              <path d="M12 22V13" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <path
                d="M12 13c-4 0-7-3-7-7 0-1.2.3-2.3.7-3.3C7.2 3.6 9.5 5 12 5s4.8-1.4 6.3-2.3c.4 1 .7 2.1.7 3.3 0 4-3 7-7 7z"
                fill="white"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* headline + live status ticker */}
      <div className="px-7 text-center">
        <h1 className="text-heading-1 font-extrabold text-black mb-3 leading-tight">
          Cergio is on it
        </h1>
        <div className="flex items-center justify-center gap-2" aria-live="polite">
          <span className="w-1.5 h-1.5 rounded-full bg-g animate-pulse flex-shrink-0" />
          <p className="text-body-sm text-gd font-extrabold leading-snug">
            {STATUS_LINES[statusIdx]}…
          </p>
        </div>
        <p className="text-meta text-b3 leading-relaxed font-medium mt-3">
          We'll notify you with a few options once offers come in.
        </p>
      </div>

      {/* Request details — only rows with values render. */}
      <div className="px-7 pt-7 flex flex-col gap-4 flex-1">
        {what  && <Row icon="user"     title={what} />}
        {notes && <Row icon="square"   title="Notes" sub={notes} />}
        {when  && <Row icon="calendar" title={when} />}
        {where && <Row icon="pin"      title={where} />}
        {!what && !when && !where && (
          <p className="text-body-sm text-b3 text-center font-medium leading-relaxed">
            No request details on file. Start over from <button
              onClick={() => navigate('/home')}
              className="text-g font-extrabold underline underline-offset-2"
            >Home</button> to send a new one.
          </p>
        )}
      </div>

      {/* CTAs */}
      <div className="px-5 pt-6 flex flex-col gap-3">
        <button
          onClick={() => navigate('/inbox')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Go to inbox
        </button>
        <button
          onClick={() => navigate('/find-friends')}
          className="w-full bg-white border border-bdr rounded-[24px] py-4 text-body font-extrabold text-black"
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
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-extrabold text-black leading-tight">{title}</p>
        {sub && <p className="text-body-sm text-b3 mt-0.5 leading-snug">{sub}</p>}
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
