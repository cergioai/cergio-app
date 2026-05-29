// CERGIO-GUARD (2026-05-28): Reward-flow animation. The 6-step
// visual explainer that walks the entire business model — invite,
// recommend, friend-of-friend, become a Connector, orchard scale.
//
// React port of the widget Tarik previewed in chat. Self-contained:
// SVG scene + auto-advance + manual Back/Next/Replay. Reads from
// REWARDS so per-friend / friend-of-friend / milestone numbers stay
// canonical.
//
// Used by /earnings/how (EarnExplainerScreen). Drop-in elsewhere if
// you want — no external state, ~280px tall.

import { useEffect, useRef, useState } from 'react';
import { REWARDS } from '../../lib/rewards';

const STEPS = [
  {
    num: 'Step 1 of 6',
    title: 'You plant a sprout',
    body: () => "You sign up on Cergio. That's the first seed in your garden — no money yet, but the soil is ready.",
    money: 0,
    sprouts: [{ x: 200, h: 70, age: 'small', fruits: 0, label: 'You' }],
    rain: 0, sun: false, coins: [],
  },
  {
    num: 'Step 2 of 6',
    title: 'You invite a friend',
    body: () => 'You send a Cergio link to a friend. A new sprout pops up next to yours — still no money until they actually book something.',
    money: 0,
    sprouts: [
      { x: 160, h: 90, age: 'mid', fruits: 0, label: 'You' },
      { x: 260, h: 60, age: 'small', fruits: 0, label: 'Friend' },
    ],
    rain: 0, sun: false, coins: [],
  },
  {
    num: 'Step 3 of 6',
    title: `Friend books — rain falls — $${REWARDS.perFriendUser}`,
    body: () => `Your friend books a service. Rain feeds your garden. A fruit lands: $${REWARDS.perFriendUser} credit for you. This is the main loop.`,
    money: REWARDS.perFriendUser,
    sprouts: [
      { x: 160, h: 110, age: 'big', fruits: 1, label: 'You' },
      { x: 260, h: 90, age: 'mid', fruits: 1, label: 'Friend' },
    ],
    rain: 4, sun: true,
    coins: [{ x: 168, y: 80, amount: `+$${REWARDS.perFriendUser}` }],
  },
  {
    num: 'Step 4 of 6',
    title: `Friend invites a friend — +$${REWARDS.friendOfFriendBonus}`,
    body: () => `Your friend brings in someone new. When THAT friend books, you get ${REWARDS.friendOfFriendPercent}% = $${REWARDS.friendOfFriendBonus} on top. The chain extends without extra effort.`,
    money: REWARDS.perFriendUser + REWARDS.friendOfFriendBonus,
    sprouts: [
      { x: 130, h: 120, age: 'big', fruits: 1, label: 'You' },
      { x: 220, h: 110, age: 'big', fruits: 1, label: 'Friend' },
      { x: 300, h: 70, age: 'small', fruits: 0, label: 'F-of-F' },
    ],
    rain: 6, sun: true,
    coins: [{ x: 138, y: 70, amount: `+$${REWARDS.friendOfFriendBonus}` }],
  },
  {
    num: 'Step 5 of 6',
    title: 'Become a Connector — cash instead of credit',
    body: () => `Flip to Connector mode. The same $${REWARDS.perFriendConnector} lands as cash, plus free services and Growth Participation Income. Trees bear more fruit.`,
    money: REWARDS.perFriendUser + REWARDS.friendOfFriendBonus + 500,
    sprouts: [
      { x: 100, h: 160, age: 'tree', fruits: 3, label: 'You' },
      { x: 200, h: 130, age: 'big', fruits: 2, label: 'Friend' },
      { x: 290, h: 110, age: 'big', fruits: 1, label: 'F-of-F' },
    ],
    rain: 8, sun: true,
    coins: [{ x: 108, y: 50, amount: '+$500 cash' }],
  },
  {
    num: 'Step 6 of 6',
    title: 'Orchard grows — your network does the work',
    body: () => `Every friend who joins extends the garden. ${REWARDS.exampleFriends} friends → $${REWARDS.exampleTotal.toLocaleString()} just from per-friend rewards, before any friend-of-friend bonuses or Connector cash uplift.`,
    money: REWARDS.exampleTotal,
    sprouts: [
      { x: 50,  h: 180, age: 'tree', fruits: 4, label: '' },
      { x: 110, h: 140, age: 'big',  fruits: 2, label: '' },
      { x: 160, h: 160, age: 'tree', fruits: 3, label: '' },
      { x: 210, h: 130, age: 'big',  fruits: 2, label: '' },
      { x: 260, h: 150, age: 'tree', fruits: 3, label: '' },
      { x: 320, h: 130, age: 'big',  fruits: 2, label: '' },
      { x: 370, h: 110, age: 'mid',  fruits: 1, label: '' },
    ],
    rain: 10, sun: true,
    coins: [{ x: 180, y: 30, amount: `$${REWARDS.exampleTotal.toLocaleString()}` }],
  },
];

// ─── SVG renderers (pure functions of the step data) ───────────────────────
function leafColorByAge(age) {
  return age === 'tree' ? '#3D8B00'
       : age === 'big'  ? '#5BC404'
       : age === 'mid'  ? '#7DD824'
       :                  '#9BE53A';
}
function swayClassByAge(age) {
  return age === 'tree' ? 'rf-sway'
       : age === 'big'  ? 'rf-sway-b'
       : age === 'mid'  ? 'rf-sway-c'
       :                  'rf-sway-d';
}
function Sprout({ s }) {
  const base = 232;
  const top  = base - s.h;
  const leafColor = leafColorByAge(s.age);
  const stemW = s.age === 'tree' ? 3 : s.age === 'big' ? 2.5 : 2;
  const swayClass = swayClassByAge(s.age);

  // Leaves vary by maturity
  let leaves = null;
  if (s.age === 'small') {
    leaves = (<>
      <ellipse cx={s.x-6} cy={top+4} rx="7" ry="4" fill={leafColor} transform={`rotate(-20 ${s.x-6} ${top+4})`} />
      <ellipse cx={s.x+6} cy={top-2} rx="8" ry="4.5" fill={leafColor} transform={`rotate(20 ${s.x+6} ${top-2})`} />
    </>);
  } else if (s.age === 'mid') {
    leaves = (<>
      <ellipse cx={s.x-10} cy={top+8} rx="10" ry="5" fill={leafColor} transform={`rotate(-25 ${s.x-10} ${top+8})`} />
      <ellipse cx={s.x+11} cy={top}   rx="11" ry="6" fill="#5BC404"   transform={`rotate(25 ${s.x+11} ${top})`} />
      <ellipse cx={s.x+1}  cy={top-8} rx="9"  ry="6" fill="#7DD824" />
    </>);
  } else if (s.age === 'big') {
    leaves = (<>
      <ellipse cx={s.x-14} cy={top+12} rx="14" ry="7" fill="#3D8B00" transform={`rotate(-25 ${s.x-14} ${top+12})`} />
      <ellipse cx={s.x+14} cy={top+4}  rx="14" ry="7" fill="#5BC404" transform={`rotate(25 ${s.x+14} ${top+4})`} />
      <ellipse cx={s.x-2}  cy={top-8}  rx="12" ry="9" fill="#7DD824" />
      <ellipse cx={s.x+8}  cy={top-18} rx="9"  ry="6" fill="#9BE53A" />
    </>);
  } else {
    leaves = (<>
      <ellipse cx={s.x}     cy={top}    rx="26" ry="22" fill="#3D8B00" />
      <ellipse cx={s.x-14}  cy={top-4}  rx="14" ry="11" fill="#5BC404" />
      <ellipse cx={s.x+14}  cy={top-8}  rx="14" ry="11" fill="#7DD824" />
      <ellipse cx={s.x+2}   cy={top-18} rx="13" ry="10" fill="#9BE53A" />
    </>);
  }

  const fruits = [];
  for (let i = 0; i < s.fruits; i++) {
    const fx = s.x - 10 + (i * 12);
    const fy = top + (s.age === 'tree' ? -4 : 4);
    fruits.push(
      <g key={`f${i}`}>
        <circle className="rf-fruit" cx={fx} cy={fy} r="3.5" fill="#E24B4A" style={{ animationDelay: `${i * 0.3}s` }} />
        <circle cx={fx-1} cy={fy-1.5} r="0.8" fill="#FFFFFF" opacity="0.6" />
      </g>
    );
  }

  return (
    <>
      <g className={swayClass} style={{ transformOrigin: `${s.x}px ${base}px`, transformBox: 'view-box' }}>
        <line x1={s.x} y1={base} x2={s.x} y2={top} stroke="#3D8B00" strokeWidth={stemW} strokeLinecap="round" />
        {leaves}
        {fruits}
      </g>
      {s.label && (
        <text x={s.x} y="244" textAnchor="middle" fontSize="9" fill="#5F5E5A" fontFamily="system-ui">{s.label}</text>
      )}
    </>
  );
}
function Rain({ count }) {
  if (count === 0) return null;
  const drops = [];
  for (let i = 0; i < count; i++) {
    const x = 60 + i * (280 / Math.max(1, count - 1));
    const delay = (i * 0.3) % 2.8;
    drops.push(
      <path
        key={`d${i}`}
        className="rf-drop"
        style={{ animationDelay: `-${delay}s` }}
        d={`M ${x} 40 Q ${x} 44 ${x-1.5} 46 Q ${x-3} 44 ${x-1.5} 40 Q ${x-0.5} 38 ${x} 40 Z`}
        fill="#378ADD"
      />
    );
  }
  return <g opacity="0.85">{drops}</g>;
}
function Cloud({ show }) {
  if (!show) return null;
  return (
    <g opacity="0.55">
      <ellipse cx="200" cy="28" rx="80" ry="14" fill="#B5D4F4" />
      <ellipse cx="170" cy="22" rx="34" ry="13" fill="#B5D4F4" />
      <ellipse cx="230" cy="22" rx="34" ry="13" fill="#B5D4F4" />
    </g>
  );
}
function Sun({ show }) {
  if (!show) return null;
  return (
    <>
      <circle cx="360" cy="42" r="11" fill="#FAC775" />
      <circle cx="357" cy="38" r="3" fill="#FFFFFF" opacity="0.5" />
    </>
  );
}
function Coin({ c, i }) {
  return (
    <g className="rf-pop" style={{ animationDelay: `${0.4 + i * 0.2}s` }}>
      <rect x={c.x-22} y={c.y-10} rx="10" ry="10" width="64" height="20" fill="#2F6E00" />
      <text x={c.x+10} y={c.y+4} textAnchor="middle" fontSize="11" fontWeight="500" fill="#FFFFFF" fontFamily="system-ui">{c.amount}</text>
    </g>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────
export function RewardFlowAnimation() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef(null);

  // Auto-advance — 4.5s per step, pause when user takes manual control.
  useEffect(() => {
    if (!auto) return;
    timerRef.current = setTimeout(() => {
      setStep(s => (s < STEPS.length - 1 ? s + 1 : s));
    }, 4500);
    return () => clearTimeout(timerRef.current);
  }, [step, auto]);

  const s = STEPS[step];
  const moneyStr = s.money >= 1000
    ? '$' + s.money.toLocaleString()
    : '$' + (s.money % 1 === 0 ? s.money : s.money.toFixed(2));

  const next = () => { setAuto(false); setStep(v => Math.min(STEPS.length - 1, v + 1)); };
  const prev = () => { setAuto(false); setStep(v => Math.max(0, v - 1)); };
  const replay = () => { setStep(0); setAuto(true); };

  return (
    <div className="px-1">
      {/* Counter */}
      <div className="flex justify-between items-center px-3.5 py-2 bg-bg5/60 rounded-[10px] mb-2">
        <span className="text-[12px] text-b3 font-medium">Your network earnings</span>
        <span key={`m-${step}`} className="text-[14px] font-bold text-g rf-tick tabular-nums">{moneyStr}</span>
      </div>

      {/* Stage */}
      <div
        className="w-full rounded-[14px] overflow-hidden"
        style={{ height: 240, background: 'linear-gradient(180deg, #F3F8FF 0%, #FFF9EA 70%, #F1EFE8 100%)' }}
      >
        <svg viewBox="0 0 400 260" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <line x1="20" y1="232" x2="380" y2="232" stroke="#5C3A14" strokeWidth="0.8" opacity="0.3" />
          <Sun show={s.sun} />
          <Cloud show={s.rain > 0} />
          <Rain count={s.rain} />
          {s.sprouts.map((sp, i) => <Sprout key={`sp-${step}-${i}`} s={sp} />)}
          {s.coins.map((c, i) => <Coin key={`c-${step}-${i}`} c={c} i={i} />)}
        </svg>
      </div>

      {/* Caption */}
      <div className="py-3 px-1">
        <p className="text-[10px] text-b3 uppercase tracking-wide font-medium">{s.num}</p>
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
