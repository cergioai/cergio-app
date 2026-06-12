// Per design-spec.md — provider's view: their profile was shared on a Connector's IG.
import { useNavigate, useOutletContext } from 'react-router-dom';

const SHARE = {
  rainmakerName: 'Reyna',
  instagramHandle: 'ReynaReynolds',
  followerCount: 6974,
  followersOnFeed: '6,375',
  authorFirstName: 'Gervon',
};

export function ProfileSharedScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const s = SHARE;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">
      {/* back */}
      <div className="px-5 pt-4 pb-2">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-card border border-bdr
                     flex items-center justify-center text-b2"
        >
          ←
        </button>
      </div>

      {/* heading */}
      <div className="px-5 pt-3 pb-6">
        <h1 className="text-display-2 font-extrabold text-black leading-tight mb-2">
          {s.rainmakerName} shared your profile!
        </h1>
        <p className="text-body text-b3 leading-relaxed">
          Your profile has been shared to {s.followersOnFeed} followers on {s.authorFirstName}'s Instagram feed!
        </p>
      </div>

      {/* IG-style preview card */}
      <div className="mx-5 bg-card rounded-[20px] overflow-hidden mb-5">
        {/* header */}
        <div className="flex items-center justify-between p-3.5">
          <div className="flex items-center gap-2.5">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#111114" strokeWidth="1.8">
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="#111114" stroke="none" />
            </svg>
            <div>
              <p className="text-body font-extrabold text-black">{s.instagramHandle}</p>
              <p className="text-meta text-b3">{s.followerCount.toLocaleString()} followers</p>
            </div>
          </div>
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-g to-gd
                          flex items-center justify-center text-white font-extrabold text-meta">
            {s.rainmakerName[0]}
          </div>
        </div>

        {/* "image" placeholder using gradient */}
        <div className="fv-jamie h-[260px] relative">
          <button
            onClick={() => showToast('Open Instagram — coming later')}
            className="absolute bottom-3 right-3 bg-black text-white text-meta
                       font-extrabold px-3 py-2 rounded-pill"
          >
            See Instagram
          </button>
        </div>
      </div>

      {/* CTAs */}
      <div className="mt-auto px-5 pt-4 pb-2 flex flex-col gap-3 items-center">
        <button
          onClick={() => navigate('/complete')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Looks amazing
        </button>
        <button
          onClick={() => { showToast('Reported. We\'ll look into it.'); navigate(-1); }}
          className="text-body font-extrabold text-b3"
        >
          Something's wrong
        </button>
      </div>
    </div>
  );
}
