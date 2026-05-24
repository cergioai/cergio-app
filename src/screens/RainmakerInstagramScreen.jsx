// Per design-spec.md — step 3 of Rainmaker reg, Instagram connect.
// Now uses the shared InstagramConnectModal which doubles as the entry
// point for the future Instagram OAuth flow. Persists handle + follower
// count to profiles via saveInstagram.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { InstagramConnectModal } from '../components/ui/InstagramConnectModal';
import { getMyInstagram, saveInstagram } from '../lib/api';

function fmtFollowers(n) {
  if (!Number.isFinite(+n)) return '';
  const x = +n;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

export function RainmakerInstagramScreen() {
  const navigate = useNavigate();
  const { showToast, auth } = useOutletContext();
  const [handle,    setHandle]    = useState('');
  const [followers, setFollowers] = useState(null);
  const [verifiedAt, setVerifiedAt] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Pre-fill if the user already connected Instagram earlier (e.g. they
  // started the Rainmaker flow, bounced, and came back).
  useEffect(() => {
    if (!auth?.isSignedIn) return;
    getMyInstagram().then(({ data }) => {
      if (data?.instagram_handle) {
        setHandle(data.instagram_handle);
        setFollowers(data.instagram_followers ?? null);
        setVerifiedAt(data.instagram_verified_at ?? null);
      }
    });
  }, [auth?.isSignedIn]);

  const connected = !!handle;

  const onSave = async ({ handle: h, followers: f }) => {
    const { data, error } = await saveInstagram({ handle: h, followers: f });
    if (error) throw new Error(error.message);
    setHandle(data?.instagram_handle ?? h);
    setFollowers(data?.instagram_followers ?? f ?? null);
    setVerifiedAt(data?.instagram_verified_at ?? null);
    showToast?.('Instagram saved ✓');
    setShowModal(false);
  };

  return (
    <div className="flex-1 flex flex-col bg-cr">
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-12 pb-14 flex flex-col justify-end min-h-[440px]">
        <h1 className="text-[28px] font-extrabold text-white leading-tight mb-2">
          Connect your<br />Instagram
        </h1>
        <p className="text-[14px] text-white/85">
          We pull your follower count so Cergio providers know the reach you offer.
        </p>
      </div>

      <div className="bg-cr rounded-t-[28px] -mt-7 px-7 pt-7 flex-1 pb-32">
        {connected ? (
          <div className="bg-white border border-bdr rounded-[18px] p-4 flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-[14px] bg-black flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                   stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" />
                <circle cx="12" cy="12" r="4.5" />
                <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-extrabold text-black leading-tight">
                @{handle}
                {verifiedAt && (
                  <span className="ml-1.5 inline-flex items-center gap-1 bg-gl text-gd rounded-pill px-2 py-0.5 text-[10px] font-extrabold align-middle">
                    ✓ Verified
                  </span>
                )}
              </p>
              <p className="text-[12px] text-b3 mt-0.5">
                {followers != null
                  ? `${fmtFollowers(followers)} followers · reach providers can count on`
                  : 'Add your follower count for better offers'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="text-[12px] font-extrabold text-g underline underline-offset-2"
            >
              Edit
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="w-full bg-black text-white rounded-[16px] py-4 text-[15px] font-extrabold
                       hover:opacity-90 active:scale-[.97] transition-all flex items-center justify-center gap-2 mb-4"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
            </svg>
            Connect Instagram
          </button>
        )}

        <p className="text-[12px] text-b3 leading-relaxed mt-2">
          Your follower count helps providers price the free service exchange. Once Instagram
          OAuth ships, we'll auto-verify — until then, your entries are confirmed in the
          background when you start posting spotlights.
        </p>
      </div>

      {/* progress — almost full */}
      <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
        <div className="h-full bg-g" style={{ width: '85%' }} />
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr px-5 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-[15px] font-extrabold text-black underline underline-offset-2"
        >
          Back
        </button>
        <button
          onClick={() => connected && navigate('/rainmaker/apply/submitted')}
          disabled={!connected}
          className={`rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold transition-all
            ${connected
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Submit
        </button>
      </div>

      {showModal && (
        <InstagramConnectModal
          initialHandle={handle}
          initialFollowers={followers ?? ''}
          title="Connect your Instagram"
          subtitle="Rainmakers use Instagram to spotlight free services. We pull your handle + follower count."
          onSave={onSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
