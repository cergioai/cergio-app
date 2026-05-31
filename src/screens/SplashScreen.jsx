import { Link, useNavigate } from 'react-router-dom';
import { LeafLogo } from '../components/ui/LeafLogo';

export function SplashScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-black relative overflow-hidden">
      <div className="absolute inset-0 splash-glow pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-6 animate-fade-up">
        {/* CERGIO-GUARD (2026-05-30 v4): logo leads, no separate
            wordmark. Tarik: "use the cergio from the I'm (design it
            with different font).. and remove from above to remove
            repetition... move the logo to before Hi". The wordmark
            now lives INSIDE the tagline (the styled "Cergio" span
            below) so the screen has a single brand anchor. */}
        <LeafLogo variant="splash" size={120} />
        {/* Tagline with brand-styled "Cergio" inline. The styled span
            uses the same uppercase + wide tracking as the old wordmark
            so the word still reads as the logotype, just embedded in
            the sentence instead of sitting alone above it. */}
        <div className="flex flex-col items-center gap-2 max-w-[320px]">
          <p className="text-[15px] text-white/80 font-medium text-center leading-snug">
            Hi, I&apos;m{' '}
            <span className="font-extrabold tracking-[0.18em] uppercase text-white">
              Cergio
            </span>
            . I&apos;ll negotiate and book services your friends actually trust.
          </p>
          <p className="text-[11.5px] text-white/45 font-extrabold text-center tracking-[0.18em] uppercase mt-1">
            Book · Barter · Earn
          </p>
        </div>
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

      {/* CERGIO-GUARD (2026-05-31): minimal company link row.
          Reachable from the splash without overwhelming the hero. */}
      <div className="relative z-10 mt-8 flex items-center gap-4 text-[11.5px] font-medium text-white/40">
        <Link to="/about"   className="hover:text-white/70 transition-colors">About</Link>
        <span>·</span>
        <Link to="/contact" className="hover:text-white/70 transition-colors">Contact</Link>
        <span>·</span>
        <Link to="/terms"   className="hover:text-white/70 transition-colors">Terms</Link>
      </div>
    </div>
  );
}
