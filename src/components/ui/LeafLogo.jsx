// CERGIO-GUARD: this is the ONLY brand mark in the app.
//
// 2026-05-28 — SPROUT V2. Replaced the single lobed leaf with a small
// botanical sprout: two asymmetric serrated leaves on a slightly
// S-curved stem rising from a soil mark, with a subtle dew drop on
// the top leaf. Reads as a real plant, not an icon — captivating but
// subtle, like a basil sprout on a windowsill.
//
// Motion: layered, overlapping micro-cycles instead of one big sway.
//   .cg-sprout-stem  — stem flex (±2deg, slow)
//   .cg-sprout-top   — top leaf rotation (counterphase to bottom)
//   .cg-sprout-bot   — bottom leaf rotation (counterphase to top)
//   .cg-leaf-vein    — sap-flow shimmer along each leaflet vein
//   .cg-sprout-dew   — dew drop micro-pulse
// Each cycle has a slightly different period so the motion never
// resolves into a rhythm — feels organic, never mechanical.
//
// intensity prop (0..1) scales --cg-leaf-amp + --cg-leaf-speed via
// CSS variables. The whole sprout responds to live activity (poll
// counts on the SRP, scripted progress on Home, steady 0.7 on
// Splash). Backwards compat: legacy `working` prop still works
// (treated as 0/1 intensity if intensity not explicitly set).
//
// Variants:
//   <LeafLogo />                 — inline 22px brand mark
//   <LeafLogo working />         — alive (intensity = 1)
//   <LeafLogo intensity={0.4} /> — explicit dial
//   <LeafLogo variant="splash" size={88} />  — hero on Splash + Auth

export function LeafLogo({
  working = false,
  size = 22,
  variant = 'inline',
  intensity,
}) {
  const i = (typeof intensity === 'number')
    ? Math.max(0, Math.min(1, intensity))
    : (working ? 1 : 0);
  // amp: 0.4 (calm idle) → 1.2 (full activity)
  // speed: 1.6× slow at low intensity → 0.55× faster at high intensity
  const amp   = 0.4 + 0.8 * i;
  const speed = 1.6 - 1.05 * i;
  const cssVars = { '--cg-leaf-amp': amp, '--cg-leaf-speed': speed };
  const px = variant === 'splash' ? size : size;
  // Aspect: viewBox 100x130 — taller than wide for the stem.
  const h = Math.round(px * 1.30);
  return (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{ width: px, height: h, ...cssVars }}
      aria-hidden="true"
    >
      <Sprout size={px} working={working || i > 0} />
    </span>
  );
}

// ─── Sprout SVG ────────────────────────────────────────────────────────────
//
// Layout (viewBox 100 130):
//   • Soil marks: 3 short brown dashes at y≈124, low opacity
//   • Stem: cubic curve from (50, 124) → (50, 38), slight S-bend
//   • Bottom leaf: lower-left, serrated, ~36px wide, slightly translucent
//   • Top leaf: upper-right, larger, fuller, with apex curl
//   • Dew drop: tiny white circle at top-leaf apex (only when working)
//
function Sprout({ size = 22, working = false }) {
  const tag = `${size}-${working ? 'w' : 's'}`;
  const gTop  = `lf-top-${tag}`;
  const gBot  = `lf-bot-${tag}`;
  const gStem = `lf-stem-${tag}`;
  const hTop  = `lf-htop-${tag}`;
  const VEIN  = 'cg-leaf-vein';

  return (
    <svg
      width={size}
      height={Math.round(size * 1.30)}
      viewBox="0 0 100 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Stem gradient — earthy at the base, alive at the top */}
        <linearGradient id={gStem} x1="50%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%"   stopColor="#5C3A14" />
          <stop offset="35%"  stopColor="#3D6614" />
          <stop offset="100%" stopColor="#3D8B00" />
        </linearGradient>
        {/* Bottom leaf — deeper, mature green */}
        <linearGradient id={gBot} x1="15%" y1="100%" x2="80%" y2="10%">
          <stop offset="0%"   stopColor="#2F6E00" />
          <stop offset="55%"  stopColor="#3D8B00" />
          <stop offset="100%" stopColor="#5BC404" />
        </linearGradient>
        {/* Top leaf — younger, brighter — and a light highlight wedge */}
        <linearGradient id={gTop} x1="20%" y1="100%" x2="85%" y2="0%">
          <stop offset="0%"   stopColor="#3D8B00" />
          <stop offset="50%"  stopColor="#5BC404" />
          <stop offset="100%" stopColor="#9BE53A" />
        </linearGradient>
        <linearGradient id={hTop} x1="40%" y1="85%" x2="85%" y2="0%">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.30" />
        </linearGradient>
      </defs>

      {/* ── Soil texture — three short dashes, faded. No hard line.   */}
      <path d="M 36 124 L 44 124" stroke="#5C3A14" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
      <path d="M 48 125 L 56 125" stroke="#5C3A14" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <path d="M 60 124 L 68 124" stroke="#5C3A14" strokeWidth="1.5" strokeLinecap="round" opacity="0.30" />

      {/* ── Stem — S-curve, flexes ±2° at the midpoint */}
      <g className="cg-sprout-stem" style={{ transformOrigin: '50px 124px', transformBox: 'view-box' }}>
        <path
          d="M 50 124 C 49 100, 52 80, 50 60 C 48 50, 51 44, 50 38"
          stroke={`url(#${gStem})`}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* ── Bottom leaf — lower-left lobe, serrated, mature.
              Pivots from its attachment point (50, 78) on the stem. */}
        <g className="cg-sprout-bot" style={{ transformOrigin: '50px 78px', transformBox: 'view-box' }}>
          {/* Leaf body — birch-shaped, asymmetric. Edges have soft
              scallops created by the cubic-bezier waypoints. */}
          <path
            d="M 50 78
               C 42 78, 32 80, 24 84
               C 16 86, 10 92, 8 100
               C 12 102, 16 100, 20 102
               C 14 106, 12 112, 18 114
               C 26 112, 32 108, 38 102
               C 40 98, 44 90, 50 84
               Z"
            fill={`url(#${gBot})`}
          />
          {/* Midrib */}
          <path
            d="M 50 80 Q 30 92 12 108"
            stroke="#1E4D00"
            strokeWidth="0.9"
            strokeLinecap="round"
            fill="none"
            opacity="0.75"
          />
          {/* Lateral veins */}
          {[
            { d: 'M 42 86 Q 32 92 22 96',  delay: '0s'   },
            { d: 'M 34 94 Q 24 98 16 104', delay: '.18s' },
            { d: 'M 28 104 Q 22 108 18 112', delay: '.36s' },
          ].map((v, idx) => (
            <path
              key={`vb-${idx}`}
              d={v.d}
              stroke="#1E4D00"
              strokeWidth="0.6"
              strokeLinecap="round"
              fill="none"
              className={working ? VEIN : ''}
              style={working ? { animationDelay: v.delay } : { opacity: 0.45 }}
            />
          ))}
        </g>

        {/* ── Top leaf — upper-right, larger + brighter (newer growth).
              Pivots from (50, 50) — its attachment point on the stem. */}
        <g className="cg-sprout-top" style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}>
          {/* Leaf body — wider than the bottom leaf, soft scallops. */}
          <path
            d="M 50 50
               C 58 48, 68 44, 76 38
               C 84 34, 90 28, 92 18
               C 88 14, 82 16, 78 14
               C 82 10, 84 4, 78 2
               C 70 4, 64 8, 58 16
               C 54 22, 50 32, 50 42
               Z"
            fill={`url(#${gTop})`}
          />
          {/* Soft highlight wedge — implies a single light source. */}
          <path
            d="M 50 50
               C 58 48, 68 44, 76 38
               C 84 34, 90 28, 92 18
               C 88 14, 82 16, 78 14
               C 82 10, 84 4, 78 2
               C 70 4, 64 8, 58 16
               C 54 22, 50 32, 50 42
               Z"
            fill={`url(#${hTop})`}
          />
          {/* Midrib */}
          <path
            d="M 50 48 Q 68 28 84 8"
            stroke="#1E4D00"
            strokeWidth="1.1"
            strokeLinecap="round"
            fill="none"
            opacity="0.80"
          />
          {/* Lateral veins */}
          {[
            { d: 'M 56 42 Q 66 36 76 30',  delay: '0s'   },
            { d: 'M 62 34 Q 72 26 82 18',  delay: '.14s' },
            { d: 'M 68 26 Q 76 18 84 12',  delay: '.28s' },
            { d: 'M 56 50 Q 66 44 74 38',  delay: '.42s' },
          ].map((v, idx) => (
            <path
              key={`vt-${idx}`}
              d={v.d}
              stroke="#1E4D00"
              strokeWidth="0.7"
              strokeLinecap="round"
              fill="none"
              className={working ? VEIN : ''}
              style={working ? { animationDelay: v.delay } : { opacity: 0.5 }}
            />
          ))}

          {/* Dew drop on the apex — only renders when working. Subtle
              white circle with a tiny highlight, pulses gently. */}
          {working && (
            <g className="cg-sprout-dew">
              <circle cx="82" cy="6" r="1.8" fill="#FFFFFF" opacity="0.85" />
              <circle cx="81.3" cy="5.3" r="0.5" fill="#FFFFFF" opacity="0.95" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
