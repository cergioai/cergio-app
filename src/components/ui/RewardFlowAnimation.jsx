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
    title: 'Free service → Free spotlight.',
    body: () =>
      `Connectors swap reach for service. The provider gives you a free service; you post one IG / TikTok spotlight back. 10+ services a month, thousands in value, all free — paid in audience, not cash.`,
  },
  {
    num: '03',
    title: 'Growth Participation Income.',
    body: () =>
      `Human-powered AI · Shared prosperity. Every dollar you earn becomes a share of Cergio's growth. The earlier you join, the more your share compounds — regular income, tied to how much the network you helped grow keeps growing.`,
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
      {/* CERGIO-GUARD (2026-05-30): cash-vs-credit footnote per Tarik:
          "add small note that connectors get cash and normal users
          get credit". Two soft pills at the bottom, no shouting. */}
      <g className="rf-pop" style={{ animationDelay: '3.4s' }}>
        <rect x={36} y={232} width={166} height={18} rx={9} fill="#F3FFEA" stroke="#3D8B00" strokeWidth={0.8} />
        <text x={119} y={245} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">
          Connectors earn CASH
        </text>
        <rect x={210} y={232} width={154} height={18} rx={9} fill="#F4F4F2" stroke="#A0A0A2" strokeWidth={0.8} />
        <text x={287} y={245} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#3D3D3D" fontFamily="system-ui">
          Users earn credit
        </text>
      </g>
    </>
  );
}

// ─── Scene 2 — Barter sequence (Free service → Free spotlight) ──────────
// CERGIO-GUARD (2026-05-30 v9): rebuilt per Tarik: "show instagram
// tiktok and better layout of barter superior simple designs perhaps
// show the sequence first free services then free spotlight.. use
// arrows... show the audience of the influencer... and how a
// connector can get 10's of services per month (worth thousands)".
//
// Two-step diagram:
//   PROVIDER — free service →  CONNECTOR (you)
//                                   ↓ free spotlight
//                               IG · TT audience (50K+ reach)
// Footer punchline anchors the value: 10+ services/month, thousands
// in barter value, all free.
function Scene2() {
  return (
    <>
      <PhaseBadge num="02" />

      {/* Headline — single line */}
      <text
        x={200} y={56}
        textAnchor="middle"
        fontSize="18" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '0.3s' }}
      >
        Free service → Free spotlight.
      </text>

      {/* Step 1 — Provider gives free service to Connector */}
      <g className="rf-pop" style={{ animationDelay: '1.1s' }}>
        {/* Provider tile */}
        <rect x={28} y={80} width={130} height={54} rx={10} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1} />
        <text x={93} y={100} textAnchor="middle" fontSize="10" fontWeight="800" fill="#5F5E5A" fontFamily="system-ui">PROVIDER</text>
        <text x={93} y={120} textAnchor="middle" fontSize="14" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui">$250 service</text>

        {/* Arrow with label */}
        <path d="M 162 107 L 230 107" stroke="#2F6E00" strokeWidth="2" fill="none" strokeLinecap="round" />
        <polygon points="230,101 240,107 230,113" fill="#2F6E00" />
        <text x={196} y={97} textAnchor="middle" fontSize="10" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">free service</text>

        {/* Connector tile (you) */}
        <rect x={244} y={80} width={130} height={54} rx={10} fill="#F3FFEA" stroke="#2F6E00" strokeWidth={1.5} />
        <text x={309} y={100} textAnchor="middle" fontSize="10" fontWeight="800" fill="#2C5D21" fontFamily="system-ui">CONNECTOR</text>
        <text x={309} y={120} textAnchor="middle" fontSize="14" fontWeight="900" fill="#2C5D21" fontFamily="system-ui">that&apos;s you</text>
      </g>

      {/* Step 2 — Connector posts spotlight to IG/TT audience */}
      <g className="rf-pop" style={{ animationDelay: '2.1s' }}>
        {/* Down arrow from Connector tile to audience */}
        <path d="M 309 142 L 309 168" stroke="#2F6E00" strokeWidth="2" fill="none" strokeLinecap="round" />
        <polygon points="303,168 309,178 315,168" fill="#2F6E00" />
        <text x={319} y={158} fontSize="10" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">free spotlight</text>

        {/* Audience bar at bottom — IG + TT + reach dots */}
        <rect x={28} y={186} width={344} height={42} rx={10} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1} />

        {/* IG icon (rounded square + lens + dot) */}
        <g transform="translate(50, 207)">
          <rect x="-9" y="-9" width="18" height="18" rx="4.5" fill="none" stroke="#1A1A1A" strokeWidth="1.6" />
          <circle cx="0" cy="0" r="4.5" fill="none" stroke="#1A1A1A" strokeWidth="1.6" />
          <circle cx="6" cy="-6" r="1.4" fill="#1A1A1A" />
        </g>
        {/* TT mark (stylized musical note) */}
        <g transform="translate(82, 207)">
          <path d="M 6 -9 L 6 4.5 A 4.5 4.5 0 1 1 -1 0 L -1 -4.5 A 8 8 0 0 0 6 0 Z"
                fill="#1A1A1A" />
        </g>

        {/* Reach label */}
        <text x={110} y={202} fontSize="11.5" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui">Your audience</text>
        <text x={110} y={218} fontSize="10.5" fontWeight="600" fill="#5F5E5A" fontFamily="system-ui">50K+ followers</text>

        {/* Reach indicator — cluster of fading people-dots */}
        <g transform="translate(296, 207)">
          {[0, 12, 24, 36, 48].map((dx, i) => (
            <circle key={i} cx={dx - 24} cy={0} r={5 - i * 0.4} fill="#2F6E00" opacity={1 - i * 0.16} />
          ))}
        </g>
      </g>

      {/* CERGIO-GUARD (2026-05-30): ripple-back arrows from the
          audience BACK to the Provider tile so the network effect
          reads visually — Tarik: "arrows back from the connector's
          audience to the services... or other to show the effect of
          spotlight". The spotlight isn't a one-way payment, it's a
          loop: audience → new customers → more revenue to provider
          → which is why the provider was willing to barter in the
          first place. */}
      <g className="rf-pop" style={{ animationDelay: '2.8s' }}>
        {/* Curved arrow from audience-left back up to provider tile.
            Quadratic curve sweeping out left of the diagram. */}
        <path
          d="M 50 196 Q 12 150, 30 96 Q 36 84, 60 84"
          stroke="#F0A030" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeDasharray="3 3"
        />
        <polygon points="60,80 70,84 60,88" fill="#F0A030" />
        <text x={4} y={150} fontSize="9.5" fontWeight="800" fill="#8A5A10" fontFamily="system-ui"
              transform="rotate(-90 14 150)">
          new customers
        </text>
      </g>

      {/* Punchline footer — the "thousands of dollars" payoff */}
      <text
        x={200} y={250}
        textAnchor="middle"
        fontSize="11" fontWeight="800" fill="#2C5D21" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '3.4s' }}
      >
        10+ services / month · thousands in value · all free
      </text>
    </>
  );
}

// ─── Scene 3 — Growth Participation Income (curves over time) ──────────
// CERGIO-GUARD (2026-05-30 v9): rebuilt per Tarik: "spell out Growth
// Participation Income... With Human Powered AI... show it's regular
// income relative to platform use and initial date of adoption... make
// ultra simple but users should infer the power of [1] spotlight (and
// ripples of networks turning into users) and [2] the intelligence
// and humanity of being a partner via growth participation income".
//
// Layout: spelled-out title at top-left, then THREE growth curves
// (early / mid / late adopter) over a 5-year X axis. The early-adopter
// curve climbs fastest because their ripples (invites, recos,
// spotlights) compounded across the whole platform window. Footer
// caps the meaning in one line.
function Scene3() {
  // X-axis at y=210 spans 50 → 370. Each curve starts at a different
  // year (earlier joiners start earlier) and climbs progressively.
  return (
    <>
      <PhaseBadge num="03" />

      {/* Title spelled OUT — Tarik: "spell out Growth Participation
          Income" */}
      <g className="rf-pop" style={{ animationDelay: '0.3s' }}>
        <text x={36} y={62} fontSize="17" fontWeight="900" fill="#1A1A1A" fontFamily="system-ui">
          Growth Participation Income.
        </text>
        <text x={36} y={80} fontSize="11" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">
          Human-powered AI · Shared prosperity.
        </text>
      </g>

      {/* Axes — subtle */}
      <g className="rf-pop" style={{ animationDelay: '0.9s' }}>
        <line x1={50} y1={210} x2={370} y2={210} stroke="#A0A0A2" strokeWidth={1} />
        <line x1={50} y1={100} x2={50} y2={210} stroke="#A0A0A2" strokeWidth={1} />
        {/* Year tick labels */}
        <text x={50}  y={224} fontSize="8.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui">YR 1</text>
        <text x={210} y={224} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui">YR 3</text>
        <text x={370} y={224} textAnchor="end" fontSize="8.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui">YR 5</text>
        {/* Y axis label */}
        <text x={44} y={104} textAnchor="end" fontSize="8.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui">$$$</text>
      </g>

      {/* Early adopter — steepest, full 5-year compound */}
      <g className="rf-pop" style={{ animationDelay: '1.6s' }}>
        <path
          d="M 50 205 Q 130 195, 200 165 T 370 100"
          stroke="#2F6E00" strokeWidth="3" fill="none" strokeLinecap="round"
        />
        <circle cx={370} cy={100} r={4.5} fill="#2F6E00" />
        <circle cx={370} cy={100} r={10}  fill="#2F6E00" opacity={0.18} />
        <text x={364} y={94} textAnchor="end" fontSize="9.5" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">early adopter</text>
      </g>

      {/* Mid adopter — joined later, lower ceiling */}
      <g className="rf-pop" style={{ animationDelay: '2.1s' }}>
        <path
          d="M 130 205 Q 200 198, 270 175 T 370 142"
          stroke="#639922" strokeWidth="2.4" fill="none" strokeLinecap="round"
        />
        <circle cx={370} cy={142} r={4} fill="#639922" />
        <text x={364} y={138} textAnchor="end" fontSize="9" fontWeight="700" fill="#639922" fontFamily="system-ui">mid adopter</text>
      </g>

      {/* Late adopter — joined recently, gentler slope */}
      <g className="rf-pop" style={{ animationDelay: '2.6s' }}>
        <path
          d="M 230 205 Q 280 200, 320 192 T 370 178"
          stroke="#97C459" strokeWidth="2" fill="none" strokeLinecap="round"
        />
        <circle cx={370} cy={178} r={3.5} fill="#97C459" />
        <text x={364} y={174} textAnchor="end" fontSize="8.5" fontWeight="700" fill="#77A038" fontFamily="system-ui">late adopter</text>
      </g>

      {/* CERGIO-GUARD (2026-05-30): network-growth note — Tarik:
          "add small note on GPI (relative to participation /
          connector's network growth...)". Sits just above the footer
          punchline so the user reads: "tied to YOUR network", then
          "earlier you join → bigger ripples". Two facts stacked,
          neither lost. */}
      <text
        x={200} y={236}
        textAnchor="middle"
        fontSize="9.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '3.0s' }}
      >
        Tied to YOUR participation × YOUR network&apos;s growth
      </text>
      {/* Footer — single sentence the user infers everything from.
          "Ripples" hints at the spotlight network-of-networks effect;
          "human-powered" hints at the AI+partnership story. */}
      <text
        x={200} y={252}
        textAnchor="middle"
        fontSize="10.5" fontWeight="800" fill="#2C5D21" fontFamily="system-ui"
        className="rf-pop"
        style={{ animationDelay: '3.6s' }}
      >
        The earlier you join, the bigger your ripples — regular income for life.
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
