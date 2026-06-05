// Per design-spec.md — Step 2: confirm request + payment + submit.
// Wired to real chat.state (no hardcoded "Housekeeper" / "VISA *5329" /
// fake photo blocks). When a field is missing, we render an "Add" affordance
// instead of a placeholder string the user would mistake for a real value.
//
// CERGIO-GUARD (2026-06-05 v2): identity gate per Tarik — "gate the
// user and services request with a Credit Card addition after submission,
// to verify identity ... to avoid bad content spam etc." Submit button
// now opens CcGateModal first if the user isn't verified; on success it
// continues to /roaming. Verified users skip the modal.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { CcGateModal } from '../components/ui/CcGateModal';
import { getMyCcStatus } from '../lib/api';

export function ConfirmSubmitScreen() {
  const navigate = useNavigate();
  const { chat, auth, showToast } = useOutletContext();
  const { what, when, where, notes, photos } = chat.state || {};

  // Real attached photos (if chat captured any). The old static `PHOTOS`
  // grid is gone — empty array = the photo block doesn't render at all.
  const realPhotos = Array.isArray(photos) ? photos : [];

  // Identity-verification state. Pulled from profiles.cc_verified_at on
  // mount; null while loading, boolean once resolved. While unresolved
  // the gate stays armed (worst case we show the modal once unnecessarily,
  // never the reverse).
  const [verified,   setVerified]   = useState(null);
  const [showCcGate, setShowCcGate] = useState(false);
  useEffect(() => {
    if (!auth?.isSignedIn) { setVerified(false); return; }
    let cancelled = false;
    getMyCcStatus().then(({ data }) => {
      if (cancelled) return;
      setVerified(!!data?.cc_verified_at);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  const finishSubmit = () => {
    navigate('/roaming', { state: { what, when, where, notes } });
  };

  const onSubmit = () => {
    if (!auth?.isSignedIn) {
      showToast('Sign in to submit your request');
      navigate('/auth');
      return;
    }
    if (verified === false) {
      setShowCcGate(true);
      return;
    }
    finishSubmit();
  };

  return (
    <div className="flex-1 flex flex-col bg-cream">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 bg-white border-b border-bdr">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ‹
        </button>
        <p className="text-[13px] font-bold text-b3">Step 2 — Submit Request</p>
        <div className="w-10" />
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="bg-white px-5 pt-6 pb-5">
          <h1 className="text-[24px] font-extrabold text-black mb-5 leading-tight">Confirm and submit</h1>

          {/* service row — real value from chat, "Add" affordance if missing */}
          <button
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-between py-2 mb-2 text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="3" y="6" width="18" height="14" rx="2" />
                <path d="M9 6V4h6v2" />
              </svg>
              {what
                ? <span className="text-[16px] font-extrabold text-black">{what}</span>
                : <span className="text-[14px] font-bold text-danger">Add service</span>}
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>

          {/* notes + real attached photos (only render if present) */}
          {(notes || realPhotos.length > 0) && (
            <div className="pl-9 mb-4">
              {notes && (
                <p className="text-[13px] text-black leading-relaxed mb-3">{notes}</p>
              )}
              {realPhotos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {realPhotos.slice(0, 4).map((src, i) => (
                    <img
                      key={i}
                      src={typeof src === 'string' ? src : src?.dataUrl}
                      alt={`Attachment ${i + 1}`}
                      className="aspect-square rounded-[8px] object-cover border border-bdr"
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* location row */}
          <button
            onClick={() => navigate(-1)}
            className="w-full border-t border-bdr py-4 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              {where
                ? <span className="text-[15px] text-black truncate max-w-[260px]">{where}</span>
                : <span className="text-[14px] font-bold text-danger">Add address</span>}
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>

          {/* date row */}
          <button
            onClick={() => navigate(-1)}
            className="w-full border-t border-bdr py-4 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M3 10h18M8 2v4M16 2v4" />
              </svg>
              {when
                ? <span className="text-[15px] text-black">{when}</span>
                : <span className="text-[14px] font-bold text-danger">Add date / time</span>}
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>
        </div>

        {/* Payment section.
            CERGIO-GUARD: we use Stripe PaymentElement (inside
            PaymentSheet on Results → handleBook) when the user actually
            tries to BOOK. The "Add a payment method" affordance HERE on
            the request-submit screen is informational only — the actual
            card capture happens at booking time, gated by CcGateModal.
            Removed the lying 'Card on file — coming soon' toast; the
            sub-text now explains the real flow. */}
        <div className="bg-white mt-3 px-5 py-5">
          <p className="text-[14px] font-extrabold uppercase tracking-widest text-b3 mb-3">Payment</p>
          <div className="w-full flex items-center justify-between py-2 text-left">
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
              </svg>
              <span className="text-[14px] font-bold text-b2">Card collected at booking</span>
            </div>
          </div>
          <p className="text-[11px] text-b3 mt-1 leading-snug">
            You only pay when you confirm a provider's offer — we'll ask
            for a card then. No charge for submitting the request.
          </p>
          <div className="flex items-start gap-2 mt-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4AA901" strokeWidth="2" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span className="text-[12px] text-g font-bold leading-relaxed">
              You won't be charged until your booking is confirmed.
            </span>
          </div>
        </div>
      </div>

      {/* CTA — disabled until the three required fields are present */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white px-5 py-5 border-t border-bdr">
        <button
          onClick={onSubmit}
          disabled={!what || !when || !where}
          className={`w-full rounded-[24px] py-4 text-[16px] font-extrabold transition-all
            ${(what && when && where)
              ? 'bg-black text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Submit request
        </button>
      </div>

      {/* Identity gate — surfaced after Submit when the user hasn't yet
          verified. On success continues to /roaming so the submit-->
          search round-trip stays seamless. */}
      {showCcGate && (
        <CcGateModal
          reason="request"
          onClose={() => setShowCcGate(false)}
          onVerified={() => {
            setVerified(true);
            setShowCcGate(false);
            showToast('Verified ✓ — submitting your request');
            setTimeout(() => finishSubmit(), 0);
          }}
        />
      )}
    </div>
  );
}
