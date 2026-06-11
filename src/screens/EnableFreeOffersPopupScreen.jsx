// Per design-spec.md — first-time popup explaining the free-offers default.
// Shows toggle defaulted ON; user can turn off to pay normally.
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Toggle } from '../components/ui/Toggle';

export function EnableFreeOffersPopupScreen() {
  const navigate = useNavigate();
  const { freeServices, setFreeServices } = useOutletContext();

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* back chevron */}
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base shadow-card"
        >
          ‹
        </button>
      </div>

      {/* hero — brand badge with simple silhouette ring */}
      <div className="flex flex-col items-center pt-4 pb-2">
        <div className="relative w-44 h-44 flex items-center justify-center">
          {/* large soft mint backing */}
          <div className="absolute inset-0 rounded-full bg-gl" />
          {/* shield/Connector badge */}
          <div className="relative w-24 h-24 rounded-full bg-g flex items-center justify-center shadow-card">
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none"
                 stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z" fill="rgba(255,255,255,0.18)" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
        </div>
      </div>

      {/* headline + body */}
      <div className="px-7 pt-4 text-center">
        <h1 className="text-[24px] font-extrabold text-black leading-tight mb-3">
          You're defaulted to<br />free services
        </h1>
        <p className="text-body text-b3 leading-relaxed mb-6">
          You're currently defaulted to receiving free services in return for an Instagram post.
          This is a one-time pop up — after this you'll see a small toggle just above the
          search submit button.
        </p>
      </div>

      {/* toggle row */}
      <div className="mx-5 bg-soft rounded-[18px] px-4 py-4 flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-full bg-g flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="white" stroke="none" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-body font-extrabold text-black leading-tight">
            Free service for Instagram post
          </p>
          <p className="text-meta text-b3 mt-0.5">
            {freeServices ? 'On — you\'ll receive free offers' : 'Off — you\'ll pay normally'}
          </p>
        </div>
        <Toggle on={freeServices} onChange={setFreeServices} />
      </div>

      {/* CTA */}
      <div className="px-5 pt-2 pb-6 mt-auto">
        <button
          onClick={() => navigate('/confirm-submit')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
