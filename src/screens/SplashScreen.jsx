import { useNavigate } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';

export function SplashScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-black relative overflow-hidden">
      <div className="absolute inset-0 splash-glow pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-5 animate-fade-up">
        {/* CERGIO-GUARD: splash variant — Claude-inspired orbit + halo. */}
        <LeafLogo variant="splash" size={88} working />
        <h1 className="text-[34px] font-extrabold text-white tracking-widest uppercase">Cergio</h1>
        <p className="text-[14px] text-white/50 font-medium text-center max-w-[240px] leading-relaxed">
          Find trusted services, recommended by friends
        </p>
      </div>

      <div className="relative z-10 flex flex-col gap-3 w-[280px] mt-12">
        <button
          onClick={() => navigate('/auth')}
          className="bg-g text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     transition-opacity hover:opacity-90 active:scale-[.97]"
        >
          Sign in or sign up
        </button>
        <button
          onClick={() => navigate('/home')}
          className="bg-transparent text-white/70 border border-white/25 rounded-[24px]
                     py-4 text-[15px] font-bold transition-colors hover:border-white/50"
        >
          Continue as guest
        </button>
      </div>
    </div>
  );
}
