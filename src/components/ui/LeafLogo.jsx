// CERGIO-GUARD: this is the ONLY brand mark in the app.
//
// 2026-05-30 — VARIANT SWITCH. Tarik picking between four organic
// expand/contract animations. Change LOGO_VARIANT below to switch the
// brand mark sitewide. Each variant respects the `working` prop:
//   • working=false → static rest state (the logo just sits there)
//   • working=true  → animation fires (search triggered, splash hero, etc.)
//
// Variants:
//   'sprout' — A · two-leaf sprout with stem + dew (v2, prior default)
//   'rings'  — B · concentric tree-growth rings expanding outward
//   'bud'    — C · 4-petal bud that opens + closes
//   'pollen' — D · central core with seeds drifting out + returning
//
// API unchanged:
//   <LeafLogo />                  inline 22px brand mark, static
//   <LeafLogo working />          alive (intensity = 1)
//   <LeafLogo intensity={0.4} />  explicit dial
//   <LeafLogo size={88} />        hero on Splash + Auth
//   <LeafLogo variant="splash" /> legacy size hint, no longer required
const LOGO_VARIANT = 'bud'; // 'sprout' | 'rings' | 'bud' | 'pollen' — Tarik picked C3 (bud) 2026-05-30

// CERGIO-GUARD (2026-05-30): URL override for A/B testing the variants.
// ?logo=rings  → Growth rings
// ?logo=bud    → Bud bloom
// ?logo=pollen → Pollen pulse
// ?logo=sprout → original Sprout v2
// Anything else falls back to LOGO_VARIANT above. No reload required
// between variant changes (just edit the URL query and the next render
// picks it up).
function getActiveVariant() {
  if (typeof window !== 'undefined' && window.location?.search) {
    const override = new URLSearchParams(window.location.search).get('logo');
    if (override && MARKS_KEYS.has(override)) return override;
  }
  return LOGO_VARIANT;
}
const MARKS_KEYS = new Set(['sprout', 'rings', 'bud', 'pollen']);

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
  const isWorking = working || i > 0;
  // Sprout is taller than wide (stem); other variants are square.
  const activeVariant = getActiveVariant();
  const h = activeVariant === 'sprout' ? Math.round(size * 1.30) : size;
  const Mark = MARKS[activeVariant] || MARKS.sprout;
  return (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: h, ...cssVars }}
      aria-hidden="true"
    >
      <Mark size={size} working={isWorking} />
    </span>
  );
}

// ─── B · Growth rings ─────────────────────────────────────────────────────
// Solid core + concentric rings expanding outward. Internal proportions
// tuned for app rendering. Now BOLDER (stroke 3-4px), MORE rings (5),
// slower fade so multiple rings are always visible mid-pulse. Core
// also breathes during search via cgRingsCore keyframe so the whole
// mark feels alive, not static.
function GrowthRings({ size, working }) {
  const dur = '2.4s';
  const beg = (delay) => working ? `${delay}s` : 'indefinite';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer subtle ring for depth — always visible, defines the mark's edge */}
      <circle cx="60" cy="60" r="36" fill="#2C5D21" opacity="0.5" />
      {/* Solid core — the resting mark. Breathes during search. */}
      <circle
        cx="60" cy="60" r="32" fill="#3B6D11"
        className={working ? 'cg-rings-core' : ''}
        style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }}
      />
      {/* Inner highlight for organic life */}
      <ellipse cx="50" cy="48" rx="11" ry="7" fill="#97C459" opacity="0.55" />
      {working && (
        <>
          {[
            { stroke: '#2F6E00', delay: 0,    rMax: 56, w: 4   },
            { stroke: '#3B6D11', delay: 0.48, rMax: 56, w: 3.5 },
            { stroke: '#639922', delay: 0.96, rMax: 56, w: 3   },
            { stroke: '#97C459', delay: 1.44, rMax: 56, w: 2.5 },
            { stroke: '#C0DD97', delay: 1.92, rMax: 56, w: 2   },
          ].map((r, idx) => (
            <circle key={idx} cx="60" cy="60" r="34" fill="none" stroke={r.stroke} strokeWidth={r.w}>
              <animate attributeName="r"       values={`34;${r.rMax}`} dur={dur} begin={beg(r.delay)} repeatCount="indefinite" />
              {/* Stay bright most of the cycle, then fade fast at the end */}
              <animate attributeName="opacity" values="0.9;0.6;0"      keyTimes="0;0.7;1" dur={dur} begin={beg(r.delay)} repeatCount="indefinite" />
            </circle>
          ))}
        </>
      )}
    </svg>
  );
}

// ─── C · Bud bloom — ORGANIC v3 (Tarik 2026-05-30 "more playful, leaves
//     less symmetrical, like real leaves, different from each other") ──
//
// v2 was 8 identical-shape ellipses with hand-tuned rx/ry — still read
// as "plastic flower". v3 replaces each petal with a UNIQUE custom
// SVG path so every leaf has its own taper, asymmetry, width, and
// midrib (center vein) — like a real leaf, not a math primitive.
//
// Visible changes:
//   • 7 leaves (not 8) — odd count breaks the "kaleidoscope" feel
//   • Each leaf is a different hand-drawn <path>: slim, wide, droopy,
//     pointed, curled. None match.
//   • Each carries a faint dark midrib stroke — anatomy that says LEAF
//   • Color palette spans 5 greens (forest → emerald → lime → sage →
//     deep) so the spread reads natural, not factory-coated
//   • Jittered radial angles ([8°, 56°, 110°, 162°, 218°, 270°, 322°])
//     so leaves don't sit on a 360/7 grid — closer to a real sprig
//   • Bouncy cubic-bezier-overshoot keyframes (cg-leaf-1 … cg-leaf-7)
//     with a brief wobble at peak — "playful, alive" per Tarik
//   • Heart drifts slowly on a 6.1s rhythm (off-beat from every leaf)
function BudBloom({ size, working }) {
  // CERGIO-GUARD (2026-05-30): rest state is now FULL bloom (scale 1)
  // not 0.62. Tarik: "make the logo full and static on loading the
  // initial pages and homepage... only animate when it triggers an
  // action". At rest, all 7 leaves sit fully extended; the animation
  // only fires when `working` is true (search executing, splash hero
  // working flag, etc.). Was 0.62 (closed-bud rest) — now the brand
  // mark always reads as a finished, mature plant unless something is
  // actively happening.
  const restScale = 1;
  // Each leaf:
  //   d      — path RELATIVE to (60,60) center, pointing up; tip ≈ y=22–34
  //   vein   — subtle midrib path (1.1px dark stroke) for "real leaf" anatomy
  //   fill   — green from the 5-stop palette
  //   rot    — degrees rotated around (60,60). Jittered, not 360/N.
  //   cls    — per-leaf keyframe class (.cg-leaf-1 … .cg-leaf-7)
  //   opacity — 0.78–0.96, varied so the layer reads with depth
  // CERGIO-GUARD (2026-05-30 v4): wider, rounder, longer petals so the
  // 7 leaves OVERLAP at rest into a closed full-round flower silhouette
  // (Tarik: "make the still non animated state open into a full round
  // flower... not perfectly symmetrical but full round"). Each petal:
  //   • Reaches out to y≈18 (40-unit radius from heart, was ~30-32)
  //     so the tips sit on a near-circle of radius ~42px in the 120
  //     viewBox.
  //   • 24-28 units wide at its midpoint (was ~16-20) so adjacent
  //     petals touch + overlap at ~360/7 ≈ 51° spacing.
  //   • Lobed (smooth rounded tip) instead of pointed — reads as a
  //     daisy/marigold petal, not a leaf-spear.
  //   • Still UNIQUE per leaf — control points jittered so the
  //     silhouette isn't perfectly symmetrical.
  const leaves = [
    {
      // 1: tall, dark forest, slight left lean
      d: 'M 60 60 C 47 54, 44 32, 56 19 C 64 16, 71 22, 73 35, 71 56 Z',
      vein: 'M 60 60 L 58 22',
      fill: '#1E4D00', opacity: 0.94, rot:   8, cls: 'cg-leaf-1',
    },
    {
      // 2: broad emerald, fuller right side
      d: 'M 60 60 C 47 54, 44 35, 56 21 C 64 17, 72 23, 74 38, 71 58 Z',
      vein: 'M 60 60 Q 58 42 58 24',
      fill: '#3FA821', opacity: 0.86, rot:  56, cls: 'cg-leaf-2',
    },
    {
      // 3: longest, deep green, tip pushed highest
      d: 'M 60 60 C 47 55, 43 30, 56 17 C 64 14, 72 20, 74 34, 72 56 Z',
      vein: 'M 60 60 L 58 19',
      fill: '#2C5D21', opacity: 0.95, rot: 110, cls: 'cg-leaf-3',
    },
    {
      // 4: full sage lobe, slightly shorter
      d: 'M 60 60 C 48 55, 45 36, 57 24 C 65 21, 72 26, 73 39, 71 57 Z',
      vein: 'M 60 60 L 60 27',
      fill: '#639922', opacity: 0.82, rot: 162, cls: 'cg-leaf-4',
    },
    {
      // 5: largest blade, deep emerald
      d: 'M 60 60 C 47 54, 43 30, 56 18 C 65 14, 72 21, 75 36, 71 58 Z',
      vein: 'M 60 60 Q 58 38 58 21',
      fill: '#2F6E00', opacity: 0.96, rot: 218, cls: 'cg-leaf-5',
    },
    {
      // 6: vivid lime, leans right
      d: 'M 60 60 C 48 56, 46 34, 58 22 C 66 18, 72 24, 74 38, 71 57 Z',
      vein: 'M 60 60 L 61 24',
      fill: '#5BC404', opacity: 0.84, rot: 270, cls: 'cg-leaf-6',
    },
    {
      // 7: mid emerald, slightly waved
      d: 'M 60 60 C 47 55, 44 33, 56 20 C 65 16, 72 22, 74 37, 71 57 Z',
      vein: 'M 60 60 Q 58 42 58 23',
      fill: '#3FA821', opacity: 0.88, rot: 322, cls: 'cg-leaf-7',
    },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {leaves.map((leaf, i) => (
        <g
          key={i}
          className={working ? leaf.cls : ''}
          style={{
            transformOrigin: '60px 60px',
            transformBox: 'view-box',
            transform: working ? undefined : `scale(${restScale})`,
          }}
        >
          <g transform={`rotate(${leaf.rot} 60 60)`}>
            <path
              d={leaf.d}
              fill={leaf.fill}
              opacity={leaf.opacity}
              strokeLinejoin="round"
            />
            {/* midrib — sub-pixel inset of the leaf body so it reads
                as anatomical rather than decorative */}
            <path
              d={leaf.vein}
              stroke="#0F2A00"
              strokeWidth="0.9"
              strokeLinecap="round"
              fill="none"
              opacity="0.55"
            />
          </g>
        </g>
      ))}
      {/* Heart drifts a sub-pixel as it pulses — adds the "alive" feel
          even when leaves are mid-cycle. Pale-orange blob smear for
          painterly depth, white highlight for life. */}
      <g
        className={working ? 'cg-bud-heart' : ''}
        style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }}
      >
        <circle cx="60" cy="60" r="11" fill="#F4A06A" />
        <ellipse cx="57" cy="58" rx="6" ry="4" fill="#FBCBA6" opacity="0.55" />
        <circle cx="60" cy="60" r="3.5" fill="#FFFFFF" opacity="0.88" />
      </g>
    </svg>
  );
}

// ─── D · Pollen pulse ─────────────────────────────────────────────────────
// Central core (bigger, r=28) that pulses + 6 seeds that drift outward
// and return on a 4s cycle. At rest the core dominates; seeds tuck
// against it (positioned 30px out so they appear as small satellites
// even when static). When working, seeds drift further out and back.
function PollenPulse({ size, working }) {
  const coreClass = working ? 'cg-pollen-core' : '';
  // 6 seeds positioned around the core at rest (small satellites).
  // Each cls animates outward when working.
  const seeds = [
    { x: 92, y: 60, fill: '#639922', cls: 'cg-pollen-s1', delay: '0s'   },
    { x: 82, y: 82, fill: '#639922', cls: 'cg-pollen-s2', delay: '0.5s' },
    { x: 60, y: 92, fill: '#97C459', cls: 'cg-pollen-s3', delay: '1s'   },
    { x: 38, y: 82, fill: '#97C459', cls: 'cg-pollen-s4', delay: '1.5s' },
    { x: 28, y: 60, fill: '#C0DD97', cls: 'cg-pollen-s5', delay: '2s'   },
    { x: 60, y: 28, fill: '#C0DD97', cls: 'cg-pollen-s6', delay: '2.5s' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="28" fill="#3B6D11" className={coreClass}
              style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }} />
      {/* Highlight wedge for life */}
      <ellipse cx="52" cy="52" rx="8" ry="5" fill="#97C459" opacity="0.4" />
      {seeds.map((s, idx) => (
        <circle
          key={idx}
          cx={s.x} cy={s.y} r="5" fill={s.fill}
          className={working ? s.cls : ''}
          style={{
            transformOrigin: `${s.x}px ${s.y}px`,
            transformBox: 'view-box',
            animationDelay: working ? s.delay : undefined,
          }}
        />
      ))}
    </svg>
  );
}

// ─── A · Sprout (the prior default — kept for the 'sprout' option) ────────
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
        <linearGradient id={gStem} x1="50%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%"   stopColor="#5C3A14" />
          <stop offset="35%"  stopColor="#3D6614" />
          <stop offset="100%" stopColor="#3D8B00" />
        </linearGradient>
        <linearGradient id={gBot} x1="15%" y1="100%" x2="80%" y2="10%">
          <stop offset="0%"   stopColor="#2F6E00" />
          <stop offset="55%"  stopColor="#3D8B00" />
          <stop offset="100%" stopColor="#5BC404" />
        </linearGradient>
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
      <path d="M 36 124 L 44 124" stroke="#5C3A14" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
      <path d="M 48 125 L 56 125" stroke="#5C3A14" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <path d="M 60 124 L 68 124" stroke="#5C3A14" strokeWidth="1.5" strokeLinecap="round" opacity="0.30" />
      <g className="cg-sprout-stem" style={{ transformOrigin: '50px 124px', transformBox: 'view-box' }}>
        <path d="M 50 124 C 49 100, 52 80, 50 60 C 48 50, 51 44, 50 38" stroke={`url(#${gStem})`} strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <g className="cg-sprout-bot" style={{ transformOrigin: '50px 78px', transformBox: 'view-box' }}>
          <path d="M 50 78 C 42 78, 32 80, 24 84 C 16 86, 10 92, 8 100 C 12 102, 16 100, 20 102 C 14 106, 12 112, 18 114 C 26 112, 32 108, 38 102 C 40 98, 44 90, 50 84 Z" fill={`url(#${gBot})`} />
          <path d="M 50 80 Q 30 92 12 108" stroke="#1E4D00" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.75" />
          {[
            { d: 'M 42 86 Q 32 92 22 96',  delay: '0s'   },
            { d: 'M 34 94 Q 24 98 16 104', delay: '.18s' },
            { d: 'M 28 104 Q 22 108 18 112', delay: '.36s' },
          ].map((v, idx) => (
            <path key={`vb-${idx}`} d={v.d} stroke="#1E4D00" strokeWidth="0.6" strokeLinecap="round" fill="none"
                  className={working ? VEIN : ''}
                  style={working ? { animationDelay: v.delay } : { opacity: 0.45 }} />
          ))}
        </g>
        <g className="cg-sprout-top" style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}>
          <path d="M 50 50 C 58 48, 68 44, 76 38 C 84 34, 90 28, 92 18 C 88 14, 82 16, 78 14 C 82 10, 84 4, 78 2 C 70 4, 64 8, 58 16 C 54 22, 50 32, 50 42 Z" fill={`url(#${gTop})`} />
          <path d="M 50 50 C 58 48, 68 44, 76 38 C 84 34, 90 28, 92 18 C 88 14, 82 16, 78 14 C 82 10, 84 4, 78 2 C 70 4, 64 8, 58 16 C 54 22, 50 32, 50 42 Z" fill={`url(#${hTop})`} />
          <path d="M 50 48 Q 68 28 84 8" stroke="#1E4D00" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.80" />
          {[
            { d: 'M 56 42 Q 66 36 76 30', delay: '0s'   },
            { d: 'M 62 34 Q 72 26 82 18', delay: '.14s' },
            { d: 'M 68 26 Q 76 18 84 12', delay: '.28s' },
            { d: 'M 56 50 Q 66 44 74 38', delay: '.42s' },
          ].map((v, idx) => (
            <path key={`vt-${idx}`} d={v.d} stroke="#1E4D00" strokeWidth="0.7" strokeLinecap="round" fill="none"
                  className={working ? VEIN : ''}
                  style={working ? { animationDelay: v.delay } : { opacity: 0.5 }} />
          ))}
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

const MARKS = {
  sprout: Sprout,
  rings:  GrowthRings,
  bud:    BudBloom,
  pollen: PollenPulse,
};
