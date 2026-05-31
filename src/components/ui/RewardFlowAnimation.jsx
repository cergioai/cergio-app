// CERGIO-GUARD (2026-05-30 v8): reward-flow animation — succinct, slow.
//
// v7 was too busy: 5-row tables, 3 booking math rows, 3 stat cards,
// staggered pops back-to-back. Tarik: "make succinct, elegant, simple,
// human... should just be 1-invite reco earn.. 2-barter (free
// services..etc)...3-GPI (prosperity together...)".
//
// Three scenes, one idea each. No tables, no math grids, no booking
// tiles. Two big words + one line of supporting copy per scene. Slow
// fade-in (1.4s) with generous staggers; auto-advance 11s so each
// scene breathes. Numbers (REWARDS.perFriend, exampleTotal, fee) still
// pulled from constants — never hardcoded — so the system source of
// truth remains intact and qa.mjs #24 stays green.

import { useEffect, useRef, useState } from 'react';
import { REWARDS } from '../../lib/rewards';

const STEPS = [
  {
    num: '01',
    title: 'Invite. Reco. Earn.',
    body: () =>
      `Bring friends in, recommend the services you already trust, and earn $${REWARDS.perFriend} per friend. ${REWARDS.referrerSharePercent}% of every booking flows back to you, up to the ${REWARDS.perFriend}-dollar cap.`,
  },
  {
    num: '02',
    title: 'Barter for free services.',
    body: () =>
      `Connectors trade their reach for free services from providers — a clean haircut, a deep clean, a personal trainer — all paid in spotlight, not cash.`,
  },
  {
    num: '03',
    title: 'AI-driven shared prosperity.',
    body: () =>
      `Growth Participation Income — Cergio's AI grows the orchard. Every dollar you earn builds your share of it, so when the orchard pays, the gardeners get paid too.`,
  },
];

// ─── Visual primitives ─────────────────────────────────────────────────────

function PhaseBadge({ num }) {
  return (
    <g className="rf-pop">
      <circle cx="30" cy="30" r="20" fill="#2F6E00" />
      <text x="30" y="36" textAnchor="middle" fontSize="16" fontWeight="900" fill="#FFFFFF" fontFamily="system-ui">
        {num}
      </text>
    </g>
  );
}

// ─── Scene 1 — Invite. Reco. Earn. ────────────────────────────────────────
// Three stacked words, each rising in turn. Single $250-per-friend
// number to its right. No tables, no breakdown rows.
function Scene1() {
  const words = [
    { txt: 'Invite.',  y: 120, delay: 0.4 },
    { txt: 'Reco.',    y: 158, delay: 1.2 },
    { txt: 'Earn.',    y: 196, delay: 2.0 },
  ];
  return (
    <>
      <PhaseBadge num="01" />
      {words.map(w => (
        <text
          key={w.txt}
          x={36} y={w.y}
          fontSize="38" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui"
          className="rf-pop"
          style={{ animationDelay: `${w.delay}s`, transformOrigin: `36px ${w.y}px`, transformBox: 'view-box' }}
        >
          {w.txt}
        </text>
      ))}
      {/* Big number to the right — appears last, ties the three verbs
          back to the dollar payoff */}
      <g className="rf-pop" style={{ animationDelay: '2.8s' }}>
        <text x={372} y={132} textAnchor="end" fontSize="14" fontWeight="700" fill="#7A7A7A" fontFamily="system-ui">
          per friend
        </text>
        <text x={372} y={172} textAnchor="end" fontSize="34" fontWeight="900" fill="#2F6E00" fontFamily="system-ui">
          ${REWARDS.perFriend}
        </text>
        <text x={372} y={198} textAnchor="end" fontSize="11" fontWeight="600" fill="#7A7A7A" fontFamily="system-ui">
          {REWARDS.exampleFriends} friends → ${REWARDS.exampleTotal.toLocaleString()}
        </text>
      </g>
    </>
  );
}

// ─── Scene 2 — Barter for free services ──────────────────────────────────
// Two profile circles with an exchange arrow between them. Words above
// describe the trade. No price math, no fee anatomy.
function Scene2() {
  return (
    <>
      <PhaseBadge num="02" />

      {/* Headline — single line */}
      <text
        x={200} y={84}
        textAnchor="middle"
        fontSize="22" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '0.4s' }}
      >
        Free services. Real value.
      </text>

      {/* Two circles + double-headed arrow */}
      <g className="rf-pop" style={{ animationDelay: '1.4s' }}>
        {/* Connector circle */}
        <circle cx={130} cy={150} r={32} fill="#2F6E00" />
        <text x={130} y={143} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">CONNECTOR</text>
        <text x={130} y={158} textAnchor="middle" fontSize="11" fontWeight="900" fill="#FFFFFF" fontFamily="system-ui">spotlight</text>

        {/* Arrows */}
        <path d="M 175 144 L 219 144" stroke="#2F6E00" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <polygon points="219,138 230,144 219,150" fill="#2F6E00" />
        <path d="M 225 156 L 181 156" stroke="#3D8B00" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <polygon points="181,162 170,156 181,150" fill="#3D8B00" />

        {/* Provider circle */}
        <circle cx={270} cy={150} r={32} fill="#F3FFEA" stroke="#2F6E00" strokeWidth="2" />
        <text x={270} y={143} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">PROVIDER</text>
        <text x={270} y={158} textAnchor="middle" fontSize="11" fontWeight="900" fill="#2F6E00" fontFamily="system-ui">service</text>
      </g>

      {/* Footer line — one sentence */}
      <text
        x={200} y={222}
        textAnchor="middle"
        fontSize="12" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '2.4s' }}
      >
        Connectors trade reach. Providers trade service. Both win.
      </text>
    </>
  );
}

// ─── Scene 3 — Prosperity, together (GPI) ────────────────────────────────
// One rising line + one big sentence. No three-card stat row.
function Scene3() {
  // Rising-line geometry — five waypoints that climb gently from
  // bottom-left to top-right.
  const linePath = 'M 40 200 C 90 195, 130 175, 170 160 C 210 148, 250 130, 300 110 C 320 102, 350 88, 370 78';
  return (
    <>
      <PhaseBadge num="03" />

      {/* Big two-line headline — rises in. CERGIO-GUARD (2026-05-30):
          rewritten to "AI-driven shared prosperity · via GPI" per
          Tarik's positioning. */}
      <g className="rf-pop" style={{ animationDelay: '0.4s' }}>
        <text x={36} y={84} fontSize="20" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui">
          AI-driven shared
        </text>
        <text x={36} y={108} fontSize="20" fontWeight="900" fill="#2F6E00" fontFamily="system-ui">
          prosperity · via GPI
        </text>
      </g>

      {/* Rising line — fades up after the headline */}
      <g className="rf-pop" style={{ animationDelay: '1.6s' }}>
        <path d={linePath} stroke="#2F6E00" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Dot at the top of the line */}
        <circle cx={370} cy={78} r={6} fill="#2F6E00" />
        <circle cx={370} cy={78} r={11} fill="#2F6E00" opacity={0.18} />
      </g>

      {/* Single supporting line — appears last */}
      <text
        x={200} y={228}
        textAnchor="middle"
        fontSize="11.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '2.6s' }}
      >
        Every dollar you earn builds your share of Cergio's growth.
      </text>
    </>
  );
}

const SCENES = [Scene1, Scene2, Scene3];

// ─── Component ─────────────────────────────────────────────────────────────

export function RewardFlowAnimation() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef(null);

  // CERGIO-GUARD (2026-05-30): 8s → 11s so each scene has time to
  // breathe. With three slow fade-ins inside each (last one lands
  // around 2.8s), 11s gives ~8s of "rest" where the user can read
  // the caption before the next scene displaces it.
  useEffect(() => {
    if (!auto) return;
    timerRef.current = setTimeout(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 11000);
    return () => clearTimeout(timerRef.current);
  }, [step, auto]);

  const s = STEPS[step];
  const Scene = SCENES[step];

  const next   = () => { setAuto(false); setStep((v) => Math.min(STEPS.length - 1, v + 1)); };
  const prev   = () => { setAuto(false); setStep((v) => Math.max(0, v - 1)); };
  const replay = () => { setStep(0); setAuto(true); };

  return (
    <div className="px-1">
      {/* Stage — taller (260) so the headline + visual breathe */}
      <div
        className="w-full rounded-[14px] overflow-hidden"
        style={{ height: 260, background: 'linear-gradient(180deg, #F3F8FF 0%, #FFF9EA 65%, #F1EFE8 100%)' }}
      >
        <svg viewBox="0 0 400 260" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <g key={`scene-${step}`}>
            <Scene />
          </g>
        </svg>
      </div>

      {/* Caption */}
      <div className="py-3 px-1">
        <p className="text-[16px] font-extrabold text-black leading-tight">{s.title}</p>
        <p className="text-[12px] text-b3 mt-1.5 leading-snug">{s.body()}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={prev}
          className="text-[12px] font-bold text-b2 bg-white border border-bdr rounded-pill px-3 py-1.5 hover:bg-bg5/30"
        >
          Back
        </button>
        <div className="flex-1 h-1 bg-bg5 rounded overflow-hidden">
          <div
            className="h-full bg-g transition-all duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <button
          onClick={step === STEPS.length - 1 ? replay : next}
          className="text-[12px] font-bold text-white bg-g rounded-pill px-3 py-1.5 hover:opacity-90"
        >
          {step === STEPS.length - 1 ? 'Replay' : 'Next'}
        </button>
      </div>
    </div>
  );
}
