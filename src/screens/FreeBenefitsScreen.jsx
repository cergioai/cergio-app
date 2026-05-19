// Per design-spec.md — uses tokens only.
// Information page: explains the Free Service Benefits program.
import { useNavigate } from 'react-router-dom';

export function FreeBenefitsScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20 overflow-y-auto">

      {/* close */}
      <div className="px-5 pt-4">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-card border border-bdr
                     flex items-center justify-center text-b2 text-base"
        >
          ✕
        </button>
      </div>

      {/* hero — single circular brand badge instead of avatar cluster */}
      <div className="flex flex-col items-center pt-6 pb-8">
        <div className="w-28 h-28 rounded-full bg-g flex items-center justify-center
                        shadow-card mb-1">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z"
                  fill="rgba(255,255,255,0.18)" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
      </div>

      {/* headline */}
      <h1 className="text-[28px] font-extrabold text-black text-center leading-tight px-7 mb-8">
        Free Service Benefits
      </h1>

      {/* benefits */}
      <div className="px-7 flex flex-col gap-7 flex-1">
        <div>
          <div className="flex items-start gap-4 mb-3">
            <div className="w-11 h-11 min-w-11 rounded-full bg-gl flex items-center justify-center mt-0.5">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                  fill="#3D8B00"
                />
              </svg>
            </div>
            <p className="text-[16px] font-extrabold text-black leading-tight pt-1.5">
              Mega-exposure on social media
            </p>
          </div>
          <div className="ml-15 pl-1">
            <p className="text-[14px] text-b3 leading-relaxed mb-3" style={{ marginLeft: 60 }}>
              Rainmakers that book a free service are required to share positive booking experiences
              with their social network and add to their Reco list.
            </p>
            <p className="text-[14px] text-b3 leading-relaxed" style={{ marginLeft: 60 }}>
              Get your Cergio profile seen by thousands of potential clients on social apps
              like Instagram.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-start gap-4 mb-3">
            <div className="w-11 h-11 min-w-11 rounded-full bg-gl flex items-center justify-center mt-0.5">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                  fill="#3D8B00"
                />
              </svg>
            </div>
            <p className="text-[16px] font-extrabold text-black leading-tight pt-1.5">
              Instant verification
            </p>
          </div>
          <div className="ml-15 pl-1">
            <p className="text-[14px] text-b3 leading-relaxed mb-3" style={{ marginLeft: 60 }}>
              Complete a free service with a Cergio expert and become instantly verified
              when you are rated 4+ stars.
            </p>
            <p className="text-[14px] text-b3 leading-relaxed" style={{ marginLeft: 60 }}>
              Your verified service will be visible to users browsing through search.
              Verified services get more business and earn more money.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
