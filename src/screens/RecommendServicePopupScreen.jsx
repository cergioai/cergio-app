// Per design-spec.md — "Recommend a service" popup. Mirror of InviteFriendPopup.
// Single $250-per-friend hero — keeps the messaging consistent across every
// surface that mentions referral earnings.
import { useNavigate, useOutletContext } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';

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

        <div className="mt-10 mb-4 flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-[24px] font-extrabold text-black leading-tight tracking-tight">
              Recommend a service — ${REWARDS.perFriend} per friend
            </h1>
            <p className="text-[13px] text-b3 font-medium mt-2 leading-snug">
              Pick a contact, tell them what to book. You earn when they do.
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-g flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/></svg>
          </div>
        </div>

        <button
          onClick={() => navigate('/earnings/how')}
          className="text-[12px] font-bold text-g underline underline-offset-2 mb-5"
        >
          How earnings work →
        </button>

        <div className="border-t border-bdr -mx-7 px-7 pt-3 flex flex-col">
          <ActionRow icon="message" label="Recommend from contacts"
            sub="Pick a friend — we pre-fill their details automatically"
            onClick={() => navigate('/invite/friends?mode=reco')} />
          <ActionRow icon="pencil" label="Write a recommendation"
            sub="Free-form blurb explaining why you trust this service"
            onClick={() => navigate('/invite/recommend')} />
        </div>
      </div>
    </div>
  );
}

function ActionRow({ icon, label, sub, onClick }) {
  const Icon = ICONS[icon];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 py-3.5 border-b border-bdr last:border-0 text-left"
    >
      <div className="w-10 h-10 rounded-[10px] bg-g flex items-center justify-center text-white flex-shrink-0">
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-extrabold text-black leading-tight">{label}</p>
        {sub && <p className="text-[12px] text-b3 mt-0.5 leading-snug">{sub}</p>}
      </div>
      <span className="text-b3 text-lg">›</span>
    </button>
  );
}

const ICONS = {
  message: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  pencil:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>,
};
