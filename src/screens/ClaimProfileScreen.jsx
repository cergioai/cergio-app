// CERGIO-GUARD (2026-06-26, Tarik): claim-profile flow for recommended providers.
//
// Route: /claim?by=<recommenderId>&as=<serviceType>
//
// A provider gets a "claim your profile" SMS/email after being reco'd by phone
// (notify-user `service_recommended`). That link now lands HERE (previously it
// wrongly pointed at the recommender's /u/ page with no claim UI). Flow:
//   • Signed out → "you were reco'd as X by Y → Claim your profile" → /auth
//     (signup; phone is mandatory) with returnTo back to /claim.
//   • Signed in → auto-attach the pending recommendations made to this phone
//     (claim_recommendations RPC, phone-matched) → land them on their profile.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { claimRecommendations } from '../lib/api';

export function ClaimProfileScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { auth, showToast } = useOutletContext() || {};

  const byId = params.get('by') || null;
  const asType = (params.get('as') || '').trim();

  const [recommenderName, setRecommenderName] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimedCount, setClaimedCount] = useState(null); // null = not yet run

  // Who recommended them (for the headline).
  useEffect(() => {
    if (!supabaseReady || !byId) return;
    let cancelled = false;
    supabase.from('profiles').select('display_name').eq('id', byId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setRecommenderName(data?.display_name || ''); });
    return () => { cancelled = true; };
  }, [byId]);

  // Once signed in, attach the pending recos made to this phone.
  useEffect(() => {
    if (!auth?.isSignedIn || claiming || claimedCount !== null) return;
    let cancelled = false;
    setClaiming(true);
    claimRecommendations().then(({ data }) => {
      if (cancelled) return;
      setClaimedCount(Number(data) || 0);
      setClaiming(false);
    });
    return () => { cancelled = true; };
  }, [auth?.isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const goSignup = () => {
    const back = `/claim?${params.toString()}`;
    navigate(`/auth?returnTo=${encodeURIComponent(back)}`);
  };

  const recoLine = recommenderName
    ? `${recommenderName} recommended you${asType ? ` as a ${asType}` : ''} on Cergio.`
    : `You've been recommended${asType ? ` as a ${asType}` : ''} on Cergio.`;

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-y-auto pb-24">
      <div className="px-5 pt-7">
        <button
          onClick={() => navigate('/home')}
          aria-label="Close"
          className="w-9 h-9 rounded-full bg-white border border-bdr text-black text-body-lg flex items-center justify-center shadow-sm"
        >×</button>
      </div>

      <div className="px-5 pt-6">
        <div className="w-14 h-14 rounded-full bg-g text-white flex items-center justify-center mb-4">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"/><path d="M9 12l2 2 4-4"/>
          </svg>
        </div>
        <h1 className="text-display-2 font-extrabold text-black leading-tight">Claim your Cergio profile</h1>
        <p className="text-body-lg text-b2 leading-relaxed mt-3">{recoLine}</p>

        {!auth?.isSignedIn ? (
          <>
            <p className="text-body text-b3 leading-relaxed mt-4">
              Claim your free profile to collect your recommendations, add photos + a short story,
              and turn every booking into cash plus referrals from your own network.
            </p>
            <button
              onClick={goSignup}
              className="w-full bg-g text-white rounded-[24px] py-4 text-heading-2 font-extrabold mt-6
                         hover:opacity-90 active:scale-[.98] transition-all"
            >
              Claim your profile →
            </button>
          </>
        ) : claiming || claimedCount === null ? (
          <p className="text-body text-b3 font-medium mt-6">Attaching your recommendations…</p>
        ) : (
          <>
            <div className="mt-5 bg-white border border-line rounded-[16px] p-5">
              {claimedCount > 0 ? (
                <p className="text-body-lg text-black leading-relaxed">
                  <span className="font-extrabold text-gd">{claimedCount} recommendation{claimedCount === 1 ? '' : 's'}</span>{' '}
                  {claimedCount === 1 ? 'is' : 'are'} now on your profile. 🎉
                </p>
              ) : (
                <p className="text-body-lg text-black leading-relaxed">
                  Your profile is claimed. New recommendations will appear here as friends send them.
                </p>
              )}
            </div>
            <button
              onClick={() => navigate('/profile')}
              className="w-full bg-g text-white rounded-[24px] py-4 text-heading-2 font-extrabold mt-6
                         hover:opacity-90 active:scale-[.98] transition-all"
            >
              Go to my profile →
            </button>
            <button
              onClick={() => navigate('/list-service')}
              className="w-full bg-white border border-bdr text-black rounded-[24px] py-3.5 text-body font-extrabold mt-3
                         hover:bg-bg5/30 active:scale-[.99] transition-all"
            >
              List your service
            </button>
          </>
        )}
      </div>
    </div>
  );
}
