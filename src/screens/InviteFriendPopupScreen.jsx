// Per design-spec.md — Bottom-sheet popup for invite/recommend actions.
// Copy + numbers pull from src/lib/rewards.js so the hero ($250 max),
// the "$25 when they join" base, and the +$125 first-booking bonus stay
// in lockstep across every surface that mentions earnings.
import { useNavigate } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';

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

        <div className="mt-10 mb-4 flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-[26px] font-extrabold text-black leading-tight tracking-tight">
              Invite a friend, earn up to ${REWARDS.maxPerInvite}
            </h1>
          </div>
          <div className="w-14 h-14 rounded-full bg-g flex items-center justify-center flex-shrink-0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </div>
        </div>

        {/* Step list — concrete numbers so the user knows exactly what they
            earn at each step. Replaces the old vague "25% of first few bookings". */}
        <ol className="mb-4 flex flex-col gap-2.5">
          <Step n="1" green={`+$${REWARDS.friendJoinCredit}`} body="when your friend signs up" />
          <Step n="2" green={`+$${REWARDS.friendFirstBookingBonus}`} body="when they complete their first booking" />
          <Step n="3" green={`up to $${REWARDS.maxPerInvite}`} body="total per invite as they keep booking" />
        </ol>
        <button
          onClick={() => navigate('/earnings/how')}
          className="text-[13px] font-bold text-g underline underline-offset-2 mb-6"
        >
          How earnings work →
        </button>

        <div className="border-t border-bdr -mx-7 px-7 pt-4 flex flex-col">
          <ActionRow icon="message" label="Invite from contacts" sub="Tap and pick — we send the message"
            onClick={() => navigate('/invite/friends')} />
          <ActionRow icon="link" label="Copy my invite link" sub="Paste it in any chat or DM"
            onClick={() => showToast('Your link has been copied!')} />
          <ActionRow icon="dots" label="Share via…" sub="iMessage, WhatsApp, IG, more"
            onClick={() => showToast('Share via system — coming soon')} />
        </div>
      </div>
    </div>
  );
}

// Numbered step — small green bubble + dollar amount in brand green +
// short description in body gray. Keeps every reward visible at once.
function Step({ n, green, body }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-6 h-6 rounded-full bg-gl text-gd text-[11px] font-extrabold
                       flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <p className="text-[14px] text-black leading-snug">
        <span className="text-g font-extrabold">{green}</span>{' '}
        <span className="text-b2 font-medium">{body}</span>
      </p>
    </li>
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
  link:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1-1"/></svg>,
  dots:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>,
};
