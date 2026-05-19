// Per design-spec.md — Bottom-sheet popup for "Recommend a service" actions.
import { useNavigate, useOutletContext } from 'react-router-dom';

export function RecommendServicePopupScreen() {
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
              Recommend a service<br />and earn up to $250
            </h1>
          </div>
          <div className="w-14 h-14 rounded-full bg-g flex items-center justify-center flex-shrink-0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/></svg>
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
          <ActionRow icon="message" label="Invite from contacts" onClick={() => navigate('/invite/friends?mode=reco')} />
          <ActionRow icon="pencil"  label="Invite manually"      onClick={() => navigate('/invite/recommend')} />
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
  pencil:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>,
};
