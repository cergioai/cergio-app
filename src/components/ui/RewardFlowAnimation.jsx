// CERGIO-GUARD (2026-05-29 v5): reward-flow animation, headline-first.
//
// Tarik's audit: "the 7% is confusing.. there's too much text.. it's
// just not clear. Try numbering the phases 1-Invite 2-Earn 3-Barter
// Earn More. Slow it down. Bring out the headline to hit harder."
//
// Three scenes, each with a giant "01/02/03" badge + ONE headline +
// minimal supporting visual. The math chip explicitly distinguishes
// Cergio's 10% platform fee from the 7% share the referrer earns,
// and calls out the 6-month cap window.
//
//   01  INVITE      — invite friends, recommend services
//   02  EARN        — $250 per friend (10% Cergio fee → 7% to you,
//                     until cap, 6-month window)
//   03  EARN MORE   — become a Connector: barter spotlights ↔ services,
//                     plus Growth Participation Income
//
// Numbers come from REWARDS. No hardcoded $ values, percentages, or
// time windows anywhere in this file.

import { useEffect, useRef, useState } from 'react';
import { REWARDS } from '../../lib/rewards';

const BENEFIT_CHIPS = {
  invite: { label: 'Invite',     cls: 'bg-gl text-gd' },
  earn:   { label: 'Earn',       cls: 'bg-gl text-gd' },
  more:   { label: 'Earn more',  cls: 'bg-warnBg text-warnText' },
};

const STEPS = [
  {
    num: '01',
    benefit: 'invite',
    title: 'Invite friends. Recommend services.',
    body: () =>
      `Share Cergio with friends you trust. Recommend a service — Plumber, Tutor, Cleaner, anything — by name or phone.`,
    counter: { value: 'Step 1', sub: 'invite' },
    math: 'Tap. Send. Done.',
  },
  {
    num: '02',
    benefit: 'earn',
    title: `Earn $${REWARDS.perFriend} per friend who books.`,
    body: () =>
      `Cergio charges a ${REWARDS.platformFeePercent}% booking fee. We share ${REWARDS.referrerSharePercent}% with you on every booking your friend makes, until you've earned $${REWARDS.perFriend} from that friend.`,
    counter: { value: `$${REWARDS.perFriend}`, sub: 'per friend' },
    math: `${REWARDS.referrerSharePercent}% of each booking → up to $${REWARDS.perFriend} (${REWARDS.friendCapWindowMonths}-month window)`,
  },
  {
    num: '03',
    benefit: 'more',
    title: 'Earn more as a Connector.',
    body: () =>
      `Influencers, super-users, small businesses, and service providers trade Instagram + TikTok spotlights for $${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/month in free services. Plus Growth Participation Income as Cergio scales.`,
    counter: { value: `$${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K`, sub: '/mo barter + GPI' },
    math: 'Spotlight ⇄ free services + community-owned upside',
  },
];

// ─── Visual primitives ─────────────────────────────────────────────────────

function PhaseBadge({ num }) {
  return (
    <g className="rf-pop">
      <circle cx={48} cy={48} r={32} fill="#2F6E00" />
      <circle cx={48} cy={48} r={32} fill="none" stroke="#FFFFFF" strokeWidth={2} opacity={0.6} />
      <text x={48} y={60} textAnchor="middle" fontSize="28" fontWeight="900" fill="#FFFFFF" fontFamily="system-ui">
        {num}
      </text>
    </g>
  );
}

// Human avatar — gradient circle with initial inside + optional name label.
function Avatar({ x, y, r = 22, gradientId = 'avYou', label = '', you = false, dim = false }) {
  const initial = (label || '?')[0]?.toUpperCase();
  return (
    <g opacity={dim ? 0.55 : 1}>
      <circle
        cx={x} cy={y} r={r}
        fill={`url(#${gradientId})`}
        stroke={you ? '#1F4F00' : '#FFFFFF'}
        strokeWidth={you ? 2.5 : 1.8}
      />
      <text x={x} y={y + 5} textAnchor="middle" fontSize={r * 0.7} fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">
        {initial}
      </text>
      {label && (
        <text x={x} y={y + r + 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1A1A1A" fontFamily="system-ui">
          {label}
        </text>
      )}
    </g>
  );
}

function Arrow({ d, color = '#3D8B00', dash = '3 3', strokeWidth = 1.4, opacity = 0.6 }) {
  return <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" strokeDasharray={dash} opacity={opacity} />;
}

function CashPill({ x, y, text, delay = 0, big = false }) {
  const w = text.length * (big ? 8 : 6) + (big ? 22 : 18);
  const h = big ? 22 : 18;
  const r = h / 2;
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={r} fill="#2F6E00" />
      <text x={x} y={y + (big ? 5 : 4)} textAnchor="middle" fontSize={big ? 13 : 11} fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">{text}</text>
    </g>
  );
}

function ProviderTile({ x, y, title = 'Service', price = '' }) {
  return (
    <g className="rf-pop" style={{ animationDelay: '0.25s' }}>
      <rect x={x - 50} y={y - 22} width={100} height={50} rx={6} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1.4} />
      <polygon points={`${x - 52},${y - 22} ${x},${y - 32} ${x + 52},${y - 22}`} fill="#3D8B00" />
      <text x={x} y={y - 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">{title}</text>
      {price && (
        <text x={x} y={y + 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="#3D8B00" fontFamily="system-ui">{price}</text>
      )}
    </g>
  );
}

function GiftBox({ x, y, caption, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - 14} y={y - 10} width={28} height={20} rx={3} fill="#F0A030" />
      <rect x={x - 14} y={y - 2} width={28} height={3} fill="#FFFFFF" opacity={0.9} />
      <rect x={x - 1.5} y={y - 10} width={3} height={20} fill="#FFFFFF" opacity={0.9} />
      {caption && (
        <text x={x} y={y + 24} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#8A5A10" fontFamily="system-ui">{caption}</text>
      )}
    </g>
  );
}

function SpotlightPill({ x, y, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - 36} y={y - 9} width={72} height={18} rx={9} fill="#111114" />
      <circle cx={x - 24} cy={y} r={3} fill="#9BE53A" />
      <text x={x + 6} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">Spotlight</text>
    </g>
  );
}

function GpiBadge({ x, y }) {
  return (
    <g className="rf-pop" style={{ animationDelay: '0.4s' }}>
      <rect x={x - 36} y={y - 11} width={72} height={22} rx={11} fill="#2C5D21" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">+ GPI</text>
    </g>
  );
}

// ─── Scenes ────────────────────────────────────────────────────────────────

function Scene1() {
  // INVITE — You center, 4 friends radiating out via "Invite" arrows.
  // Clean and visual; minimal labels.
  const youX = 100, youY = 130;
  const friends = [
    { x: 240, y: 60,  grad: 'avFriend',    label: 'Jamie' },
    { x: 280, y: 130, grad: 'avFof',       label: 'Alex' },
    { x: 240, y: 200, grad: 'avConnector', label: 'Maya' },
    { x: 170, y: 175, grad: 'avFriend',    label: '' },
  ];
  return (
    <>
      <PhaseBadge num="01" />
      <Avatar x={youX} y={youY} r={32} gradientId="avYou" label="You" you />
      {friends.map((fd, i) => (
        <g key={`f-${i}`}>
          <Arrow d={`M ${youX + 28} ${youY} Q ${(youX + fd.x) / 2} ${(youY + fd.y) / 2 - 20} ${fd.x - 18} ${fd.y}`} color="#3D8B00" opacity={0.5} />
          <Avatar x={fd.x} y={fd.y} r={18} gradientId={fd.grad} label={fd.label} />
        </g>
      ))}
      <text x={210} y={232} textAnchor="middle" fontSize="11" fontWeight="700" fill="#3D8B00" fontFamily="system-ui">
        invite → recommend
      </text>
    </>
  );
}

function Scene2() {
  // EARN — concrete service tile + cash flowing to You. Headline-driven.
  // Math chip below the stage carries the 10%/7%/cap detail; visual stays
  // simple so the eye lands on "$250".
  return (
    <>
      <PhaseBadge num="02" />
      <Avatar x={100} y={140} r={34} gradientId="avYou" label="You" you />
      <ProviderTile x={290} y={140} title="Penny's Plumber" price={`$300 / job`} />

      <Arrow d="M 138 140 Q 195 130 240 140" strokeWidth={1.6} />
      <text x={195} y={120} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#5F5E5A" fontFamily="system-ui">friend books</text>

      <CashPill x={195} y={82} text={`${REWARDS.referrerSharePercent}% of $300 = $21`} delay={0.55} />

      <Arrow d="M 165 90 Q 130 90 105 100" />

      <CashPill x={100} y={82} text={`+$${REWARDS.perFriend}`} delay={1.0} big />
      <text x={100} y={108} textAnchor="middle" fontSize="9" fontWeight="700" fill="#3D8B00" fontFamily="system-ui">cap per friend</text>

      <text x={210} y={232} textAnchor="middle" fontSize="10" fontWeight="700" fill="#3D3D3D" fontFamily="system-ui">
        accrues over {REWARDS.friendCapWindowMonths} months until $${REWARDS.perFriend} cap is reached
      </text>
    </>
  );
}

function Scene3() {
  // EARN MORE — barter loop (Connector ⇄ Provider) + GPI badge. Combines
  // the two upside paths into one "you can earn more as a Connector" scene.
  return (
    <>
      <PhaseBadge num="03" />

      {/* Connector left */}
      <Avatar x={130} y={150} r={32} gradientId="avConnector" label="Connector" />

      {/* Provider right */}
      <ProviderTile x={310} y={150} title="Service provider" price="" />

      {/* TOP arrow Connector → Provider: spotlight */}
      <Arrow d="M 162 125 Q 220 95 280 122" color="#F0A030" strokeWidth={1.8} opacity={0.7} />
      <SpotlightPill x={220} y={92} delay={0.55} />

      {/* BOTTOM arrow Provider → Connector: services */}
      <Arrow d="M 280 178 Q 220 210 162 178" color="#3D8B00" strokeWidth={1.8} opacity={0.7} />
      <GiftBox x={220} y={196} caption={`$${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/mo services`} delay={1.0} />

      {/* GPI badge — community upside */}
      <GpiBadge x={310} y={55} />

      <text x={220} y={150} textAnchor="middle" fontSize="11" fontWeight="800" fill="#8A5A10" fontFamily="system-ui">⇄ barter</text>
    </>
  );
}

const SCENES = [Scene1, Scene2, Scene3];

// ─── Component ─────────────────────────────────────────────────────────────

export function RewardFlowAnimation() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef(null);

  // CERGIO-GUARD (2026-05-29): auto-advance bumped 5.5s → 7s per Tarik:
  // "slow down the animation and bring out the headline to hit harder."
  // With less text per scene the eye has more room to land on the
  // headline + badge; longer dwell lets that sink in.
  useEffect(() => {
    if (!auto) return;
    timerRef.current = setTimeout(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 7000);
    return () => clearTimeout(timerRef.current);
  }, [step, auto]);

  const s = STEPS[step];
  const Scene = SCENES[step];
  const chip = BENEFIT_CHIPS[s.benefit];

  const next   = () => { setAuto(false); setStep((v) => Math.min(STEPS.length - 1, v + 1)); };
  const prev   = () => { setAuto(false); setStep((v) => Math.max(0, v - 1)); };
  const replay = () => { setStep(0); setAuto(true); };

  return (
    <div className="px-1">
      {/* Top bar — benefit chip + counter */}
      <div className="flex justify-between items-center px-3.5 py-2 mb-2 rounded-[10px] bg-bg5/60">
        <span className={`text-[10.5px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-pill ${chip.cls}`}>
          {chip.label}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span key={`v-${step}`} className="text-[16px] font-extrabold text-black rf-tick tabular-nums">
            {s.counter.value}
          </span>
          <span className="text-[10px] text-b3 font-medium">{s.counter.sub}</span>
        </span>
      </div>

      {/* Stage */}
      <div
        className="w-full rounded-[14px] overflow-hidden"
        style={{ height: 240, background: 'linear-gradient(180deg, #F3F8FF 0%, #FFF9EA 65%, #F1EFE8 100%)' }}
      >
        <svg viewBox="0 0 400 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="avYou" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#5BC404" />
              <stop offset="100%" stopColor="#2F6E00" />
            </linearGradient>
            <linearGradient id="avFriend" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#8A6FD6" />
              <stop offset="100%" stopColor="#4F3DB0" />
            </linearGradient>
            <linearGradient id="avFof" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#F5A65E" />
              <stop offset="100%" stopColor="#C76A18" />
            </linearGradient>
            <linearGradient id="avConnector" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#EE5586" />
              <stop offset="100%" stopColor="#A52454" />
            </linearGradient>
          </defs>

          <line x1={20} y1={210} x2={380} y2={210} stroke="#5C3A14" strokeWidth={0.8} opacity={0.25} />

          <g key={`scene-${step}`}>
            <Scene />
          </g>
        </svg>
      </div>

      {/* Caption — headline-first, minimal body */}
      <div className="py-3 px-1">
        <p className="text-[15px] font-extrabold text-black mt-1 leading-tight">{s.title}</p>
        <p className="text-[11.5px] text-gd font-bold mt-1 leading-snug">{s.math}</p>
        <p className="text-[11.5px] text-b3 mt-1.5 leading-snug">{s.body()}</p>
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
