// Per design-spec.md — Bottom-sheet popup for invite/recommend actions.
// Single canonical "$250 per friend" headline — the $25/$125 stacking
// breakdown lives inside /earnings/how, NOT here. Don't surface the
// internal numbers at the entry point.
//
// CERGIO-GUARD: every Share action MUST actually work. No 'coming soon'
// toasts here — Web Share API first, clipboard fallback. The invite URL
// is generated client-side from the current window.location.origin so
// dev and prod just work without backend changes.
import { useNavigate } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';
import { buildInviteUrl } from '../lib/referral';

function buildInviteMessage(amount, url) {
  return `Hey — I'm using Cergio for booking trusted services. Join + book and we both win: $${amount} credit each. ${url}`;
}

export function InviteFriendPopupScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
  // CERGIO-GUARD: real attribution link — embeds the signed-in user's
  // UUID as ?ref=… so when their invitee signs up + books, earnings
  // credit comes back here. Signed-out users still see the modal but
  // their share link has no ref (just the bare origin); they should
  // sign in to earn.
  const inviteUrl = buildInviteUrl(auth?.user?.id);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast(auth?.isSignedIn
        ? 'Invite link copied ✓'
        : 'Link copied — sign in to earn from invites.');
    } catch {
      showToast('Copy unavailable on this device.');
    }
  };

  const shareNative = async () => {
    const msg = buildInviteMessage(REWARDS.perFriendUser, inviteUrl);
    try {
      if (navigator.share) {
        await navigator.share({ text: msg, title: 'Join me on Cergio', url: inviteUrl });
        return;
      }
    } catch { /* user cancelled */ return; }
    try {
      await navigator.clipboard.writeText(msg);
      showToast('Copied — paste it anywhere ✓');
    } catch {
      showToast('Share unavailable on this device.');
    }
  };

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
              Invite friends — ${REWARDS.perFriendUser} credit each
            </h1>
            <p className="text-body-sm text-b3 font-medium mt-2 leading-snug">
              Both of you get ${REWARDS.perFriendUser} credit when they join + book.{' '}
              <button
                type="button"
                onClick={() => navigate('/rainmaker/apply')}
                className="text-g underline underline-offset-2 font-extrabold"
              >
                Become a Connector → cash
              </button>
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-g flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </div>
        </div>

        <button
          onClick={() => navigate('/earnings/how')}
          className="text-meta font-extrabold text-g underline underline-offset-2 mb-5"
        >
          How earnings work →
        </button>

        <div className="border-t border-bdr -mx-7 px-7 pt-3 flex flex-col">
          <ActionRow icon="message" label="Invite from contacts" sub="Tap and pick — we send the message"
            onClick={() => navigate('/invite/friends')} />
          <ActionRow icon="link" label="Copy my invite link" sub="Paste it in any chat or DM"
            onClick={copyLink} />
          <ActionRow icon="dots" label="Share via…" sub="iMessage, WhatsApp, IG, more"
            onClick={shareNative} />
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
        {sub && <p className="text-meta text-b3 mt-0.5 leading-snug">{sub}</p>}
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
