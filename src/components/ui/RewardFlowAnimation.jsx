// CERGIO-GUARD (2026-05-29 v6): reward-flow animation, simplified to two
// scenes per Tarik's "clean it, present it simply" directive.
//
// Scene 1 — BENEFITS TABLE: side-by-side comparison of what a regular
// User earns vs what a Connector earns. The table is the headline visual
// because it answers the single biggest user question — "what do I
// actually get?" — without any math at all. Connector is the LEAD
// (left column) since that's the differentiator + upside path.
//
// Scene 2 — THE MATH: how the $250 per friend actually accrues.
// 7% of every booking is dim (it's the mechanism, not the headline);
// $250 is the hero. Shows a concrete example: 3 friend-bookings of
// $100/$200/$100 → $7+$14+$7 = $28 toward the $250 cap. Then the
// scale punchline: 50 friends × $250 = $12,500.
//
// All numbers from REWARDS. Auto-advance 8s per scene (slower than v5
// per Tarik: "bring out the headline to hit harder"). Less text, bigger
// visuals.

import { useEffect, useRef, useState } from 'react';
import { REWARDS, REWARD_COPY } from '../../lib/rewards';

const STEPS = [
  {
    num: '01',
    title: 'Two ways to earn.',
    body: () =>
      `Anyone can invite friends. Connectors stack barter + Growth Participation on top.`,
  },
  {
    num: '02',
    title: `$${REWARDS.perFriend} per friend — here's how.`,
    body: () =>
      `${REWARDS.referrerSharePercent}% of every booking flows back to you, accruing until you've earned $${REWARDS.perFriend} from that friend (${REWARDS.friendCapWindowMonths}-month window). ${REWARDS.exampleFriends} friends × $${REWARDS.perFriend} = $${REWARDS.exampleTotal.toLocaleString()}.`,
  },
];

// ─── Visual primitives ─────────────────────────────────────────────────────

function PhaseBadge({ num, x = 32, y = 32 }) {
  return (
    <g className="rf-pop">
      <circle cx={x} cy={y} r={22} fill="#2F6E00" />
      <text x={x} y={y + 7} textAnchor="middle" fontSize="18" fontWeight="900" fill="#FFFFFF" fontFamily="system-ui">
        {num}
      </text>
    </g>
  );
}

// Pill — small colored chip with text.
function Pill({ x, y, text, tone = 'green', delay = 0 }) {
  const palette = {
    green:  { bg: '#2F6E00', fg: '#FFFFFF' },
    amber:  { bg: '#F0A030', fg: '#FFFFFF' },
    dark:   { bg: '#111114', fg: '#9BE53A' },
    soft:   { bg: '#F3FFEA', fg: '#3D8B00' },
  };
  const c = palette[tone] || palette.green;
  const w = text.length * 6.5 + 18;
  return (
    <g className="rf-pop" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={9} fill={c.bg} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="10.5" fontWeight="800" fill={c.fg} fontFamily="system-ui">
        {text}
      </text>
    </g>
  );
}

// ─── Scene 1: BENEFITS TABLE ───────────────────────────────────────────────

function Scene1() {
  // Two-column comparison table. Connector left (lead, accent green),
  // User right (muted card). Four rows of benefits with concrete chips.
  // Per Tarik: lead with Connectors since barter is the differentiator,
  // and they get $250 CASH (not credit) + barter + GPI.
  const colWidth = 168;
  const rowHeight = 36;
  const startY = 80;
  const conX = 110;
  const usrX = 290;

  const rows = [
    { label: 'per friend who books', con: `$${REWARDS.perFriendConnector} cash`, usr: `$${REWARDS.perFriendUser} credit` },
    { label: 'free services from providers', con: REWARD_COPY.barterSoft, usr: '—' },
    { label: 'spotlight income (IG / TikTok)', con: 'yes', usr: '—' },
    { label: 'Growth Participation Income', con: 'higher score', usr: 'yes' },
  ];

  return (
    <>
      <PhaseBadge num="01" />

      {/* column headers */}
      <g className="rf-pop">
        <rect x={conX - colWidth / 2} y={48} width={colWidth} height={24} rx={6} fill="#2F6E00" />
        <text x={conX} y={64} textAnchor="middle" fontSize="13" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui">
          Connector
        </text>
      </g>
      <g className="rf-pop" style={{ animationDelay: '0.15s' }}>
        <rect x={usrX - colWidth / 2} y={48} width={colWidth} height={24} rx={6} fill="#F4F4F2" stroke="#E5E5E3" strokeWidth={1} />
        <text x={usrX} y={64} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
          User
        </text>
      </g>

      {/* rows */}
      {rows.map((r, i) => {
        const y = startY + i * rowHeight;
        return (
          <g key={`row-${i}`} className="rf-pop" style={{ animationDelay: `${0.3 + i * 0.15}s` }}>
            {/* row background */}
            <rect x={conX - colWidth / 2} y={y} width={colWidth} height={rowHeight - 4} rx={5} fill="#F3FFEA" stroke="#3D8B00" strokeWidth={0.8} opacity={0.95} />
            <rect x={usrX - colWidth / 2} y={y} width={colWidth} height={rowHeight - 4} rx={5} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={0.8} />

            {/* row label between columns — small italic */}
            <text x={(conX + usrX) / 2} y={y + 13} textAnchor="middle" fontSize="8" fontWeight="700" fill="#7A7A7A" fontFamily="system-ui">
              {r.label}
            </text>

            {/* Connector value — bold, green */}
            <text x={conX} y={y + 25} textAnchor="middle" fontSize="11" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">
              {r.con}
            </text>

            {/* User value — bold, dark */}
            <text x={usrX} y={y + 25} textAnchor="middle" fontSize="11" fontWeight={r.usr === '—' ? '500' : '800'} fill={r.usr === '—' ? '#A0A0A2' : '#1A1A1A'} fontFamily="system-ui">
              {r.usr}
            </text>
          </g>
        );
      })}

      <text x={200} y={232} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#3D3D3D" fontFamily="system-ui">
        Both tiers earn — Connectors stack the most upside
      </text>
    </>
  );
}

// ─── Scene 2: THE MATH (7% accumulator + scale) ────────────────────────────

function Scene2() {
  // Show how $250 per friend ACCRUES via 7% of each booking. Three
  // bookings shown ($100, $200, $100), each one's 7% slice flowing
  // into an accumulator counter on the right. Bottom punchline:
  // 50 friends × $250 = $12,500.
  //
  // 7% is intentionally rendered SMALLER + GRAY (the mechanism); $250
  // is BIG + GREEN (the hero) — per Tarik "dim the 7%."

  return (
    <>
      <PhaseBadge num="02" />

      {/* header strip — what the scene is showing */}
      <text x={200} y={32} textAnchor="middle" fontSize="11" fontWeight="700" fill="#7A7A7A" fontFamily="system-ui">
        Friend books a service · you earn {REWARDS.referrerSharePercent}% per booking
      </text>

      {/* Three booking rows — each: provider tile + 7% slice → accumulator */}
      {(() => {
        const bookings = [
          { amt: 100, slice: 7  },
          { amt: 200, slice: 14 },
          { amt: 100, slice: 7  },
        ];
        const startY = 64;
        const rowH   = 40;
        return bookings.map((b, i) => {
          const y = startY + i * rowH;
          return (
            <g key={`b-${i}`} className="rf-pop" style={{ animationDelay: `${0.3 + i * 0.55}s` }}>
              {/* booking tile (left) */}
              <rect x={36} y={y - 12} width={92} height={26} rx={5} fill="#FFFFFF" stroke="#E5E5E3" strokeWidth={1} />
              <text x={82} y={y + 5} textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
                Booking ${b.amt}
              </text>

              {/* arrow */}
              <path d={`M 132 ${y} L 168 ${y}`} stroke="#3D8B00" strokeWidth={1.4} fill="none" strokeDasharray="3 3" opacity={0.55} />
              <polygon points={`168,${y - 3} 172,${y} 168,${y + 3}`} fill="#3D8B00" opacity={0.6} />

              {/* 7% slice pill — DIM (per Tarik) */}
              <Pill x={208} y={y} text={`+$${b.slice}`} tone="soft" delay={0.3 + i * 0.55} />

              {/* arrow */}
              <path d={`M 230 ${y} L 268 ${y}`} stroke="#3D8B00" strokeWidth={1.4} fill="none" strokeDasharray="3 3" opacity={0.55} />
              <polygon points={`268,${y - 3} 272,${y} 268,${y + 3}`} fill="#3D8B00" opacity={0.6} />

              {/* running total this row contributes to */}
              <text x={310} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="#7A7A7A" fontFamily="system-ui">
                accumulator
              </text>
              <text x={310} y={y + 9} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1A1A1A" fontFamily="system-ui">
                ${[7, 21, 28][i]} / ${REWARDS.perFriend}
              </text>
            </g>
          );
        });
      })()}

      {/* footer punchline — the $12,500 takeaway */}
      <rect x={32} y={200} width={336} height={26} rx={6} fill="#F3FFEA" stroke="#3D8B00" strokeWidth={1} />
      <text x={200} y={218} textAnchor="middle" fontSize="13" fontWeight="800" fill="#2F6E00" fontFamily="system-ui">
        {REWARDS.exampleFriends} friends × ${REWARDS.perFriend} = ${REWARDS.exampleTotal.toLocaleString()}
      </text>
    </>
  );
}

const SCENES = [Scene1, Scene2];

// ─── Component ─────────────────────────────────────────────────────────────

export function RewardFlowAnimation() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef(null);

  // CERGIO-GUARD (2026-05-29): auto-advance 8s — slow enough that the
  // table + math each get a full read. v5 was 7s, v6 needs more for the
  // table (more text to scan).
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
      {/* Stage — no chrome above (the badge inside the SVG is the chrome) */}
      <div
        className="w-full rounded-[14px] overflow-hidden"
        style={{ height: 250, background: 'linear-gradient(180deg, #F3F8FF 0%, #FFF9EA 65%, #F1EFE8 100%)' }}
      >
        <svg viewBox="0 0 400 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <g key={`scene-${step}`}>
            <Scene />
          </g>
        </svg>
      </div>

      {/* Caption — headline-first, minimal body */}
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
