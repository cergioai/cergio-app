// Per design-spec.md — Bottom-sheet popup for invite/recommend actions.
import { useNavigate } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';

export function InviteFriendPopupScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();

  return (
    <div className="flex-1 flex flex-col bg-black/60">
      <div className="flex-1" onClick={() => navigate(-1)} />
      <div className="bg-white rounded-t-[24px] px-7 pt-6 pb-8 relative">
        <button
          onClick={() => navigate(-1)}
          className="absolute top-5 left-5 w-9 h-9 rounded-full border border-bdr
                     flex items-center justify-center text-black"
        >
          ✕
        </button>

        <div className="mt-10 mb-5 flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-[24px] font-extrabold text-black leading-tight">
              Invite a friend and<br />earn up to $250
            </h1>
          </div>
          <div className="w-14 h-14 rounded-full bg-g flex items-center justify-center flex-shrink-0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </div>
        </div>

        <p className="text-[14px] text-b3 leading-relaxed mb-3">
          You will earn 25% of the first few bookings your friend completes, up to $250.
        </p>
        <button
          onClick={() => navigate('/earnings/how')}
          className="text-[14px] font-bold text-g underline underline-offset-2 mb-6"
        >
          See examples
        </button>

        <div className="border-t border-bdr -mx-7 px-7 pt-4 flex flex-col">
          <ActionRow icon="message" label="Invite from contacts" onClick={() => navigate('/invite/friends')} />
          <ActionRow icon="link"    label="Copy invite link"     onClick={() => showToast('Your link has been copied!')} />
          <ActionRow icon="dots"    label="More"                 onClick={() => showToast('Share via system — coming soon')} />
        </div>
      </div>
    </div>
  );
}

function ActionRow({ icon, label, onClick }) {
  const Icon = ICONS[icon];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 py-4 border-b border-bdr last:border-0 text-left"
    >
      <div className="w-10 h-10 rounded-[10px] bg-g flex items-center justify-center text-white flex-shrink-0">
        <Icon />
      </div>
      <span className="flex-1 text-[16px] font-extrabold text-black">{label}</span>
      <span className="text-b3 text-lg">›</span>
    </button>
  );
}

const ICONS = {
  message: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  link:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1-1"/></svg>,
  dots:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>,
};
