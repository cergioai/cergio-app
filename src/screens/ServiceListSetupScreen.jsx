// Per design-spec.md — full-bleed loading screen while we actually persist
// the listing draft into Supabase, then advance to /verify.
//
// CERGIO-GUARD (2026-06-05 v2): identity gate per Tarik — "gate the
// user and services request with a Credit Card addition after
// submission, to verify identity". The createService call now waits
// behind CcGateModal when the provider hasn't yet verified, so spam
// listings never reach the marketplace. Already-verified providers
// proceed immediately as before.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { createService, getMyCcStatus } from '../lib/api';
import { CcGateModal } from '../components/ui/CcGateModal';

export function ServiceListSetupScreen() {
  const navigate = useNavigate();
  const { listingDraft, resetListingDraft, showToast } = useOutletContext();
  const [errorMessage, setErrorMessage] = useState(null);
  const [gateOpen, setGateOpen]   = useState(false);
  const [gateDismissed, setGateDismissed] = useState(false);
  const [verified, setVerified]   = useState(null); // null = loading, bool once resolved

  // Step 1: probe verification state on mount. Don't call createService
  // until we know whether to show the gate.
  useEffect(() => {
    let cancelled = false;
    getMyCcStatus().then(({ data }) => {
      if (cancelled) return;
      const ok = !!data?.cc_verified_at;
      setVerified(ok);
      if (!ok) setGateOpen(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Step 2: once verified, persist the listing. Runs both when the
  // initial probe finds the user already verified AND after the gate
  // closes with onVerified.
  useEffect(() => {
    if (verified !== true) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await createService(listingDraft);
      if (cancelled) return;
      if (error) {
        setErrorMessage(error.message);
        showToast(`Couldn't create service: ${error.message}`);
        return;
      }
      showToast('Service listed!');
      resetListingDraft();
      setTimeout(() => { if (!cancelled) navigate('/list-service/verify'); }, 800);
    })();

    return () => { cancelled = true; };
    // We deliberately want this to run once after verification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified]);

  // Escape hatch: gate was dismissed (user tapped "Maybe later") →
  // go straight to home. Previously this navigated back to
  // /list-service/about which left the user trapped in the listing flow
  // (back button cycled through listing steps, no visible exit).
  const handleGateDismiss = () => {
    setGateOpen(false);
    setGateDismissed(true);
    navigate('/home', { replace: true });
  };

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-b from-gm to-g relative overflow-hidden">
      <div className="px-5 pt-6 flex items-center justify-between">
        <button onClick={() => navigate('/list-service/about')} className="text-white text-2xl font-extrabold">‹</button>
        {/* Always-visible exit — gets the user to home even if the gate
            is loading or the dismiss navigation ever fails.             */}
        <button
          onClick={() => navigate('/home', { replace: true })}
          className="text-white/80 text-body font-extrabold px-2 py-1"
        >
          Exit
        </button>
      </div>

      <div className="absolute top-[42%] left-[28%] w-3 h-px bg-white/70" />
      <div className="absolute top-[40%] left-[48%] text-white/70 text-xs">+</div>
      <div className="absolute top-[46%] right-[26%] w-3 h-3 rounded-full border border-white/70" />

      {gateOpen && (
        <CcGateModal
          reason="listing"
          onClose={handleGateDismiss}
          onVerified={() => {
            setGateOpen(false);
            setVerified(true);
            showToast('Verified ✓ — publishing your listing');
          }}
        />
      )}

      <div className="flex-1 flex flex-col items-center justify-center -mt-12 px-7 text-center">
        {errorMessage ? (
          <>
            <p className="text-heading-1 font-extrabold text-white mb-2">We couldn't save your listing</p>
            <p className="text-body text-white/85 mb-6 max-w-[300px]">{errorMessage}</p>
            <button
              onClick={() => navigate('/list-service/about')}
              className="bg-white text-g rounded-[24px] px-8 py-3 text-body-lg font-extrabold"
            >
              Go back
            </button>
          </>
        ) : gateDismissed ? (
          /* Safety net: shouldn't render (navigate replaces this screen)
             but shows an exit if navigate failed for any reason.         */
          <>
            <p className="text-heading-2 font-extrabold text-white mb-4">Verification skipped</p>
            <button
              onClick={() => navigate('/list-service/about')}
              className="bg-white text-g rounded-[24px] px-8 py-3 text-body-lg font-extrabold"
            >
              Back to my listing
            </button>
          </>
        ) : (
          <>
            <svg width="68" height="68" viewBox="0 0 68 68" fill="none" className="animate-spin-slow mb-6">
              <path d="M 34 6 A 28 28 0 1 0 6 34" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-heading-2 font-extrabold text-white">Setting up your profile</p>
          </>
        )}
      </div>
    </div>
  );
}
