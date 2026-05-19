// Per design-spec.md — full-bleed loading screen while we actually persist
// the listing draft into Supabase, then advance to /verify.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { createService } from '../lib/api';

export function ServiceListSetupScreen() {
  const navigate = useNavigate();
  const { listingDraft, resetListingDraft, showToast } = useOutletContext();
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
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
    // We deliberately want this to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-b from-gm to-g relative overflow-hidden">
      <div className="px-5 pt-6">
        <button onClick={() => navigate(-1)} className="text-white text-2xl font-bold">‹</button>
      </div>

      <div className="absolute top-[42%] left-[28%] w-3 h-px bg-white/70" />
      <div className="absolute top-[40%] left-[48%] text-white/70 text-xs">+</div>
      <div className="absolute top-[46%] right-[26%] w-3 h-3 rounded-full border border-white/70" />

      <div className="flex-1 flex flex-col items-center justify-center -mt-12 px-7 text-center">
        {errorMessage ? (
          <>
            <p className="text-[20px] font-extrabold text-white mb-2">We couldn't save your listing</p>
            <p className="text-[14px] text-white/85 mb-6 max-w-[300px]">{errorMessage}</p>
            <button
              onClick={() => navigate(-1)}
              className="bg-white text-g rounded-[24px] px-8 py-3 text-[15px] font-extrabold"
            >
              Go back
            </button>
          </>
        ) : (
          <>
            <svg width="68" height="68" viewBox="0 0 68 68" fill="none" className="animate-spin-slow mb-6">
              <path d="M 34 6 A 28 28 0 1 0 6 34" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-[18px] font-extrabold text-white">Setting up your profile</p>
          </>
        )}
      </div>
    </div>
  );
}
