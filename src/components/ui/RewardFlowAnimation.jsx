// CERGIO-GUARD (2026-05-28 v2): Reward-flow animation. Four-scene
// visual explainer of the Cergio business model. Sprouts represent
// PEOPLE. Vines represent the trust network. Coins are direct cash.
// Gift boxes are barter (services). The orchard is community growth.
//
// The four mechanisms, in order:
//   1. DIRECT CASH    — you invite, friend books, you earn 7% → up to $250.
//   2. TRUST NETWORK  — friend invites a friend → +5% ($12.50) on second tier.
//                       50 friends → $12,500 example.
//   3. BARTER         — Connectors trade IG/TikTok spotlights for free
//                       services from providers ($1K–$10K/month).
//   4. GROWTH PARTICIPATION INCOME — community-owned upside as Cergio scales.
//                       Tagline: Human-Powered AI for Shared Prosperity.
//
// All numbers come from REWARDS so we never hand-write dollar amounts.
// Used by /earnings/how (EarnExplainerScreen). Drop-in elsewhere.

import { useEffect, useRef, useState } from 'react';
import { REWARDS } from '../../lib/rewards';

const PLATFORM_FEE_PCT = 7;

const BENEFIT_CHIPS = {
  cash:   { label: 'Direct cash',           cls: 'bg-gl text-gd' },
  trust:  { label: 'Trust + network',       cls: 'bg-gl text-gd' },
  barter: { label: 'Barter — free services', cls: 'bg-warnBg text-warnText' },
  growth: { label: 'Growth participation',  cls: 'bg-gl text-gd2' },
};

const STEPS = [
  {
    num: 'Step 1 of 4',
    benefit: 'cash',
    title: 'You invite. Friend books. You earn.',
    body: () =>
      `Send a Cergio link. When your friend books a service, Cergio's ${PLATFORM_FEE_PCT}% platform fee on every booking flows back to you — up to $${REWARDS.perFriend} per friend.`,
    counter: { value: `+$${REWARDS.perFriend}`, sub: 'cap per friend' },
  },
  {
    num: 'Step 2 of 4',
    benefit: 'trust',
    title: 'The chain multiplies. Trust compounds.',
    body: () =>
      `Your friend invites a friend. When that new friend books, you earn ${REWARDS.friendOfFriendPercent}% = $${REWARDS.friendOfFriendBonus} every time the chain extends. ${REWARDS.exampleFriends} friends → $${REWARDS.exampleTotal.toLocaleString()}. Your network does the work.`,
    counter: { value: `$${REWARDS.exampleTotal.toLocaleString()}`, sub: `${REWARDS.exampleFriends}-friend example` },
  },
  {
    num: 'Step 3 of 4',
    benefit: 'barter',
    title: 'Connectors trade spotlights for services.',
    body: () =>
      `Influencers, super-users, and small businesses become Connectors. Providers send $${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/month in free services in exchange for Instagram + TikTok spotlights. Barter, not cash.`,
    counter: { value: `$${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K`, sub: '/mo in services' },
  },
  {
    num: 'Step 4 of 4',
    benefit: 'growth',
    title: 'Growth Participation — own the orchard.',
    body: () =>
      `Every dollar you earn builds your participation in Cergio's growth. As the platform scales, the community that grew the orchard shares the upside. Human-Powered AI for shared prosperity.`,
    counter: { value: 'GPI', sub: 'community upside' },
  },
];

// ─── Visual primitives ─────────────────────────────────────────────────────

// A person — drawn as a small organic sprout (stem + leaf cluster) so it
// reads as "alive" / part of the orchard. `size` controls maturity, label
// shows under the root. Optional `badge` overlays a small icon (camera for
// Connector). Subtle sway via existing rf-sway keyframe.
function Person({ x, size = 'mid', label, badge = null, faded = false }) {
  const base = 210;
  const h = size === 'tree' ? 90 : size === 'big' ? 72 : size === 'mid' ? 56 : 40;
  const top = base - h;
  const stemW = size === 'tree' ? 2.8 : 2;
  const sway =
    size === 'tree' ? 'rf-sway'
    : size === 'big' ? 'rf-sway-b'
    : size === 'mid' ? 'rf-sway-c'
    : 'rf-sway-d';

  let leaves;
  if (size === 'small') {
    leaves = (
      <>
        <ellipse cx={x - 5} cy={top + 3} rx="6" ry="4" fill="#9BE53A" transform={`rotate(-22 ${x - 5} ${top + 3})`} />
        <ellipse cx={x + 5} cy={top - 2} rx="7" ry="4" fill="#7DD824" transform={`rotate(22 ${x + 5} ${top - 2})`} />
      </>
    );
  } else if (size === 'mid') {
    leaves = (
      <>
        <ellipse cx={x - 8}  cy={top + 6} rx="9"  ry="5" fill="#7DD824" transform={`rotate(-25 ${x - 8} ${top + 6})`} />
        <ellipse cx={x + 9}  cy={top}     rx="10" ry="5" fill="#5BC404" transform={`rotate(25 ${x + 9} ${top})`} />
        <ellipse cx={x + 1}  cy={top - 6} rx="8"  ry="5" fill="#9BE53A" />
      </>
    );
  } else if (size === 'big') {
    leaves = (
      <>
        <ellipse cx={x - 12} cy={top + 10} rx="12" ry="6" fill="#3D8B00" transform={`rotate(-26 ${x - 12} ${top + 10})`} />
        <ellipse cx={x + 12} cy={top + 4}  rx="12" ry="6" fill="#5BC404" transform={`rotate(26 ${x + 12} ${top + 4})`} />
        <ellipse cx={x - 1}  cy={top - 4}  rx="11" ry="8" fill="#7DD824" />
        <ellipse cx={x + 6}  cy={top - 14} rx="8"  ry="5" fill="#9BE53A" />
      </>
    );
  } else {
    leaves = (
      <>
        <ellipse cx={x}      cy={top}     rx="22" ry="19" fill="#3D8B00" />
        <ellipse cx={x - 12} cy={top - 3} rx="13" ry="10" fill="#5BC404" />
        <ellipse cx={x + 12} cy={top - 6} rx="13" ry="10" fill="#7DD824" />
        <ellipse cx={x + 2}  cy={top - 15} rx="11" ry="9" fill="#9BE53A" />
      </>
    );
  }

  return (
    <g opacity={faded ? 0.45 : 1}>
      <g className={sway} style={{ transformOrigin: `${x}px ${base}px`, transformBox: 'view-box' }}>
        <line x1={x} y1={base} x2={x} y2={top} stroke="#3D8B00" strokeWidth={stemW} strokeLinecap="round" />
        {leaves}
      </g>
      {badge && badge({ x, top })}
      {label && (
        <text x={x} y={base + 14} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#3D3D3D" fontFamily="system-ui">
          {label}
        </text>
      )}
    </g>
  );
}

// Curved organic vine from one person to another at root level.
function Vine({ ax, bx, animated = true }) {
  const mx = (ax + bx) / 2;
  const d = `M ${ax} 210 Q ${mx} 226 ${bx} 210`;
  return (
    <path
      d={d}
      stroke="#3D8B00"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      opacity={animated ? 0.55 : 0.35}
      strokeDasharray={animated ? '0' : '3 3'}
    />
  );
}

// Provider tile — house+green roof, recognizable as a service.
function ProviderTile({ x, y, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <rect x={x - 16} y={y - 8} width="32" height="26" rx="3" fill="#FFFFFF" stroke="#E5E5E3" strokeWidth="1.2" />
      <polygon points={`${x - 18},${y - 8} ${x},${y - 18} ${x + 18},${y - 8}`} fill="#3D8B00" />
      <rect x={x - 4} y={y + 4} width="8" height="14" fill="#5BC404" opacity="0.4" />
      <text x={x} y={y + 28} textAnchor="middle" fontSize="8" fontWeight="600" fill="#3D3D3D" fontFamily="system-ui">Provider</text>
    </g>
  );
}

// Green cash pill.
function CoinPill({ x, y, text, delay = 0 }) {
  const w = text.length * 6 + 18;
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <rect x={x - w / 2} y={y - 9} width={w} height="18" rx="9" fill="#2F6E00" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#FFFFFF" fontFamily="system-ui">{text}</text>
    </g>
  );
}

// Gift-box (barter): amber box with ribbon, optional caption underneath.
function GiftBox({ x, y, caption, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <rect x={x - 12} y={y - 9} width="24" height="18" rx="2.5" fill="#F0A030" />
      <rect x={x - 12} y={y - 1.5} width="24" height="3" fill="#FFFFFF" opacity="0.9" />
      <rect x={x - 1.5} y={y - 9} width="3" height="18" fill="#FFFFFF" opacity="0.9" />
      {caption && (
        <text x={x} y={y + 22} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#8A5A10" fontFamily="system-ui">
          {caption}
        </text>
      )}
    </g>
  );
}

// Camera/spotlight badge — rides on top of a Connector sprout.
function CameraBadge({ x, top }) {
  const cy = top - 30;
  return (
    <g>
      <circle cx={x} cy={cy} r="11" fill="#111114" />
      <rect x={x - 7} y={cy - 4} width="14" height="9" rx="1.5" fill="#111114" />
      <circle cx={x} cy={cy + 0.5} r="3.2" fill="#9BE53A" />
      <circle cx={x + 4.5} cy={cy - 3.5} r="1.2" fill="#FAC775" />
    </g>
  );
}

// Floating IG + TikTok pills (rendered as tiny rounded squares with letters).
function SocialPills({ cx, cy }) {
  return (
    <g>
      <g className="rf-pop" style={{ animationDelay: '0.4s' }}>
        <rect x={cx - 32} y={cy - 8} width="22" height="16" rx="4" fill="url(#igGrad)" />
        <text x={cx - 21} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">IG</text>
      </g>
      <g className="rf-pop" style={{ animationDelay: '0.7s' }}>
        <rect x={cx + 10} y={cy - 8} width="22" height="16" rx="4" fill="#111114" />
        <text x={cx + 21} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#9BE53A" fontFamily="system-ui">TT</text>
      </g>
    </g>
  );
}

// Ascending growth curve — used in Step 4.
function GrowthCurve() {
  return (
    <g opacity="0.5">
      <path
        d="M 30 195 Q 120 180 200 140 T 380 50"
        stroke="#3D8B00"
        strokeWidth="2"
        fill="none"
        strokeDasharray="5 4"
      />
      <polygon points="372,46 388,52 374,62" fill="#3D8B00" />
    </g>
  );
}

// ─── Scenes ────────────────────────────────────────────────────────────────

function Scene1() {
  // You + Friend + Provider. Cash flows from provider through 7% fee to You.
  return (
    <>
      <Person x={110} size="mid" label="You" />
      <Vine ax={110} bx={220} />
      <Person x={220} size="mid" label="Friend" />
      <ProviderTile x={320} y={188} delay={0.3} />

      {/* arrows: provider booking → 7% slice → you */}
      <g opacity="0.55">
        <path d="M 304 178 Q 260 150 230 150" stroke="#3D8B00" strokeWidth="1.4" fill="none" strokeDasharray="3 3" />
        <path d="M 200 150 Q 160 150 122 130" stroke="#3D8B00" strokeWidth="1.4" fill="none" strokeDasharray="3 3" />
      </g>

      <CoinPill x={266} y={148} text={`${PLATFORM_FEE_PCT}% fee`} delay={0.55} />
      <CoinPill x={108} y={108} text={`+$${REWARDS.perFriend}`} delay={1.1} />
    </>
  );
}

function Scene2() {
  // You + Friend + Friend-of-Friend. F-of-F books → bigger coin to Friend,
  // smaller +$12.50 arcs back to You.
  return (
    <>
      <Person x={70}  size="big" label="You" />
      <Vine ax={70}  bx={180} />
      <Person x={180} size="big" label="Friend" />
      <Vine ax={180} bx={290} />
      <Person x={290} size="mid" label="F-of-F" />
      <ProviderTile x={360} y={188} delay={0.2} />

      <g opacity="0.55">
        <path d="M 344 178 Q 320 156 300 150" stroke="#3D8B00" strokeWidth="1.4" fill="none" strokeDasharray="3 3" />
        <path d="M 270 144 Q 222 132 190 116" stroke="#3D8B00" strokeWidth="1.4" fill="none" strokeDasharray="3 3" />
        <path d="M 168 110 Q 120 102 80 100" stroke="#3D8B00" strokeWidth="1.2" fill="none" strokeDasharray="2 3" opacity="0.85" />
      </g>

      <CoinPill x={258} y={142} text={`+$${REWARDS.perFriend}`}        delay={0.55} />
      <CoinPill x={184} y={114} text={`+$${REWARDS.friendOfFriendBonus} (${REWARDS.friendOfFriendPercent}%)`} delay={0.95} />
      <CoinPill x={70}  y={100} text="you earn"                       delay={1.35} />

      <text x={200} y={236} textAnchor="middle" fontSize="9.5" fill="#3D3D3D" fontWeight="600" fontFamily="system-ui">
        {REWARDS.exampleFriends} friends → ${REWARDS.exampleTotal.toLocaleString()}
      </text>
    </>
  );
}

function Scene3() {
  // Connector + Provider barter loop. Spotlight goes out, services come back.
  return (
    <>
      <SocialPills cx={140} cy={50} />

      <Person x={140} size="big" label="Connector" badge={CameraBadge} />

      {/* curved loop between Connector and Provider */}
      <g opacity="0.6">
        <path d="M 170 130 Q 230 100 290 130" stroke="#F0A030" strokeWidth="1.6" fill="none" strokeDasharray="3 3" />
        <path d="M 290 175 Q 230 200 170 175" stroke="#3D8B00" strokeWidth="1.6" fill="none" strokeDasharray="3 3" />
      </g>

      <ProviderTile x={310} y={155} delay={0.3} />

      {/* outbound spotlight */}
      <g className="rf-pop" style={{ animationDelay: '0.55s' }}>
        <rect x={210} y={88} width="58" height="18" rx="9" fill="#111114" />
        <text x={239} y={101} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#9BE53A" fontFamily="system-ui">spotlight</text>
      </g>

      {/* inbound barter — gift box */}
      <GiftBox x={228} y={194} caption={`$${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/mo`} delay={1.0} />
    </>
  );
}

function Scene4() {
  // Orchard scale — many connected people + ascending growth curve + GPI badge.
  const people = [
    { x: 40,  size: 'mid'  },
    { x: 78,  size: 'big'  },
    { x: 120, size: 'tree' },
    { x: 168, size: 'big'  },
    { x: 210, size: 'tree' },
    { x: 258, size: 'big'  },
    { x: 300, size: 'mid'  },
    { x: 348, size: 'big'  },
    { x: 386, size: 'mid'  },
  ];
  return (
    <>
      <GrowthCurve />

      {/* vine network connecting alternating roots */}
      <g opacity="0.45">
        {people.slice(0, -1).map((p, i) => (
          <path
            key={`v-${i}`}
            d={`M ${p.x} 210 Q ${(p.x + people[i + 1].x) / 2} 224 ${people[i + 1].x} 210`}
            stroke="#3D8B00"
            strokeWidth="1.4"
            fill="none"
          />
        ))}
      </g>

      {people.map((p, i) => (
        <Person key={`p-${i}`} x={p.x} size={p.size} />
      ))}

      {/* GPI badge */}
      <g className="rf-pop" style={{ animationDelay: '0.4s' }}>
        <rect x={140} y={28} width="120" height="24" rx="12" fill="#3D8B00" />
        <text x={200} y={44} textAnchor="middle" fontSize="11" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">
          Growth Participation
        </text>
      </g>

      {/* Mission tagline footer */}
      <text x={200} y={236} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#2C5D21" fontFamily="system-ui">
        Human-Powered AI · Shared Prosperity
      </text>
    </>
  );
}

const SCENES = [Scene1, Scene2, Scene3, Scene4];

// ─── Component ─────────────────────────────────────────────────────────────

export function RewardFlowAnimation() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef(null);

  // Auto-advance — 5s per step, pause when the user takes manual control.
  useEffect(() => {
    if (!auto) return;
    timerRef.current = setTimeout(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 5000);
    return () => clearTimeout(timerRef.current);
  }, [step, auto]);

  const s = STEPS[step];
  const Scene = SCENES[step];
  const chip = BENEFIT_CHIPS[s.benefit];

  const next = () => { setAuto(false); setStep((v) => Math.min(STEPS.length - 1, v + 1)); };
  const prev = () => { setAuto(false); setStep((v) => Math.max(0, v - 1)); };
  const replay = () => { setStep(0); setAuto(true); };

  return (
    <div className="px-1">
      {/* Top bar — benefit chip + step counter value */}
      <div className="flex justify-between items-center px-3.5 py-2 mb-2 rounded-[10px] bg-bg5/60">
        <span className={`text-[10.5px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-pill ${chip.cls}`}>
          {chip.label}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span key={`v-${step}`} className="text-[15px] font-extrabold text-black rf-tick tabular-nums">{s.counter.value}</span>
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
            <linearGradient id="igGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#F58529" />
              <stop offset="50%"  stopColor="#DD2A7B" />
              <stop offset="100%" stopColor="#8134AF" />
            </linearGradient>
          </defs>
          {/* soil line */}
          <line x1="20" y1="210" x2="380" y2="210" stroke="#5C3A14" strokeWidth="0.8" opacity="0.28" />
          {/* re-key on step to retrigger entrance animations */}
          <g key={`scene-${step}`}>
            <Scene />
          </g>
        </svg>
      </div>

      {/* Caption */}
      <div className="py-3 px-1">
        <p className="text-[10px] text-b3 uppercase tracking-wide font-bold">{s.num}</p>
        <p className="text-[15px] font-extrabold text-black mt-1 leading-tight">{s.title}</p>
        <p className="text-[12px] text-b3 mt-1 leading-snug">{s.body()}</p>
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
