// Per design-spec.md — uses tokens only.
// Provider-facing explainer: what working with a Connector gets you.
// CERGIO-GUARD: rewritten to remove fake-user data (was "Reyna",
// "Gervon", 6,974 followers). This screen is reached as a generic
// "Learn more" from listing-verify / social-posts, so it must not
// impersonate a specific Connector. CTA routes to the real Connector
// browse screen instead of a dead-end toast.
import { useNavigate } from 'react-router-dom';

function HeroBadge() {
  return (
    <div className="relative w-32 h-32">
      {/* brand circle with megaphone glyph */}
      <div className="w-32 h-32 rounded-full bg-gl flex items-center justify-center shadow-card">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none"
             stroke="#3D8B00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l18-7v16L3 13v-2z" fill="rgba(61,139,0,0.12)" />
          <path d="M7 13v5a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3" />
        </svg>
      </div>
      {/* brand-shield badge bottom-right */}
      <div className="absolute -bottom-1 -right-1 w-11 h-11 rounded-full bg-g
                      border-[3px] border-cr flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
             stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L4 7v5c0 5 4 9.7 8 11 4-1.3 8-6 8-11V7l-8-5z"
                fill="rgba(255,255,255,0.18)" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>
    </div>
  );
}

function BenefitRow({ title, subtitle }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-11 h-11 min-w-11 rounded-full bg-gl flex items-center justify-center mt-0.5">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            fill="#3D8B00"
          />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-[16px] font-extrabold text-black leading-tight mb-1">{title}</p>
        <p className="text-[14px] text-g font-medium leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
}

export function RainmakerRequestScreen() {
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

      {/* hero badge */}
      <div className="flex flex-col items-center pt-6 pb-8">
        <HeroBadge />
      </div>

      {/* headline */}
      <h1 className="text-[26px] font-extrabold text-black text-center leading-tight px-7 mb-3">
        Get spotlighted by a Connector
      </h1>

      {/* sub */}
      <p className="text-[15px] text-b3 text-center leading-relaxed px-7 mb-9">
        <span className="text-g font-extrabold">Cergio Connectors</span> have
        large Instagram and TikTok audiences. Offer a free service in
        exchange for the following benefits:
      </p>

      {/* benefits */}
      <div className="px-7 flex flex-col gap-7 flex-1">
        <BenefitRow
          title="A post to their followers"
          subtitle="Your service featured on the Connector's Instagram or TikTok"
        />
        <BenefitRow
          title="Instant verification"
          subtitle="Your profile will be public on Cergio's search"
        />
      </div>

      {/* CTA */}
      <div className="px-5 pt-8 pb-6">
        <button
          onClick={() => navigate('/connectors/browse')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Browse Connectors
        </button>
      </div>
    </div>
  );
}
