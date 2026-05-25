// Per design-spec.md — post-submit confirmation: Cergio is hunting offers
// in the background. Wired to real chat state (no hardcoded "1145 Broadway"
// / "Wednesday, May 27" / "2 Bedroom, 1 Laundry, Needs Supplies"). The
// previous screen (ConfirmSubmit) forwards what/when/where/notes via
// router state; we also fall back to chat.state if the user lands here
// directly.
import { useNavigate, useLocation, useOutletContext } from 'react-router-dom';

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

      {/* avatars: requester + Connector badge */}
      <div className="flex items-center justify-center gap-3 pt-2 pb-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#4478aa] to-[#2a5070]
                        flex items-center justify-center text-white text-[20px] font-extrabold">
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

      {/* headline + body */}
      <div className="px-7 text-center">
        <h1 className="text-[24px] font-extrabold text-black mb-3 leading-tight">
          We're roaming for offers!
        </h1>
        <p className="text-[14px] text-b3 leading-relaxed font-medium">
          Cergio is negotiating offers for you. We'll notify you with a few
          options once they're confirmed.
        </p>
      </div>

      {/* Real request details — only rows with values render. No more
          hardcoded "1145 Broadway St" / "Wednesday, May 27". */}
      <div className="px-7 pt-8 flex flex-col gap-4 flex-1">
        {what  && <Row icon="user"     title={what} />}
        {notes && <Row icon="square"   title="Notes" sub={notes} />}
        {when  && <Row icon="calendar" title={when} />}
        {where && <Row icon="pin"      title={where} />}
        {!what && !when && !where && (
          <p className="text-[13px] text-b3 text-center font-medium leading-relaxed">
            No request details on file. Start over from <button
              onClick={() => navigate('/home')}
              className="text-g font-bold underline underline-offset-2"
            >Home</button> to send a new one.
          </p>
        )}
      </div>

      {/* CTAs */}
      <div className="px-5 pt-6 flex flex-col gap-3">
        <button
          onClick={() => navigate('/inbox')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[16px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Go to inbox
        </button>
        <button
          onClick={() => navigate('/find-friends')}
          className="w-full bg-white border border-bdr rounded-[24px] py-4 text-[14px] font-extrabold text-black"
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
        {sub && <p className="text-[13px] text-b3 mt-0.5 leading-snug">{sub}</p>}
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
