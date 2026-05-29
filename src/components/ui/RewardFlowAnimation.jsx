// CERGIO-GUARD (2026-05-29 v3): Reward-flow animation, infinitely
// clearer rewrite. Sprouts swapped for HUMAN AVATARS (circles with
// initials + names) — the eye reads them as people in 100ms. Every
// scene now has an inline MATH EQUATION CHIP at the top of the stage
// so the dollar logic is impossible to miss. The barter scene is a
// striking two-sided exchange instead of a subtle gift box.
//
// Four scenes, one mechanism each:
//   1. DIRECT CASH        — 1 friend = $250 (with $250 × 50 = $12,500 chip)
//   2. CHAIN / NETWORK    — friend invites friend = +5% ($12.50) bonus
//   3. BARTER             — Connector ⇄ Provider, $1K–$10K/mo in services
//   4. GROWTH (GPI)       — community orchard, Human-Powered AI tagline
//
// All numbers come from REWARDS so they never drift. The visual model
// is consistent across scenes: avatars = people, vines = trust edges,
// cash pills = direct dollars, gift boxes = barter, the orchard scene
// keeps a few sprouts to echo the "grow" metaphor.

import { useEffect, useRef, useState } from 'react';
import { REWARDS } from '../../lib/rewards';

const PLATFORM_FEE_PCT = 7;

const BENEFIT_CHIPS = {
  cash:   { label: 'Direct cash',           cls: 'bg-gl text-gd' },
  chain:  { label: 'Network compounds',     cls: 'bg-gl text-gd' },
  barter: { label: 'Barter — free services', cls: 'bg-warnBg text-warnText' },
  growth: { label: 'Growth participation',  cls: 'bg-gl text-gd2' },
};

const STEPS = [
  {
    num: 'Step 1 of 4',
    benefit: 'cash',
    title: 'You invite. Friend books. You earn.',
    body: () =>
      `Cergio's ${PLATFORM_FEE_PCT}% platform fee on every booking flows back to you — up to $${REWARDS.perFriend} per friend who joins + books.`,
    counter: { value: `$${REWARDS.perFriend}`, sub: 'cap per friend' },
    math: `${PLATFORM_FEE_PCT}% fee × every booking, up to $${REWARDS.perFriend}`,
  },
  {
    num: 'Step 2 of 4',
    benefit: 'chain',
    title: 'Friend invites a friend — bonus to you.',
    body: () =>
      `When your friend's friend books, you earn ${REWARDS.friendOfFriendPercent}% — $${REWARDS.friendOfFriendBonus} — on top. The chain pays you every time it extends.`,
    counter: { value: `+$${REWARDS.friendOfFriendBonus}`, sub: 'per 2nd-tier signup' },
    math: `${REWARDS.friendOfFriendPercent}% × $${REWARDS.perFriend} = $${REWARDS.friendOfFriendBonus}`,
  },
  {
    num: 'Step 3 of 4',
    benefit: 'barter',
    title: 'Connectors trade spotlights for services.',
    body: () =>
      `Influencers, super-users, and small businesses become Connectors. Providers trade $${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/month in free services in exchange for Instagram + TikTok spotlights.`,
    counter: { value: `$${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K`, sub: '/mo in services' },
    math: `Spotlight ⇄ $${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/mo services`,
  },
  {
    num: 'Step 4 of 4',
    benefit: 'growth',
    title: 'Growth Participation — own the orchard.',
    body: () =>
      `Every dollar you earn builds your participation in Cergio's growth. As the platform scales, the community that grew it shares the upside. Human-Powered AI for shared prosperity.`,
    counter: { value: 'GPI', sub: 'community upside' },
    math: 'Your earnings → your share of growth',
  },
];

// ─── Visual primitives ─────────────────────────────────────────────────────

// HUMAN AVATAR — circle with initial inside + name below. Replaces the
// abstract sprout from v2; people read as people in 100ms. The `you`
// flag bolds the outline so the viewer instantly recognizes "this one
// represents me". Gradient ids defined once in the <defs> block.
function Avatar({ x, y, r = 22, gradientId = 'avYou', label = '', you = false, sub = '', dim = false }) {
  const initial = (label || '?')[0]?.toUpperCase();
  return (
    <g opacity={dim ? 0.55 : 1}>
      <circle
        cx={x} cy={y} r={r}
        fill={`url(#${gradientId})`}
        stroke={you ? '#1F4F00' : '#FFFFFF'}
        strokeWidth={you ? 2.5 : 1.8}
      />
      <text
        x={x} y={y + 5}
        textAnchor="middle"
        fontSize={r * 0.7}
        fontWeight="800"
        fill="#FFFFFF"
        fontFamily="system-ui"
      >
        {initial}
      </text>
      {label && (
        <text
          x={x} y={y + r + 12}
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="#1A1A1A"
          fontFamily="system-ui"
        >
          {label}
        </text>
      )}
      {sub && (
        <text
          x={x} y={y + r + 22}
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="500"
          fill="#7A7A7A"
          fontFamily="system-ui"
        >
          {sub}
        </text>
      )}
    </g>
  );
}

// Math equation chip — anchored at top of the SVG stage. Always visible
// so the dollar logic of each scene is locked in the user's eye.
function MathChip({ text }) {
  return (
    <g className="rf-pop">
      <rect
        x={106} y={10} width={188} height={22} rx={11}
        fill="#FFFFFF"
        stroke="#E5E5E3"
        strokeWidth={1}
      />
      <text
        x={200} y={25}
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill="#3D8B00"
        fontFamily="system-ui"
      >
        {text}
      </text>
    </g>
  );
}

// Provider tile — small house with a star, instantly readable as "service".
function ProviderTile({ x, y, label = 'Service' }) {
  return (
    <g className="rf-pop" style={{ animationDelay: '0.25s', transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <rect x={x - 18} y={y - 12} width={36} height={28} rx={4} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1.4} />
      <polygon points={`${x - 20},${y - 12} ${x},${y - 22} ${x + 20},${y - 12}`} fill="#3D8B00" />
      <circle cx={x} cy={y + 1} r={3} fill="#FAC775" />
      {label && (
        <text x={x} y={y + 30} textAnchor="middle" fontSize="9" fontWeight="700" fill="#3D3D3D" fontFamily="system-ui">
          {label}
        </text>
      )}
    </g>
  );
}

// Green cash pill — sized to its text. Used wherever a dollar amount lands.
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

// Vine between avatars — soft curve underneath at y = floor + 18.
function Vine({ ax, bx, y = 188 }) {
  const mx = (ax + bx) / 2;
  return (
    <path
      d={`M ${ax} ${y} Q ${mx} ${y + 14} ${bx} ${y}`}
      stroke="#3D8B00"
      strokeWidth={1.6}
      strokeLinecap="round"
      fill="none"
      opacity={0.55}
    />
  );
}

// Dashed arrow path — a directional hint between elements.
function Arrow({ d, color = '#3D8B00', dash = '3 3', strokeWidth = 1.4, opacity = 0.6 }) {
  return (
    <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" strokeDasharray={dash} opacity={opacity} />
  );
}

// Gift box — amber with white ribbon. Represents free service from provider.
function GiftBox({ x, y, caption, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }}>
      <rect x={x - 14} y={y - 10} width={28} height={20} rx={3} fill="#F0A030" />
      <rect x={x - 14} y={y - 2} width={28} height={3} fill="#FFFFFF" opacity={0.9} />
      <rect x={x - 1.5} y={y - 10} width={3} height={20} fill="#FFFFFF" opacity={0.9} />
      {caption && (
        <text x={x} y={y + 24} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#8A5A10" fontFamily="system-ui">{caption}</text>
      )}
    </g>
  );
}

// IG + TikTok pill row — small, no platform logos (license-safe), letter chips.
function SocialPills({ cx, cy, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={cx - 32} y={cy - 8} width={24} height={16} rx={4} fill="url(#igGrad)" />
      <text x={cx - 20} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">IG</text>
      <rect x={cx + 8} y={cy - 8} width={24} height={16} rx={4} fill="#111114" />
      <text x={cx + 20} y={cy + 4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#9BE53A" fontFamily="system-ui">TT</text>
    </g>
  );
}

// Spotlight pill — black with green dot, "Spotlight" label.
function SpotlightPill({ x, y, delay = 0 }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - 36} y={y - 9} width={72} height={18} rx={9} fill="#111114" />
      <circle cx={x - 24} cy={y} r={3} fill="#9BE53A" />
      <text x={x + 6} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">Spotlight</text>
    </g>
  );
}

// Small sprout — used only in Scene 4 (orchard) to keep the "grow" metaphor.
function MiniSprout({ x, age = 'mid' }) {
  const base = 210;
  const h = age === 'tree' ? 60 : age === 'big' ? 46 : 32;
  const top = base - h;
  const color = age === 'tree' ? '#3D8B00' : age === 'big' ? '#5BC404' : '#7DD824';
  return (
    <g>
      <line x1={x} y1={base} x2={x} y2={top} stroke="#3D8B00" strokeWidth={2} strokeLinecap="round" />
      <circle cx={x - 6} cy={top + 4} r={6} fill={color} />
      <circle cx={x + 6} cy={top + 2} r={6} fill="#5BC404" />
      <circle cx={x}     cy={top - 4} r={6} fill="#9BE53A" />
    </g>
  );
}

// Ascending growth curve — used in Scene 4 (GPI).
function GrowthCurve() {
  return (
    <g opacity={0.5}>
      <path d="M 30 200 Q 120 185 200 145 T 380 60" stroke="#3D8B00" strokeWidth={2} fill="none" strokeDasharray="5 4" />
      <polygon points="372,56 388,62 374,72" fill="#3D8B00" />
    </g>
  );
}

// ─── Scenes ────────────────────────────────────────────────────────────────

function Scene1() {
  // 1-friend example. You + Jamie + Provider. Booking → 7% fee → You.
  return (
    <>
      <MathChip text={STEPS[0].math} />
      <Avatar x={85}  y={130} r={28} gradientId="avYou"   label="You"   you />
      <Avatar x={205} y={130} r={28} gradientId="avFriend" label="Jamie" />
      <ProviderTile x={320} y={155} label="$300 clean" />

      {/* booking arrow */}
      <Arrow d="M 233 130 Q 270 130 305 145" />
      <text x={270} y={120} textAnchor="middle" fontSize="9" fill="#5F5E5A" fontWeight="700" fontFamily="system-ui">books</text>

      {/* 7% fee chip mid-path */}
      <CashPill x={270} y={88} text={`${PLATFORM_FEE_PCT}% fee`} delay={0.55} />

      {/* arrow flows fee → You */}
      <Arrow d="M 240 90 Q 180 80 110 100" />

      {/* You earn pill */}
      <CashPill x={85} y={82} text={`+$${REWARDS.perFriend}`} delay={1.0} big />

      {/* footer line on cap */}
      <text x={200} y={228} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#3D3D3D" fontFamily="system-ui">
        Cergio's {PLATFORM_FEE_PCT}% fee → you, up to ${REWARDS.perFriend} per friend
      </text>
    </>
  );
}

function Scene2() {
  // Friend-of-friend chain — You ← Jamie ← Alex. Alex books → $250 to Jamie,
  // $12.50 (5% bonus) to You. The classic 2-degree compounding visual.
  return (
    <>
      <MathChip text={STEPS[1].math} />
      <Avatar x={70}  y={140} r={26} gradientId="avYou"    label="You"   you />
      <Avatar x={175} y={140} r={26} gradientId="avFriend" label="Jamie" />
      <Avatar x={280} y={140} r={26} gradientId="avFof"    label="Alex"  />
      <ProviderTile x={360} y={170} label="books" />

      <Vine ax={70}  bx={175} y={184} />
      <Vine ax={175} bx={280} y={184} />

      {/* booking arrow Alex → Provider */}
      <Arrow d="M 304 144 Q 330 152 348 162" />

      {/* big $250 to Jamie */}
      <CashPill x={175} y={92} text={`+$${REWARDS.perFriend}`} delay={0.5} big />
      <Arrow d="M 270 130 Q 220 110 188 100" strokeWidth={1.6} />

      {/* smaller $12.50 (5%) to You */}
      <CashPill x={70}  y={92} text={`+$${REWARDS.friendOfFriendBonus} (${REWARDS.friendOfFriendPercent}%)`} delay={1.0} />
      <Arrow d="M 155 95 Q 115 90 90 92" />

      <text x={200} y={228} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#3D3D3D" fontFamily="system-ui">
        Every chain extension = ${REWARDS.friendOfFriendBonus} bonus to you
      </text>
    </>
  );
}

function Scene3() {
  // Barter — Connector ⇄ Provider. The visual that lands "Cergio is not
  // just cash". Two avatars, large; bidirectional arrows; spotlight pill
  // going one way, gift box (services) coming back.
  return (
    <>
      <MathChip text={STEPS[2].math} />

      {/* Connector left */}
      <SocialPills cx={95} cy={62} delay={0.1} />
      <Avatar x={95} y={140} r={34} gradientId="avConnector" label="Maya" sub="Connector" />

      {/* Provider right */}
      <ProviderTile x={305} y={140} label="Jennifer L." />

      {/* TOP arrow Connector → Provider: spotlight */}
      <Arrow d="M 132 115 Q 200 80 280 120" color="#F0A030" strokeWidth={1.8} opacity={0.7} />
      <SpotlightPill x={206} y={84} delay={0.55} />

      {/* BOTTOM arrow Provider → Connector: services */}
      <Arrow d="M 280 175 Q 200 210 132 170" color="#3D8B00" strokeWidth={1.8} opacity={0.7} />
      <GiftBox x={205} y={196} caption={`$${REWARDS.connectorBarterMin / 1000}K–$${REWARDS.connectorBarterMax / 1000}K/mo services`} delay={1.0} />

      {/* small "barter" badge in the gap */}
      <text x={205} y={140} textAnchor="middle" fontSize="10" fontWeight="800" fill="#8A5A10" fontFamily="system-ui">⇄ barter</text>
    </>
  );
}

function Scene4() {
  // Growth — community orchard. Mix of avatars (people) + sprouts (growth
  // metaphor). Ascending curve in the back. Big GPI badge at top.
  const people = [
    { x: 50,  label: 'You',   you: true,  grad: 'avYou'    },
    { x: 110, label: 'Jamie', grad: 'avFriend' },
    { x: 170, label: 'Alex',  grad: 'avFof'    },
    { x: 230, label: 'Maya',  grad: 'avConnector' },
    { x: 290, label: '+',     grad: 'avMisc'   },
    { x: 350, label: '+',     grad: 'avMisc'   },
  ];
  return (
    <>
      <GrowthCurve />
      <MathChip text={STEPS[3].math} />

      {/* GPI badge */}
      <g className="rf-pop" style={{ animationDelay: '0.4s' }}>
        <rect x={138} y={42} width={124} height={24} rx={12} fill="#3D8B00" />
        <text x={200} y={58} textAnchor="middle" fontSize="11" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">
          Growth Participation
        </text>
      </g>

      {/* avatars + vines */}
      <g>
        {people.slice(0, -1).map((p, i) => (
          <path
            key={`v-${i}`}
            d={`M ${p.x} 180 Q ${(p.x + people[i + 1].x) / 2} 196 ${people[i + 1].x} 180`}
            stroke="#3D8B00"
            strokeWidth={1.3}
            fill="none"
            opacity={0.5}
          />
        ))}
      </g>
      {people.map((p, i) => (
        <Avatar
          key={`p-${i}`}
          x={p.x}
          y={140}
          r={18}
          gradientId={p.grad}
          label={p.label}
          you={!!p.you}
        />
      ))}

      {/* sprouts to echo "grow" */}
      <MiniSprout x={20} age="big" />
      <MiniSprout x={380} age="tree" />

      <text x={200} y={232} textAnchor="middle" fontSize="10" fontWeight="800" fill="#2C5D21" fontFamily="system-ui">
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

  // Auto-advance — 5.5s per step. Slowed slightly vs v2 since the
  // math chip + avatars give the eye more to read.
  useEffect(() => {
    if (!auto) return;
    timerRef.current = setTimeout(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 5500);
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
            {/* Avatar gradients — one per role, brand-consistent green for You. */}
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
            <linearGradient id="avMisc" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#A8A8A8" />
              <stop offset="100%" stopColor="#666666" />
            </linearGradient>
            <linearGradient id="igGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#F58529" />
              <stop offset="50%"  stopColor="#DD2A7B" />
              <stop offset="100%" stopColor="#8134AF" />
            </linearGradient>
          </defs>

          {/* soil line — subtle ground reference */}
          <line x1={20} y1={210} x2={380} y2={210} stroke="#5C3A14" strokeWidth={0.8} opacity={0.25} />

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
