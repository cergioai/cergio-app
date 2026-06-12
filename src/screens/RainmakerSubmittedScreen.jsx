// Per design-spec.md — full-bleed green confirmation screen.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function RainmakerSubmittedScreen() {
  const navigate = useNavigate();

  // Auto-return home after 3.5 seconds
  useEffect(() => {
    const t = setTimeout(() => navigate('/home'), 3500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-b from-gm to-g relative overflow-hidden">
      {/* back */}
      <div className="px-5 pt-6">
        <button
          onClick={() => navigate('/rainmakers')}
          className="text-white text-2xl font-extrabold"
          aria-label="Back"
        >
          ‹
        </button>
      </div>

      {/* decorative dots */}
      <div className="absolute top-[36%] left-[28%] w-3 h-px bg-white/70" />
      <div className="absolute top-[34%] left-[48%] w-3 h-3 text-white/70 text-xs flex items-center justify-center">+</div>
      <div className="absolute top-[40%] right-[26%] w-3 h-3 rounded-full border border-white/70" />

      {/* check + message */}
      <div className="flex-1 flex flex-col items-center justify-center -mt-12 px-7">
        <div className="w-[88px] h-[88px] rounded-full border-[3px] border-white
                        flex items-center justify-center mb-6 animate-pop-in">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
               stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <h1 className="text-display-2 font-extrabold text-white text-center leading-tight">
          Your application<br />has been submitted!
        </h1>
      </div>

      {/* dismiss CTA — auto-return still fires after 3.5s, this lets impatient users skip it */}
      <div className="px-7 pb-9">
        <button
          onClick={() => navigate('/home')}
          className="w-full bg-white text-g rounded-[24px] py-3.5 text-body-lg font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
