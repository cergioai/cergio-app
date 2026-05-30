// CERGIO-GUARD (2026-05-30): /logo-lab — visual A/B testing screen for
// the brand mark. Tarik uploaded the goat-on-green mascot mockup and
// asked for the animated logos re-skinned with that palette (mascot
// peach + Romio green + cream), in MIXED color dominances so we can
// pick a final winner. Each candidate shows fixed (rest) + pulsating
// (working) side by side.
//
// The candidates here are SELF-CONTAINED — they don't go through
// LeafLogo.jsx. Once Tarik picks a winner, we port that one back into
// LeafLogo.jsx (replacing one of the existing variants' palettes) and
// flip LOGO_VARIANT to match.
//
// Reuses existing index.css keyframes (cg-rings-core, cg-bud-bloom,
// cg-pollen-core, cg-pollen-s1..s6) so animations match what ships.
import { Link } from 'react-router-dom';

// ─── Mascot palette ──────────────────────────────────────────────────────
// Sampled from the Jennifer Leighton mockup mascot (orange goat icon
// on bright green disc, set on cream).
const PAL = {
  greenDeep:  '#2C5D21',   // outer rim / dark stroke
  greenCore:  '#3FA821',   // mascot disc (bright Romio green)
  greenSoft:  '#9BD96B',   // soft fade
  greenPale:  '#D7EFC4',   // disc halo / cream tint
  peach:      '#F4A06A',   // mascot goat warm peach
  peachDeep:  '#E67A3C',   // peach shadow
  peachSoft:  '#FBCBA6',   // pale peach
  cream:      '#FFF6E0',   // page bg
  white:      '#FFFFFF',
};

// ─── Candidate 1 · Rings — Green dominant, peach final ring ──────────────
function C1Rings({ working, size = 88 }) {
  const dur = '2.4s';
  const beg = (d) => working ? `${d}s` : 'indefinite';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="36" fill={PAL.greenDeep} opacity="0.5" />
      <circle cx="60" cy="60" r="32" fill={PAL.greenCore}
              className={working ? 'cg-rings-core' : ''}
              style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }} />
      <ellipse cx="50" cy="48" rx="11" ry="7" fill={PAL.greenSoft} opacity="0.55" />
      {working && [
        { stroke: PAL.greenDeep, delay: 0,    w: 4 },
        { stroke: PAL.greenCore, delay: 0.48, w: 3.5 },
        { stroke: PAL.greenSoft, delay: 0.96, w: 3 },
        { stroke: PAL.peach,     delay: 1.44, w: 2.5 },
        { stroke: PAL.peachSoft, delay: 1.92, w: 2 },
      ].map((r, i) => (
        <circle key={i} cx="60" cy="60" r="34" fill="none" stroke={r.stroke} strokeWidth={r.w}>
          <animate attributeName="r"       values="34;56"      dur={dur} begin={beg(r.delay)} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0.6;0"  keyTimes="0;0.7;1" dur={dur} begin={beg(r.delay)} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

// ─── Candidate 2 · Rings — Peach core, green expanding rings ─────────────
function C2Rings({ working, size = 88 }) {
  const dur = '2.4s';
  const beg = (d) => working ? `${d}s` : 'indefinite';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="36" fill={PAL.peachDeep} opacity="0.45" />
      <circle cx="60" cy="60" r="32" fill={PAL.peach}
              className={working ? 'cg-rings-core' : ''}
              style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }} />
      <ellipse cx="50" cy="48" rx="11" ry="7" fill={PAL.peachSoft} opacity="0.6" />
      {working && [
        { stroke: PAL.greenDeep, delay: 0,    w: 4 },
        { stroke: PAL.greenCore, delay: 0.48, w: 3.5 },
        { stroke: PAL.greenSoft, delay: 0.96, w: 3 },
        { stroke: PAL.greenCore, delay: 1.44, w: 2.5 },
        { stroke: PAL.greenSoft, delay: 1.92, w: 2 },
      ].map((r, i) => (
        <circle key={i} cx="60" cy="60" r="34" fill="none" stroke={r.stroke} strokeWidth={r.w}>
          <animate attributeName="r"       values="34;56"     dur={dur} begin={beg(r.delay)} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0.6;0" keyTimes="0;0.7;1" dur={dur} begin={beg(r.delay)} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

// ─── Candidate 3 · Bud — Green petals + peach heart (G-dominant) ─────────
function C3Bud({ working, size = 88 }) {
  const cls = working ? 'cg-bud-bloom' : '';
  const restScale = 0.72;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className={cls} style={{ transformOrigin: '60px 60px', transformBox: 'view-box', transform: working ? undefined : `scale(${restScale})` }}>
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.greenDeep} opacity="0.92" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.greenDeep} opacity="0.92" transform="rotate(90 60 60)" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.greenCore} opacity="0.92" transform="rotate(45 60 60)" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.greenCore} opacity="0.92" transform="rotate(135 60 60)" />
      </g>
      <circle cx="60" cy="60" r="11" fill={PAL.peach} />
      <circle cx="60" cy="60" r="4"  fill={PAL.white} opacity="0.85" />
    </svg>
  );
}

// ─── Candidate 4 · Bud — Peach petals alternating + green heart (O-dom) ──
function C4Bud({ working, size = 88 }) {
  const cls = working ? 'cg-bud-bloom' : '';
  const restScale = 0.72;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g className={cls} style={{ transformOrigin: '60px 60px', transformBox: 'view-box', transform: working ? undefined : `scale(${restScale})` }}>
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.peach}     opacity="0.95" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.peach}     opacity="0.95" transform="rotate(90 60 60)" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.peachDeep} opacity="0.95" transform="rotate(45 60 60)" />
        <ellipse cx="60" cy="36" rx="14" ry="32" fill={PAL.peachDeep} opacity="0.95" transform="rotate(135 60 60)" />
      </g>
      <circle cx="60" cy="60" r="11" fill={PAL.greenCore} />
      <circle cx="60" cy="60" r="4"  fill={PAL.greenPale} opacity="0.9" />
    </svg>
  );
}

// ─── Candidate 5 · Pollen — Green core + mixed peach/green/cream seeds ───
function C5Pollen({ working, size = 88 }) {
  const coreCls = working ? 'cg-pollen-core' : '';
  const seeds = [
    { x: 92, y: 60, fill: PAL.peach,     cls: 'cg-pollen-s1', delay: '0s'   },
    { x: 82, y: 82, fill: PAL.greenCore, cls: 'cg-pollen-s2', delay: '0.5s' },
    { x: 60, y: 92, fill: PAL.cream,     cls: 'cg-pollen-s3', delay: '1s'   },
    { x: 38, y: 82, fill: PAL.peach,     cls: 'cg-pollen-s4', delay: '1.5s' },
    { x: 28, y: 60, fill: PAL.greenSoft, cls: 'cg-pollen-s5', delay: '2s'   },
    { x: 60, y: 28, fill: PAL.peachSoft, cls: 'cg-pollen-s6', delay: '2.5s' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="28" fill={PAL.greenCore} className={coreCls}
              style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }} />
      <ellipse cx="52" cy="52" rx="8" ry="5" fill={PAL.greenPale} opacity="0.55" />
      {seeds.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="5.5" fill={s.fill}
                stroke={PAL.white} strokeWidth="0.6"
                className={working ? s.cls : ''}
                style={{ transformOrigin: `${s.x}px ${s.y}px`, transformBox: 'view-box',
                         animationDelay: working ? s.delay : undefined }} />
      ))}
    </svg>
  );
}

// ─── Candidate 6 · Pollen — Peach core + green seeds + cream halo ────────
function C6Pollen({ working, size = 88 }) {
  const coreCls = working ? 'cg-pollen-core' : '';
  const seeds = [
    { x: 92, y: 60, fill: PAL.greenCore, cls: 'cg-pollen-s1', delay: '0s'   },
    { x: 82, y: 82, fill: PAL.greenDeep, cls: 'cg-pollen-s2', delay: '0.5s' },
    { x: 60, y: 92, fill: PAL.greenSoft, cls: 'cg-pollen-s3', delay: '1s'   },
    { x: 38, y: 82, fill: PAL.greenCore, cls: 'cg-pollen-s4', delay: '1.5s' },
    { x: 28, y: 60, fill: PAL.greenDeep, cls: 'cg-pollen-s5', delay: '2s'   },
    { x: 60, y: 28, fill: PAL.greenSoft, cls: 'cg-pollen-s6', delay: '2.5s' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* cream halo behind peach core */}
      <circle cx="60" cy="60" r="34" fill={PAL.cream} opacity="0.9" />
      <circle cx="60" cy="60" r="28" fill={PAL.peach} className={coreCls}
              style={{ transformOrigin: '60px 60px', transformBox: 'view-box' }} />
      <ellipse cx="52" cy="52" rx="8" ry="5" fill={PAL.peachSoft} opacity="0.7" />
      {seeds.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="5.5" fill={s.fill}
                stroke={PAL.white} strokeWidth="0.6"
                className={working ? s.cls : ''}
                style={{ transformOrigin: `${s.x}px ${s.y}px`, transformBox: 'view-box',
                         animationDelay: working ? s.delay : undefined }} />
      ))}
    </svg>
  );
}

// ─── Lab cell ────────────────────────────────────────────────────────────
function Cell({ label, dominance, Mark }) {
  return (
    <div className="border border-bdr rounded-2xl bg-white p-4 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[15px] font-extrabold text-black">{label}</p>
          <p className="text-[12px] text-b3 mt-0.5">{dominance}</p>
        </div>
      </div>
      <div className="flex items-center justify-around gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-24 h-24 rounded-full flex items-center justify-center"
               style={{ background: PAL.cream }}>
            <Mark working={false} size={88} />
          </div>
          <p className="text-[11px] text-b3 font-bold uppercase tracking-wide">Fixed</p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-24 h-24 rounded-full flex items-center justify-center"
               style={{ background: PAL.cream }}>
            <Mark working={true} size={88} />
          </div>
          <p className="text-[11px] text-b3 font-bold uppercase tracking-wide">Pulsating</p>
        </div>
      </div>
    </div>
  );
}

export function LogoLabScreen() {
  const candidates = [
    { label: 'C1 · Rings',  dominance: 'Green-dominant · peach final ring',          Mark: C1Rings },
    { label: 'C2 · Rings',  dominance: 'Peach core · green expanding rings',          Mark: C2Rings },
    { label: 'C3 · Bud',    dominance: 'Green petals · peach heart',                  Mark: C3Bud },
    { label: 'C4 · Bud',    dominance: 'Peach petals (alternating) · green heart',    Mark: C4Bud },
    { label: 'C5 · Pollen', dominance: 'Green core · mixed peach/green/cream seeds',  Mark: C5Pollen },
    { label: 'C6 · Pollen', dominance: 'Peach core · green seeds · cream halo',       Mark: C6Pollen },
  ];
  return (
    <div className="flex-1 flex flex-col bg-cream pb-16 overflow-y-auto">
      <div className="px-5 pt-5 pb-3">
        <Link to="/home" className="text-[13px] text-g font-bold underline">‹ Home</Link>
        <h1 className="text-[28px] font-extrabold text-black leading-tight mt-2">Logo lab</h1>
        <p className="text-[13px] text-b3 font-medium mt-1.5 leading-snug">
          Six candidates skinned with the mascot palette (peach + Romio green + cream),
          each at a different color dominance. Pick a winner and tell me — I'll port it
          back into LeafLogo and flip LOGO_VARIANT.
        </p>
      </div>
      <div className="px-5">
        {candidates.map((c) => (
          <Cell key={c.label} label={c.label} dominance={c.dominance} Mark={c.Mark} />
        ))}
      </div>
      <div className="px-5 mt-2">
        <p className="text-[11px] text-b3 leading-snug">
          Palette sampled from the Jennifer Leighton mockup mascot
          (orange goat on bright green disc, cream backdrop).
        </p>
      </div>
    </div>
  );
}
