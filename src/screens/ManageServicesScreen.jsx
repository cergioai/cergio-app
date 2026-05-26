// Per design-spec.md — provider manages their listed services.
// Pulls real data from Supabase when signed in; falls back to mock otherwise.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { MANAGED_SERVICES } from '../data/mock';
import { listMyServices } from '../lib/api';
import { useProviderReady } from '../hooks/useProviderReady';

const PHOTO_FALLBACKS = ['fv-jamie', 'fv-john', 'fv-steve'];

export function ManageServicesScreen() {
  const navigate = useNavigate();
  const { auth, showToast } = useOutletContext();
  const [services, setServices] = useState(null);   // null = loading
  // Gate the "List my service" CTAs on Stripe readiness, matching ProfileScreen.
  const provider = useProviderReady(auth);
  const gated = !!auth?.isSignedIn && !provider.loading && !provider.ready;
  // CERGIO-GUARD: do NOT block the user from publishing a listing on
  // Stripe verification. Stripe payouts activate asynchronously after
  // they finish onboarding — but the listing itself should publish
  // immediately. We only inform them; we always navigate.
  const handleListClick = () => {
    if (gated) {
      showToast(provider.hasAccount
        ? 'Payouts pending Stripe verification — listing will still publish.'
        : 'Heads up: set up payouts in Profile → Service view to receive payments.');
    }
    navigate('/list-service');
  };

  useEffect(() => {
    if (!auth?.isSignedIn) {
      setServices('mock');
      return;
    }
    let cancelled = false;
    listMyServices().then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setServices('mock'); return; }
      setServices(data || []);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]);

  // Until we know which mode we're in, show a small "Loading…" state.
  if (services === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cr">
        <p className="text-[14px] text-b3">Loading your services…</p>
      </div>
    );
  }

  const useMock = services === 'mock';
  const listed  = useMock ? MANAGED_SERVICES.listed      : services.filter(s => s.status === 'listed');
  const drafts  = useMock ? MANAGED_SERVICES.unpublished : services.filter(s => s.status === 'draft');

  return (
    <div className="flex-1 flex flex-col bg-cr pb-24 overflow-y-auto">
      {/* dark header */}
      <div className="bg-black px-5 pt-5 pb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center text-white text-xl"
        >
          ‹
        </button>
        <h1 className="text-[18px] font-extrabold text-white">Manage Services</h1>
      </div>

      {!useMock && listed.length === 0 && drafts.length === 0 && (
        <div className="px-5 pt-10 text-center">
          <p className="text-[18px] font-extrabold text-black">No services yet</p>
          <p className="text-[14px] text-b3 mt-2 mb-6">List your first service to start receiving bookings.</p>
          <button
            onClick={handleListClick}
            className="bg-g text-white rounded-[24px] px-8 py-3 text-[15px] font-extrabold"
          >
            List my service
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <p className="px-5 pt-6 pb-3 text-[22px] font-extrabold text-black">Unpublished</p>
          <div className="px-5 flex flex-col gap-3 mb-5">
            {drafts.map(s => (
              <button
                key={s.id}
                onClick={() => navigate(`/services/${s.id}`)}
                className="bg-white border border-bdr rounded-[18px] p-4 text-left"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-14 h-14 rounded-[12px] bg-gl flex items-center justify-center flex-shrink-0">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4AA901" strokeWidth="1.8">
                      <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                      <circle cx="12" cy="9" r="2.5" />
                    </svg>
                  </div>
                  <p className="text-[16px] font-extrabold text-black leading-tight flex-1">{s.title}</p>
                </div>
                <div className="border-t border-bdr -mx-4 px-4 pt-3 flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-[13px] font-extrabold text-black">{s.progressLabel || 'Finish your listing'}</p>
                    <p className="text-[11px] text-b3 mt-0.5">{s.progressSub || 'Service profile is incomplete'}</p>
                  </div>
                  <span className="text-b3 text-lg">›</span>
                </div>
                <div className="mt-2 h-1.5 bg-bdr rounded-full overflow-hidden">
                  <div className="h-full bg-g" style={{ width: `${(s.progress || 0.5) * 100}%` }} />
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {listed.length > 0 && (
        <>
          <p className="px-5 pt-2 pb-3 text-[22px] font-extrabold text-black">Listed</p>
          <div className="px-5 flex flex-col gap-3 mb-5">
            {listed.map((s, i) => (
              <button
                key={s.id}
                onClick={() => navigate(`/services/${s.id}`)}
                className="bg-white border border-bdr rounded-[18px] p-3 text-left flex items-center gap-3"
              >
                <div className={`w-16 h-16 rounded-[12px] flex-shrink-0 ${s.photo_class || s.photoClass || PHOTO_FALLBACKS[i % 3]}`} />
                <div className="flex-1">
                  <p className="text-[15px] font-extrabold text-black leading-tight">{s.title}</p>
                  <p className="text-[12px] text-b3 mt-0.5">{s.sub || s.category || s.description}</p>
                </div>
                <span className="text-b3 text-lg">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* List another */}
      <div className="px-5 pt-2">
        <button
          onClick={handleListClick}
          className="w-full border-2 border-dashed border-g bg-gl/40 rounded-[18px] py-4
                     text-[14px] font-extrabold text-g flex items-center justify-center gap-2"
        >
          <span className="text-xl leading-none">+</span> List another service
        </button>
      </div>
    </div>
  );
}
