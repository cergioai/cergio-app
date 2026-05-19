// Per design-spec.md — uses tokens only.
// Provider-facing: post-service prompt to share on Instagram.
import { useNavigate } from 'react-router-dom';

const PROVIDER = {
  name: 'Gervon',
  followerCount: 6974,
};

export function SharePromptScreen() {
  const navigate = useNavigate();
  const { name, followerCount } = PROVIDER;

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20">

      {/* headline */}
      <div className="px-7 pt-12 pb-8">
        <h1 className="text-[26px] font-extrabold text-black leading-tight">
          We're glad you enjoyed<br />your free service!
        </h1>
      </div>

      {/* Instagram hero card (soft bg, no border, brand mint outline accents) */}
      <div className="mx-5 mb-8 bg-card rounded-[24px] p-8
                      flex flex-col items-center gap-5 relative overflow-hidden">
        {/* decorative dots — green only, very subtle */}
        <div className="absolute top-4 right-5  w-4 h-4 rounded-full bg-g/20" />
        <div className="absolute top-9 right-2  w-2.5 h-2.5 rounded-full bg-g/15" />
        <div className="absolute bottom-5 left-3 w-3.5 h-3.5 rounded-full bg-g/20" />
        <div className="absolute top-5 left-2   w-2.5 h-2.5 rounded-full bg-g/15" />

        {/* Instagram icon — black-and-green, no salmon/orange */}
        <div className="w-24 h-24 rounded-[26px] bg-black flex items-center justify-center
                        shadow-card relative z-10">
          <svg width="54" height="54" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="17.5" cy="6.5" r="1.2" fill="white" stroke="none" />
          </svg>
        </div>

        {/* reach pill */}
        <div className="bg-g rounded-pill px-4 py-1.5 relative z-10">
          <span className="text-[13px] font-extrabold text-white">
            Reaches {followerCount.toLocaleString()} followers
          </span>
        </div>
      </div>

      {/* body copy */}
      <div className="px-7 flex-1">
        <p className="text-[19px] font-extrabold text-black mb-3">Now it's your turn!</p>
        <p className="text-[15px] text-b3 leading-relaxed mb-4">
          Share your experience to social media and leave a nice recommendation.
        </p>
        <p className="text-[15px] text-b3 leading-relaxed">
          Once {name} confirms your Instagram post, you'll be able to book more free services!
        </p>
      </div>

      {/* CTA */}
      <div className="px-5 pt-8 pb-6">
        <button
          onClick={() => navigate('/profile-shared')}
          className="w-full bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Let's do it
        </button>
      </div>
    </div>
  );
}
