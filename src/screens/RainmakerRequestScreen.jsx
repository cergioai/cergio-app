// Per design-spec.md — uses tokens only.
// Provider-facing: a Rainmaker is asking to feature this provider's service.
import { useNavigate, useOutletContext } from 'react-router-dom';

const REQUEST = {
  rainmakerName: 'Reyna',
  instagramHandle: 'ReynaReynolds',
  followerCount: 6974,
  instagramBenefitText: "Gervon's network on Instagram",
  verificationBenefitText: "Your profile will be public on Cergio's search",
};

function getInitials(name) {
  return name.split(' ').map(s => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function RainmakerAvatar({ name }) {
  return (
    <div className="relative w-32 h-32">
      {/* main avatar — gradient circle with initials */}
      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#b06090] to-[#703050]
                      flex items-center justify-center text-white text-[36px] font-extrabold
                      shadow-card">
        {getInitials(name)}
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
  const { showToast } = useOutletContext();
  const { rainmakerName, followerCount, instagramBenefitText, verificationBenefitText } = REQUEST;

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

      {/* hero avatar */}
      <div className="flex flex-col items-center pt-6 pb-8">
        <RainmakerAvatar name={rainmakerName} />
      </div>

      {/* headline */}
      <h1 className="text-[26px] font-extrabold text-black text-center leading-tight px-7 mb-3">
        {rainmakerName} wants to market your services
      </h1>

      {/* sub */}
      <p className="text-[15px] text-b3 text-center leading-relaxed px-7 mb-9">
        {rainmakerName} is a <span className="text-g font-extrabold">Cergio Rainmaker</span>.
        Offer a free service in exchange for the following benefits:
      </p>

      {/* benefits */}
      <div className="px-7 flex flex-col gap-7 flex-1">
        <BenefitRow
          title={`Instagram post to ${followerCount.toLocaleString()} followers`}
          subtitle={instagramBenefitText}
        />
        <BenefitRow
          title="Instant verification"
          subtitle={verificationBenefitText}
        />
      </div>

      {/* CTA + secondary */}
      <div className="px-5 pt-8 pb-6">
        <button
          onClick={() => { showToast('Accepted! Send a message to confirm.'); }}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Let's do it
        </button>
        <button
          onClick={() => showToast('Recent posts — coming next batch')}
          className="w-full text-center text-[14px] font-extrabold text-g pt-4"
        >
          See recent posts by Rainmakers
        </button>
      </div>
    </div>
  );
}
