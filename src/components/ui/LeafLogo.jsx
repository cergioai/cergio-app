// CERGIO-GUARD: this is the ONLY brand mark in the app. Do NOT
// import or reference the legacy spinner / eye `Logo` component
// anywhere. The leaf is the canonical Cergio logo — Splash, Auth,
// Home, Results, anywhere "Cergio" needs to be represented visually.
//
// Variants:
//   <LeafLogo />                       — static brand mark
//   <LeafLogo working />               — alive: sways + breathes,
//                                         sap shimmers through the veins
//                                         ("Cergio is thinking" state)
//   <LeafLogo variant="splash" />      — bigger hero leaf, deeper sway
//                                         (Splash + Auth screens).
//                                         No circles, no halos — just a
//                                         pure leaf moving like it would
//                                         on a branch in the breeze.
//
// Animation classes live in src/index.css:
//   .cg-leaf-alive       — sway + breathe (works on the whole leaf group)
//   .cg-leaf-vein        — sap-flow stroke-dashoffset animation on veins
//   .cg-leaf-alive-splash — same as alive, bigger arc, slower

export function LeafLogo({ working = false, size = 22, variant = 'inline' }) {
  if (variant === 'splash') {
    return <SplashLeaf size={size} working={working} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Leaf size={size} working={working} />
    </span>
  );
}

// ─── Organic leaf SVG ───────────────────────────────────────────────────────
// Hand-drawn lanceolate (lance-shaped) leaf with a slight natural tilt.
// Three layers from back to front:
//   1. Soft inner gradient leaf body
//   2. Front-light "highlight" wedge for depth
//   3. Midrib + 4 pairs of lateral veins (the ones that animate)
// The whole thing lives inside a <g> we transform so the sway + breathe
// pivots from the stem (50, 95) — the way a real leaf moves on a branch.
function Leaf({ size = 22, working = false }) {
  // Gradient ids must be unique per render so multiple leaves on the
  // same page don't collide (e.g. inline LeafLogo + splash variant).
  const gid = `leafGrad-${size}-${working ? 'w' : 's'}`;
  const hid = `leafHi-${size}-${working ? 'w' : 's'}`;

  // Stagger the vein shimmer so it ripples outward instead of pulsing
  // all-at-once (which would feel mechanical).
  const VEIN_BASE = 'cg-leaf-vein';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="20%" y1="100%" x2="80%" y2="0%">
          <stop offset="0%"  stopColor="#3D8B00" />
          <stop offset="55%" stopColor="#4AA901" />
          <stop offset="100%" stopColor="#7BD418" />
        </linearGradient>
        <linearGradient id={hid} x1="40%" y1="80%" x2="80%" y2="0%">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {/* Tiny stem — drawn first so the leaf body overlaps its top. */}
      <path
        d="M 50 96 Q 51 102 50 108"
        stroke="#2F6E00"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* The whole leaf group — sways + breathes when working. The
          transform-origin is the stem attachment so the motion looks
          like a leaf moving on a branch, not a rotating sticker. */}
      <g
        className={working ? 'cg-leaf-alive' : ''}
        style={{ transformOrigin: '50px 96px', transformBox: 'view-box' }}
      >
        {/* Leaf body — lanceolate with a soft natural curve. */}
        <path
          d="M 50 95
             C 22 86, 8 62, 18 38
             C 26 18, 44 8, 58 10
             C 78 16, 88 36, 80 58
             C 72 78, 62 90, 50 95 Z"
          fill={`url(#${gid})`}
        />
        {/* Front-light highlight — adds depth without being shiny. */}
        <path
          d="M 50 95
             C 22 86, 8 62, 18 38
             C 26 18, 44 8, 58 10
             C 78 16, 88 36, 80 58
             C 72 78, 62 90, 50 95 Z"
          fill={`url(#${hid})`}
        />

        {/* Midrib (main vein) — slightly off-center for organic feel. */}
        <path
          d="M 50 92 Q 52 60 54 16"
          stroke="#2F6E00"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />

        {/* Lateral veins. Each carries the shimmer class with a
            slightly different delay so the sap ripples outward from
            the base toward the tip instead of pulsing in unison. */}
        <path
          d="M 51 78 Q 38 72 24 70"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '0s' } : undefined}
        />
        <path
          d="M 51 78 Q 64 70 78 64"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '.18s' } : undefined}
        />
        <path
          d="M 52 62 Q 38 54 22 50"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '.36s' } : undefined}
        />
        <path
          d="M 52 62 Q 66 52 80 46"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '.54s' } : undefined}
        />
        <path
          d="M 53 46 Q 40 38 26 34"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '.72s' } : undefined}
        />
        <path
          d="M 53 46 Q 64 36 78 30"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '.9s' } : undefined}
        />
        <path
          d="M 54 30 Q 44 22 36 16"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '1.08s' } : undefined}
        />
        <path
          d="M 54 30 Q 64 22 70 14"
          stroke="#2F6E00" strokeWidth="0.9" strokeLinecap="round" fill="none"
          className={working ? VEIN_BASE : ''}
          style={working ? { animationDelay: '1.26s' } : undefined}
        />
      </g>
    </svg>
  );
}

// ─── Splash hero ────────────────────────────────────────────────────────────
// Just a bigger leaf with a slower, more pronounced sway. Per design
// note "no circles around just pure plant or tree" — no orbit ring,
// no halo, no chrome. The leaf itself carries the whole composition.
function SplashLeaf({ size = 96, working = true }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: Math.round(size * 1.1) }}
      aria-hidden="true"
    >
      <SplashLeafSvg size={size} working={working} />
    </span>
  );
}

// Same SVG geometry as Leaf, but uses the .cg-leaf-alive-splash class
// for a deeper / slower sway suited to the larger hero size.
function SplashLeafSvg({ size = 96, working = true }) {
  const gid = `leafGrad-splash-${size}`;
  const hid = `leafHi-splash-${size}`;
  const VEIN_BASE = 'cg-leaf-vein';

  return (
    <svg
      width={size}
      height={Math.round(size * 1.1)}
      viewBox="0 0 100 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="20%" y1="100%" x2="80%" y2="0%">
          <stop offset="0%"   stopColor="#3D8B00" />
          <stop offset="55%"  stopColor="#4AA901" />
          <stop offset="100%" stopColor="#7BD418" />
        </linearGradient>
        <linearGradient id={hid} x1="40%" y1="80%" x2="80%" y2="0%">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <path
        d="M 50 96 Q 51 103 50 109"
        stroke="#2F6E00" strokeWidth="1.8" strokeLinecap="round"
      />

      <g
        className={working ? 'cg-leaf-alive-splash' : ''}
        style={{ transformOrigin: '50px 96px', transformBox: 'view-box' }}
      >
        <path
          d="M 50 95
             C 22 86, 8 62, 18 38
             C 26 18, 44 8, 58 10
             C 78 16, 88 36, 80 58
             C 72 78, 62 90, 50 95 Z"
          fill={`url(#${gid})`}
        />
        <path
          d="M 50 95
             C 22 86, 8 62, 18 38
             C 26 18, 44 8, 58 10
             C 78 16, 88 36, 80 58
             C 72 78, 62 90, 50 95 Z"
          fill={`url(#${hid})`}
        />

        <path
          d="M 50 92 Q 52 60 54 16"
          stroke="#2F6E00" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.7"
        />

        {[
          { d: 'M 51 78 Q 38 72 24 70', delay: '0s'    },
          { d: 'M 51 78 Q 64 70 78 64', delay: '.18s'  },
          { d: 'M 52 62 Q 38 54 22 50', delay: '.36s'  },
          { d: 'M 52 62 Q 66 52 80 46', delay: '.54s'  },
          { d: 'M 53 46 Q 40 38 26 34', delay: '.72s'  },
          { d: 'M 53 46 Q 64 36 78 30', delay: '.9s'   },
          { d: 'M 54 30 Q 44 22 36 16', delay: '1.08s' },
          { d: 'M 54 30 Q 64 22 70 14', delay: '1.26s' },
        ].map((v, i) => (
          <path
            key={i}
            d={v.d}
            stroke="#2F6E00"
            strokeWidth="1.05"
            strokeLinecap="round"
            fill="none"
            className={working ? VEIN_BASE : ''}
            style={working ? { animationDelay: v.delay } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
