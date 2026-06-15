// Provider-facing: confirms service completion + earned benefits.
// CERGIO-GUARD (2026-06-14): reads the real client/reach from router state
// (passed by RateConfirmScreen) — no more fabricated "Lydia · 23,735" (SPEC-12).
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';

// Benefit row pattern (per design-spec):
// - icon: dark green on light mint, for contrast
// - title: bold black
// - subtitle: GREEN (not gray) — confirmed by GOAT status PNG and Tarik
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
        <p className="text-body-lg font-extrabold text-black leading-tight mb-1">{title}</p>
        <p className="text-body text-g font-medium leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
}

export function ServiceCompleteScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useOutletContext();
  const st = location.state || {};
  const clientName = (st.consumerName || '').trim() || null;
  const followers = Number(st.followers) || 0;
  const marketingSub = followers > 0
    ? `Your service is being shared to ${followers.toLocaleString()} followers`
    : (clientName ? `${clientName} will spotlight your service to their followers` : 'Your service gets a social spotlight');

  return (
    <div className="flex-1 flex flex-col bg-cr pb-20">

      {/* hero check — 72px circle, check fills it */}
      <div className="flex flex-col items-center px-7 pt-14 pb-7">
        <div className="w-[72px] h-[72px] rounded-full border-[3px] border-g
                        flex items-center justify-center mb-5 animate-pop-in">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
               stroke="#4AA901" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <h1 className="text-display-2 font-extrabold text-black text-center leading-tight">
          Thanks for completing a free service!
        </h1>
      </div>

      {/* "You just received:" sub-header per Tarik feedback */}
      <p className="px-7 text-body font-extrabold text-b3 uppercase tracking-wide mb-5">
        You just received:
      </p>

      {/* benefits */}
      <div className="px-7 flex flex-col gap-7 flex-1">
        <BenefitRow
          title="Free marketing worth up to $1,000+"
          subtitle={marketingSub}
        />
        <BenefitRow
          title="Instant verification"
          subtitle="Your profile is now public on Cergio's search"
        />
        <BenefitRow
          title={clientName ? `A recommendation from ${clientName}` : 'A recommendation on Cergio'}
          subtitle={clientName ? `${clientName} can recommend you after a 4+ star rating` : 'Earn a recommendation after a 4+ star rating'}
        />
      </div>

      {/* CTA — rounded-[24px] per spec, NOT pill */}
      <div className="px-5 pt-8 pb-6">
        <button
          onClick={() => { showToast('Welcome back!'); navigate('/home'); }}
          className="w-full bg-g text-white rounded-[24px] py-4 text-body-lg font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Perfect!
        </button>
      </div>
    </div>
  );
}
