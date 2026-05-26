// CERGIO-GUARD: this is the ONLY brand mark in the app. Do NOT
// import or reference the legacy spinner / eye `Logo` component
// anywhere. The leaf is the canonical Cergio logo — Splash, Auth,
// Home, Results, anywhere "Cergio" needs to be represented visually.
//
// Variants:
//   <LeafLogo />                       — static brand mark
//   <LeafLogo working />               — slow Claude-style rotate (for
//                                         "Cergio is thinking" states)
//   <LeafLogo variant="splash" />      — splash/auth hero with orbiting
//                                         ring + pulsing core (Claude's
//                                         star-thinking inspiration)
//
// Animation classes live in src/index.css:
//   .cg-leaf-think       — slow 3.5s rotate + scale breath
//   .cg-leaf-orbit       — orbiting ring (splash variant)
//   .cg-leaf-pulse-core  — soft glow pulse (splash variant)

export function LeafLogo({ working = false, size = 22, variant = 'inline' }) {
  if (variant === 'splash') {
    return <SplashLeaf size={size} working={working} />;
  }
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${working ? 'cg-leaf-think' : ''}`}
      style={{ width: size, height: size, transformOrigin: '50% 60%' }}
      aria-hidden="true"
    >
      <Leaf size={size} />
    </span>
  );
}

// Just the leaf SVG — shared between inline + splash variants so
// kerning + proportions stay identical.
function Leaf({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M14 26 C14 22 14 18 14 14" stroke="#3D8B00" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 17 C 8 17, 4 14, 4 9 C 4 7, 5 5.5, 6 4.5 C 9 6, 12 8.5, 14 14 Z" fill="#4AA901" />
      <path d="M14 14 C 16 9, 19 5.5, 22.5 4 C 23.5 5, 24.5 7, 24.5 9 C 24.5 14, 20 17, 14 17 Z" fill="#5BC404" />
      <path d="M14 14 L 8 9" stroke="#2F6E00" strokeWidth="0.8" strokeLinecap="round" opacity=".55" />
      <path d="M14 14 L 20 8" stroke="#2F6E00" strokeWidth="0.8" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

// Hero variant — leaf at center, an orbiting accent ring, and a
// soft glow pulse behind. Inspired by Claude's star animation: motion
// is calm + cyclical (not jittery) so it reads as alive, not loading.
function SplashLeaf({ size = 96, working = true }) {
  const ringSize = Math.round(size * 1.35);
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: ringSize, height: ringSize }}
      aria-hidden="true"
    >
      {/* Pulsing soft halo (always on for splash) */}
      <span
        className="absolute inset-0 rounded-full cg-leaf-pulse-core"
        style={{
          background:
            'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(91,196,4,0.32) 0%, transparent 70%)',
        }}
      />
      {/* Orbiting ring — a dashed circle rotating slowly */}
      <svg
        width={ringSize} height={ringSize} viewBox="0 0 100 100" fill="none"
        className={`absolute inset-0 ${working ? 'cg-leaf-orbit' : ''}`}
      >
        <circle cx="50" cy="50" r="46" stroke="#4AA901" strokeWidth="1.5" strokeDasharray="2 6" opacity="0.55" />
      </svg>
      {/* The leaf, centered, with its own subtle think wobble. */}
      <span
        className={`relative z-10 inline-flex items-center justify-center ${working ? 'cg-leaf-think' : ''}`}
        style={{ width: size, height: size, transformOrigin: '50% 60%' }}
      >
        <Leaf size={size} />
      </span>
    </span>
  );
}
