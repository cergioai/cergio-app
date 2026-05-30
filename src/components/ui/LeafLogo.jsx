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
const LOGO_VARIANT = 'rings'; // 'sprout' | 'rings' | 'bud' | 'pollen'

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

// ─── C · Bud bloom ────────────────────────────────────────────────────────
// Four overlapping petals + a warm amber center. Bumped petal size
// (rx=14, ry=32) so even at rest scale 0.72 the closed bud fills the
// viewBox properly. Scales from 0.72 → 1.05 (slight over-shoot) when
// working, so the bloom feels like a real breath in/out.
function BudBloom({ size, working }) {
  const petalsClass = working ? 'cg-bud-bloom' : '';
  const restScale   = 0.72;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g
        className={petalsClass}
        style={{ transformOrigin: '60px 60px', transformBox: 'view-box', transform: working ? undefined : `scale(${restScale})` }}
      >
        <ellipse cx="60" cy="36" rx="14" ry="32" fill="#3B6D11" opacity="0.92" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill="#3B6D11" opacity="0.92" transform="rotate(90 60 60)" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill="#639922" opacity="0.92" transform="rotate(45 60 60)" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill="#639922" opacity="0.92" transform="rotate(135 60 60)" />
      </g>
      <circle cx="60" cy="60" r="10" fill="#EF9F27" />
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
