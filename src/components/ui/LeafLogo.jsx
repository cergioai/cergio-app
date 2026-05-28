// CERGIO-GUARD: this is the ONLY brand mark in the app. Do NOT
// import or reference the legacy spinner / eye `Logo` component
// anywhere. The leaf is the canonical Cergio logo — Splash, Auth,
// Home, Results, anywhere "Cergio" needs to be represented visually.
//
// Variants:
//   <LeafLogo />                       — static brand mark
//   <LeafLogo working />               — alive: sways + breathes,
//                                         sap shimmers through the
//                                         veins ("Cergio is thinking")
//   <LeafLogo variant="splash" />      — bigger hero leaf, deeper sway
//                                         (Splash + Auth screens).
//                                         No circles, no halos.
//
// Shape: a hand-drawn lobed leaf (think birch/poplar with soft scallops
// on the edges) — NOT a generic teardrop. Asymmetric outline, organic
// curl at the tip, full venation that fans naturally from the midrib
// out to each lobe. The whole thing reads as a real specimen pressed
// flat, not an icon.
//
// Animation classes live in src/index.css:
//   .cg-leaf-alive       — sway + breathe (anchored from the stem)
//   .cg-leaf-vein        — sap-flow stroke-dashoffset along veins
//   .cg-leaf-alive-splash — same motion, slower + wider arc
//   .cg-leaf-tip-curl    — tip lifts subtly during the apex of sway

// CERGIO-GUARD (2026-05-28): `intensity` is a 0..1 dial that scales the
// leaf's sway amplitude and loop speed via CSS variables (see
// src/index.css → @keyframes cgLeafAlive). 0 = still, 1 = full life.
// The canonical formula (see hooks/useRequestActivity activityToStatus)
// is min(1, (notified + replied*3) / 10) — bids count 3× notifications.
// Callers can pass `intensity` instead of (or in addition to) `working`:
//   working=true alone → default sway (intensity 1)
//   intensity=0.3      → breathe only, no loud sway
//   intensity=1        → full sway + fast sap flow
// Internally we map intensity → CSS vars cg-leaf-amp + cg-leaf-speed.
export function LeafLogo({
  working = false,
  size = 22,
  variant = 'inline',
  intensity,                // 0..1, optional; falls back to working ? 1 : 0
}) {
  // Resolve intensity. If caller didn't pass one, treat `working` as a
  // 0/1 toggle so existing call sites keep their behavior.
  const i = (typeof intensity === 'number')
    ? Math.max(0, Math.min(1, intensity))
    : (working ? 1 : 0);
  // amp: 0.4 at rest-with-pulse → 1.2 at full intensity
  // speed: 1.6× slow at low intensity → 0.5× (faster) at high intensity
  const amp   = 0.4 + 0.8 * i;
  const speed = 1.6 - 1.1 * i;
  const cssVars = { '--cg-leaf-amp': amp, '--cg-leaf-speed': speed };

  if (variant === 'splash') {
    return <SplashLeaf size={size} working={working || i > 0} cssVars={cssVars} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: Math.round(size * 1.12), ...cssVars }}
      aria-hidden="true"
    >
      <Leaf size={size} working={working || i > 0} swayClass="cg-leaf-alive" />
    </span>
  );
}

// ─── Organic lobed-leaf SVG ─────────────────────────────────────────────────
// The outline is a chain of cubic curves that scallop in and out — each
// "in" creates a soft lobe notch, each "out" puffs a lobe. The result
// reads as a real botanical leaf rather than the schematic Lucide icon.
//
// Layers (back → front):
//   1. Outer leaf body — deep-to-light green gradient
//   2. Highlight wedge — soft top-light for depth
//   3. Midrib + 5 pairs of lateral veins fanning to each lobe
//   4. A few "venation cross-links" between adjacent lateral veins so the
//      vein system feels natural, not just a fishbone
function Leaf({ size = 22, working = false, swayClass = 'cg-leaf-alive' }) {
  // Unique gradient ids per render so multiple leaves don't collide.
  const tag = `${size}-${working ? 'w' : 's'}-${swayClass.slice(-1)}`;
  const gid = `lf-grad-${tag}`;
  const hid = `lf-hi-${tag}`;
  const VEIN = 'cg-leaf-vein';

  return (
    <svg
      width={size}
      height={Math.round(size * 1.12)}
      viewBox="0 0 100 112"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="15%" y1="100%" x2="85%" y2="0%">
          <stop offset="0%"   stopColor="#2F6E00" />
          <stop offset="45%"  stopColor="#3D8B00" />
          <stop offset="80%"  stopColor="#5BC404" />
          <stop offset="100%" stopColor="#9BE53A" />
        </linearGradient>
        <linearGradient id={hid} x1="40%" y1="85%" x2="80%" y2="0%">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.28" />
        </linearGradient>
      </defs>

      {/* Stem — slightly curved, comes from the leaf base. Drawn first
          so the leaf body overlaps its attachment point. */}
      <path
        d="M 50 96 Q 51 102 49 110"
        stroke="#2F6E00"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      {/* Whole leaf group — sways + breathes when working. Pivots from
          the stem (50, 96) so the tip travels in an arc like a real
          leaf in a breeze, not a rotating decal. */}
      <g
        className={working ? swayClass : ''}
        style={{ transformOrigin: '50px 96px', transformBox: 'view-box' }}
      >
        {/* Lobed leaf outline — soft scallops on both edges, pronounced
            curl at the tip. Asymmetric: the right side is slightly
            wider so the leaf doesn't read like a mirror image. */}
        <path
          d="M 50 95
             C 38 95, 28 92, 22 84
             C 14 78, 10 70, 12 60
             C 9 56, 8 48, 14 42
             C 12 36, 14 28, 22 24
             C 22 18, 28 12, 38 10
             C 42 6, 50 4, 57 8
             C 64 6, 72 9, 76 16
             C 84 18, 90 26, 88 36
             C 92 42, 90 50, 84 54
             C 88 60, 86 70, 78 76
             C 78 84, 70 92, 60 94
             C 56 96, 53 96, 50 95 Z"
          fill={`url(#${gid})`}
        />
        {/* Front-light highlight wedge — adds depth without being shiny. */}
        <path
          d="M 50 95
             C 38 95, 28 92, 22 84
             C 14 78, 10 70, 12 60
             C 9 56, 8 48, 14 42
             C 12 36, 14 28, 22 24
             C 22 18, 28 12, 38 10
             C 42 6, 50 4, 57 8
             C 64 6, 72 9, 76 16
             C 84 18, 90 26, 88 36
             C 92 42, 90 50, 84 54
             C 88 60, 86 70, 78 76
             C 78 84, 70 92, 60 94
             C 56 96, 53 96, 50 95 Z"
          fill={`url(#${hid})`}
        />

        {/* Midrib — the central spine, slightly curved like a real leaf. */}
        <path
          d="M 50 93 Q 51 60 53 14"
          stroke="#1E4D00"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />

        {/* Lateral veins — each pair fans out toward a lobe. The shimmer
            class animates a bright segment along each vein, staggered
            by delay so the sap appears to flow outward from base to tip. */}
        {[
          // left fan
          { d: 'M 51 84 Q 38 80 22 80', delay: '0s'    },
          { d: 'M 51 70 Q 34 64 14 58', delay: '.14s'  },
          { d: 'M 52 56 Q 34 48 14 46', delay: '.28s'  },
          { d: 'M 52 42 Q 32 36 18 30', delay: '.42s'  },
          { d: 'M 53 28 Q 38 22 28 16', delay: '.56s'  },
          { d: 'M 53 16 Q 46 12 40 10', delay: '.70s'  },
          // right fan
          { d: 'M 51 84 Q 64 82 76 78', delay: '.08s'  },
          { d: 'M 51 70 Q 68 64 86 58', delay: '.22s'  },
          { d: 'M 52 56 Q 70 50 88 46', delay: '.36s'  },
          { d: 'M 52 42 Q 72 38 84 30', delay: '.50s'  },
          { d: 'M 53 28 Q 66 22 74 16', delay: '.64s'  },
          { d: 'M 53 16 Q 60 12 64 10', delay: '.78s'  },
        ].map((v, i) => (
          <path
            key={i}
            d={v.d}
            stroke="#1E4D00"
            strokeWidth="0.85"
            strokeLinecap="round"
            fill="none"
            className={working ? VEIN : ''}
            style={working ? { animationDelay: v.delay } : { opacity: 0.55 }}
          />
        ))}

        {/* Cross-links between adjacent lateral veins — gives the
            venation an organic web feel instead of a fishbone. */}
        <path d="M 30 70 Q 32 64 36 58" stroke="#1E4D00" strokeWidth="0.55" fill="none" opacity="0.35" />
        <path d="M 72 70 Q 74 64 78 58" stroke="#1E4D00" strokeWidth="0.55" fill="none" opacity="0.35" />
        <path d="M 26 46 Q 30 42 34 38" stroke="#1E4D00" strokeWidth="0.55" fill="none" opacity="0.35" />
        <path d="M 76 46 Q 80 42 84 38" stroke="#1E4D00" strokeWidth="0.55" fill="none" opacity="0.35" />
      </g>
    </svg>
  );
}

// ─── Splash hero ────────────────────────────────────────────────────────────
// Same SVG geometry, larger size and a slower / wider sway via the
// .cg-leaf-alive-splash class. No circles, halos, or chrome — the
// leaf carries the whole composition.
function SplashLeaf({ size = 96, working = true, cssVars = {} }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: Math.round(size * 1.12), ...cssVars }}
      aria-hidden="true"
    >
      <Leaf size={size} working={working} swayClass="cg-leaf-alive-splash" />
    </span>
  );
}
