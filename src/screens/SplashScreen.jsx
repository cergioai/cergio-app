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
          {/* CERGIO-GUARD (2026-06-04 v8): trim hero copy per UX pass.
              "I'll negotiate AND book services your friends actually
              trust" was three claims stacked into one sentence —
              dense. Cut to the single load-bearing claim ("services
              your friends actually trust") and let Book/Barter/Earn
              carry the feature pillars below.
              CERGIO-GUARD (2026-06-05 v6): elegant BETA tag tucked
              against the wordmark per Tarik. Same style on Auth +
              Splash so the marker is consistent. */}
          {/* CERGIO-GUARD (2026-06-05 v7): two-line hero per Tarik —
              "Hi, I'm CERGIO" gets its own line on the login/landing
              splash; the value-prop "I book services your friends
              actually trust" moves to a second softer line below. */}
          <p className="text-[15px] text-white/80 font-medium text-center leading-snug">
            Hi, I&apos;m{' '}
            <span className="font-extrabold tracking-[0.18em] uppercase text-white">
              Cergio
            </span>
            <span
              aria-label="beta"
              className="ml-1.5 align-top inline-block bg-white/12 text-white/85 border border-white/25 rounded-[5px] px-1.5 py-px text-[8px] font-extrabold uppercase tracking-[0.18em]"
            >
              beta
            </span>
            .
          </p>
          <p className="text-[14px] text-white/65 font-medium text-center leading-snug mt-1">
            I book services your friends actually trust.
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
        <Link to="/contact?subject=support" className="hover:text-white/70 transition-colors">Help</Link>
        <span>·</span>
        <Link to="/terms"   className="hover:text-white/70 transition-colors">Terms</Link>
      </div>
    </div>
  );
}
