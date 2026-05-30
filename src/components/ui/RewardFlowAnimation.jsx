// CERGIO-GUARD (2026-05-29 v7): reward-flow animation, readable layout.
//
// Tarik flagged v6: "animation is poorly formatted, can't see writing on
// the table. It's more than 2 ways to earn — inviting, recommending,
// spotlighting, getting free services, +$250 per friend from their
// followers (+ $12.50 from THEIR followers), then GPI. And copy says
// Cergio's fee is 7% which is incorrect — it's 10%, but it's misleading;
// should explain the 7% per booking in the context of inviting or
// recommending."
//
// Three scenes, properly typed for the 400×260 SVG canvas:
//
//   01  WAYS TO EARN     A clear bullet list with FIVE earning streams:
//                          • Invite friends   ($250/each)
//                          • Recommend services (subset of invite — counted
//                            in the same $250 stream)
//                          • Friend-of-friend ($12.50/each chain extension)
//                          • Spotlight income (Connectors only)
//                          • Free services / barter (Connectors only)
//                          • GPI — all earners, higher for Connectors
//                        User vs Connector tagged per row so the
//                        cash-vs-credit + Connector-exclusive split reads
//                        at a glance.
//
//   02  $250 MATH        Cergio's 10% fee on every booking. We share
//                        7% with you (the referrer) until you've hit
//                        the $250 cap. Three example bookings
//                        ($100/$200/$100) → 7% slices ($7/$14/$7)
//                        flow into a running $28/$250 accumulator.
//                        Cergio's 10% is shown OUTSIDE the share for
//                        clarity (no more "7% IS the fee" misread).
//
//   03  SCALE + GPI      50 friends × $250 = $12,500. Plus Growth
//                        Participation Income on every dollar earned.
//
// Numbers from REWARDS. Auto-advance 8s.

import { useEffect, useRef, useState } from 'react';
import { REWARDS, REWARD_COPY } from '../../lib/rewards';

const STEPS = [
  {
    num: '01',
    title: 'Five ways to earn on Cergio.',
    body: () =>
      `Anyone can invite friends or recommend services. Connectors stack two more streams on top — barter services + spotlight income — plus a bigger Growth Participation score.`,
  },
  {
    num: '02',
    title: `$${REWARDS.perFriend} per friend → $${REWARDS.exampleTotal.toLocaleString()} with ${REWARDS.exampleFriends}.`,
    body: () =>
      `Cergio charges ${REWARDS.platformFeePercent}% on every booking. We share ${REWARDS.referrerSharePercent}% of every booking the friend you invited makes, until you've earned $${REWARDS.perFriend} from them. Only bookings within ${REWARDS.friendCapWindowMonths} months of their invite count. Bring ${REWARDS.exampleFriends} friends and that's $${REWARDS.exampleTotal.toLocaleString()}.`,
  },
  {
    num: '03',
    title: 'Growth Participation Income.',
    body: () =>
      `Every dollar you earn on Cergio also builds your participation score — like airmiles, but tied to Cergio's growth instead of flights. If Cergio goes public, the orchard you helped grow rewards you back.`,
  },
];

// ─── Visual primitives ─────────────────────────────────────────────────────

function PhaseBadge({ num, x = 30, y = 30 }) {
  return (
    <g className="rf-pop">
      <circle cx={x} cy={y} r={20} fill="#2F6E00" />
      <text x={x} y={y + 6} textAnchor="middle" fontSize="16" fontWeight="900" fill="#FFFFFF" fontFamily="system-ui">
        {num}
      </text>
    </g>
  );
}

function Pill({ x, y, text, tone = 'green', delay = 0 }) {
  const palette = {
    green: { bg: '#2F6E00', fg: '#FFFFFF' },
    soft:  { bg: '#F3FFEA', fg: '#2F6E00' },
    amber: { bg: '#FFF5E0', fg: '#8A5A10' },
    gray:  { bg: '#F4F4F2', fg: '#5F5E5A' },
    dark:  { bg: '#111114', fg: '#9BE53A' },
  };
  const c = palette[tone] || palette.green;
  const w = text.length * 5.6 + 14;
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - w / 2} y={y - 8} width={w} height={16} rx={8} fill={c.bg} stroke={tone === 'soft' || tone === 'amber' || tone === 'gray' ? '#E5E5E3' : 'none'} strokeWidth={1} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill={c.fg} fontFamily="system-ui">
        {text}
      </text>
    </g>
  );
}

// ─── Scene 1: WAYS TO EARN (the readable list) ─────────────────────────────

function Scene1() {
  // Five-row earning list. Each row: bullet · headline · amount-pill.
  // "User" rows have neutral pills; "Connector" rows have amber pills.
  // Bigger type than v6's tiny table — readable on mobile.
  const startY = 60;
  const rowH   = 32;
  const rows = [
    { dot: '#2F6E00', label: 'Invite friends',          amount: `$${REWARDS.perFriend}/friend`,             tier: 'Both' },
    { dot: '#5BC404', label: 'Recommend services',      amount: 'same $250 stream',                          tier: 'Both' },
    { dot: '#7DD824', label: 'Friend-of-friend bonus',  amount: `+$${REWARDS.friendOfFriendBonus} each`,    tier: 'Both' },
    { dot: '#F0A030', label: 'Free services (barter)',  amount: REWARD_COPY.barterSoft,                      tier: 'Connector only' },
    { dot: '#A52454', label: 'Spotlight income',        amount: 'IG / TikTok payouts',                       tier: 'Connector only' },
  ];

  return (
    <>
      <PhaseBadge num="01" />
      <text x={200} y={36} textAnchor="middle" fontSize="11" fontWeight="700" fill="#7A7A7A" fontFamily="system-ui">
        + Growth Participation Income on every dollar earned
      </text>

      {rows.map((r, i) => {
        const y = startY + i * rowH;
        const tierIsConnector = r.tier === 'Connector only';
        return (
          <g key={`r-${i}`} className="rf-pop" style={{ animationDelay: `${0.2 + i * 0.18}s` }}>
            {/* dot */}
            <circle cx={36} cy={y} r={6} fill={r.dot} />

            {/* label */}
            <text x={50} y={y + 4} fontSize="13" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
              {r.label}
            </text>

            {/* amount */}
            <text x={50} y={y + 18} fontSize="10.5" fontWeight="600" fill="#5F5E5A" fontFamily="system-ui">
              {r.amount}
            </text>

            {/* tier tag pinned right */}
            <Pill
              x={350}
              y={y + 2}
              text={r.tier}
              tone={tierIsConnector ? 'amber' : 'soft'}
            />
          </g>
        );
      })}
    </>
  );
}

// ─── Scene 2: $250 MATH (10% fee · 7% to you · $250 cap) ──────────────────

function Scene2() {
  // Top strip explains the fee split cleanly: Cergio 10% on every booking,
  // of which we share 7% with the inviter (the rest is platform margin).
  // Then 3 example bookings flow 7% slices into a running accumulator.
  const bookings = [
    { amt: 100, slice: 7  },
    { amt: 200, slice: 14 },
    { amt: 100, slice: 7  },
  ];
  const startY = 72;
  const rowH   = 38;

  return (
    <>
      <PhaseBadge num="02" />

      {/* Top strip — fee anatomy */}
      <g>
        <rect x={70} y={20} width={310} height={32} rx={6} fill="#F3FFEA" stroke="#3D8B00" strokeWidth={1} />
        <text x={225} y={32} textAnchor="middle" fontSize="10.5" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
          Cergio's fee on every booking: {REWARDS.platformFeePercent}%
        </text>
        <text x={225} y={46} textAnchor="middle" fontSize="10" fontWeight="700" fill="#2F6E00" fontFamily="system-ui">
          → {REWARDS.referrerSharePercent}% goes to YOU (the inviter / recommender)
        </text>
      </g>

      {/* Three booking rows */}
      {bookings.map((b, i) => {
        const y = startY + i * rowH;
        return (
          <g key={`b-${i}`} className="rf-pop" style={{ animationDelay: `${0.3 + i * 0.6}s` }}>
            {/* booking tile */}
            <rect x={28} y={y - 13} width={96} height={26} rx={5} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1} />
            <text x={76} y={y + 5} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
              Booking ${b.amt}
            </text>

            {/* arrow */}
            <path d={`M 128 ${y} L 168 ${y}`} stroke="#3D8B00" strokeWidth={1.4} fill="none" strokeDasharray="3 3" opacity={0.55} />
            <polygon points={`168,${y - 3} 172,${y} 168,${y + 3}`} fill="#3D8B00" opacity={0.6} />

            {/* 7% slice pill — DIM */}
            <Pill x={208} y={y} text={`+$${b.slice}  (${REWARDS.referrerSharePercent}%)`} tone="soft" delay={0.3 + i * 0.6} />

            {/* arrow */}
            <path d={`M 244 ${y} L 282 ${y}`} stroke="#3D8B00" strokeWidth={1.4} fill="none" strokeDasharray="3 3" opacity={0.55} />
            <polygon points={`282,${y - 3} 286,${y} 282,${y + 3}`} fill="#3D8B00" opacity={0.6} />

            {/* accumulator */}
            <text x={335} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="#7A7A7A" fontFamily="system-ui">
              accumulator
            </text>
            <text x={335} y={y + 10} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
              ${[7, 21, 28][i]} / ${REWARDS.perFriend}
            </text>
          </g>
        );
      })}

      {/* Scale punchline footer — pinned to Scene 2 (the invite/math
          scene) per Tarik: "the 50 friends 12,500 belongs in the invite
          screen not the GPI." */}
      <g className="rf-pop" style={{ animationDelay: '2.2s' }}>
        <rect x={32} y={208} width={336} height={26} rx={6} fill="#F3FFEA" stroke="#3D8B00" strokeWidth={1} />
        <text x={200} y={224} textAnchor="middle" fontSize="13" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">
          {REWARDS.exampleFriends} friends × ${REWARDS.perFriend} = ${REWARDS.exampleTotal.toLocaleString()}
        </text>
      </g>
      <text x={200} y={246} textAnchor="middle" fontSize="9" fontWeight="600" fill="#7A7A7A" fontFamily="system-ui">
        within {REWARDS.friendCapWindowMonths} months of each invite
      </text>
    </>
  );
}

// ─── Scene 3: SCALE — 50 friends → $12,500 + GPI on top ───────────────────

function Scene3() {
  // GPI explainer. No $-amount math here — the dollar math lives on
  // Scene 2 (the invite/math scene). This scene answers the three
  // questions about Growth Participation Income: WHAT it is, HOW it
  // accrues, and WHEN it activates.
  return (
    <>
      <PhaseBadge num="03" />

      {/* GPI hero badge */}
      <g className="rf-pop" style={{ animationDelay: '0.3s' }}>
        <rect x={130} y={48} width={140} height={36} rx={18} fill="#2C5D21" />
        <text x={200} y={72} textAnchor="middle" fontSize="14" fontWeight="900" fill="#FFFFFF" fontFamily="system-ui">
          + GPI
        </text>
      </g>

      {/* Three-stat row — WHAT / HOW / WHEN */}
      {(() => {
        const cards = [
          { tag: 'WHAT',  body: 'Loyalty-style bonus tied to Cergio\'s growth',     y: 98 },
          { tag: 'HOW',   body: 'Every $ you earn = +1 to your participation score', y: 138 },
          { tag: 'WHEN',  body: 'Activates if Cergio goes public (IPO)',             y: 178 },
        ];
        return cards.map((c, i) => (
          <g key={`gpi-${i}`} className="rf-pop" style={{ animationDelay: `${0.55 + i * 0.35}s` }}>
            <rect x={36} y={c.y - 12} width={328} height={30} rx={6} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1} />
            <rect x={36} y={c.y - 12} width={58} height={30} rx={6} fill="#2C5D21" />
            <text x={65} y={c.y + 6} textAnchor="middle" fontSize="10" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">{c.tag}</text>
            <text x={104} y={c.y + 6} fontSize="11" fontWeight="700" fill="#1A1A1A" fontFamily="system-ui">{c.body}</text>
          </g>
        ));
      })()}

      {/* Mission tagline */}
      <text x={200} y={225} textAnchor="middle" fontSize="10" fontWeight="800" fill="#2C5D21" fontFamily="system-ui">
        Human-Powered AI · Shared Prosperity
      </text>
      <text x={200} y={242} textAnchor="middle" fontSize="8.5" fontWeight="500" fill="#7A7A7A" fontFamily="system-ui">
        Loyalty-style bonus, not a security. No guaranteed payout.
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

  useEffect(() => {
    if (!auto) return;
    timerRef.current = setTimeout(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 8000);
    return () => clearTimeout(timerRef.current);
  }, [step, auto]);

  const s = STEPS[step];
  const Scene = SCENES[step];

  const next   = () => { setAuto(false); setStep((v) => Math.min(STEPS.length - 1, v + 1)); };
  const prev   = () => { setAuto(false); setStep((v) => Math.max(0, v - 1)); };
  const replay = () => { setStep(0); setAuto(true); };

  return (
    <div className="px-1">
      {/* Stage — taller (260) so the 5-row list fits comfortably */}
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
