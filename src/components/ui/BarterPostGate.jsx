// CERGIO-GUARD (2026-06-16, Tarik — SPEC-47i): the FORCED barter post-gate.
//
// When the SERVICE/provider has MARKED THE JOB COMPLETE (`completed_at`) and the
// Connector has NOT yet posted their IG spotlight, the Connector's whole app is
// BLOCKED on login with a "your turn" interstitial → "Rate & post to IG". They
// cannot use the rest of the app until they rate + post (or rate <4★, which holds
// the post via the dispute flow — that still counts as their turn, so the block
// releases the moment a review by them exists).
//
// If the provider has NOT marked complete, there is NO block — the Connector acts
// from the Inbox at their own pace (JobsInboxScreen "needsPost" CTA).
import { useState, useEffect, useCallback } from 'react';
import { getOutstandingFreeBarter } from '../../lib/api';
import { MarkBookingPostedModal } from './MarkBookingPostedModal';

export function BarterPostGate({ isSignedIn, userId }) {
  const [booking, setBooking] = useState(null);
  const [open, setOpen]       = useState(false);

  const refresh = useCallback(async () => {
    if (!isSignedIn) { setBooking(null); return; }
    try {
      const { outstanding } = await getOutstandingFreeBarter();
      const block =
        outstanding &&
        outstanding.completed_at &&        // provider marked the job complete
        !outstanding.posted_at &&          // connector hasn't posted yet
        !outstanding.post_confirmed_at &&
        !outstanding.reviewed;             // and hasn't already rated (held <4★)
      setBooking(block ? outstanding : null);
    } catch {
      setBooking(null); // never trap the user behind a failed fetch
    }
  }, [isSignedIn]);

  useEffect(() => { refresh(); }, [refresh]);
  // Re-check when the tab regains focus so the block clears right after posting
  // (e.g. they posted on IG in another tab, came back).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  if (!booking) return null;

  const providerFirst = (booking.provider?.display_name || 'The provider').split(' ')[0];
  const svcTitle = booking.service?.title || 'your free service';

  // While the rate+post modal is open it renders its own full-screen sheet on top.
  if (open) {
    return (
      <MarkBookingPostedModal
        booking={booking}
        connectorId={userId}
        onClose={() => setOpen(false)}
        onPosted={() => { setOpen(false); refresh(); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-cr flex items-center justify-center p-6">
      <div className="w-full max-w-[330px] text-center">
        <div className="w-14 h-14 rounded-full bg-gl flex items-center justify-center mx-auto mb-4">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="#4AA901" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-[22px] font-extrabold text-black leading-tight mb-2">
          {providerFirst} marked your service complete
        </h2>
        <p className="text-body-sm text-b3 leading-relaxed mb-6">
          Your turn — rate your <span className="font-extrabold text-black">{svcTitle}</span> and
          post your Instagram spotlight. That finishes the barter and unlocks your next free service.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="w-full bg-g text-white rounded-[14px] py-3.5 text-body font-extrabold hover:opacity-90 active:scale-[.98] transition-all"
        >
          Rate &amp; post to IG
        </button>
        <p className="text-meta-sm text-b2 mt-4 leading-snug">
          This is the last step of your free barter. It only takes a minute.
        </p>
      </div>
    </div>
  );
}
