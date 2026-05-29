// Become a Connector — the consolidated benefits + selector page.
//
// CERGIO-GUARD: one screen, three sections:
//   1. Who is a Connector — clear definition (influencer OR super-user)
//   2. User vs Connector benefits — side-by-side dual reward stack
//   3. Compounding example — 50 friends → $12.5K, plus services-loop bonus
//   4. "I am a…" type selector (Influencer / Local biz / Super user)
//
// Keep copy tight (one-liners) and consistent with EarnExplainerScreen
// + Home invite house ads. Numbers come from rewards.js.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';

const TYPES = [
  {
    id: 'influencer',
    title: 'Influencer',
    desc:  '5,000+ followers on Instagram or TikTok. Your audience books services you spotlight.',
  },
  {
    id: 'local-business',
    title: 'Local business or service',
    desc:  'Stores, gyms, salons, real-estate — your customer base IS a referral network.',
  },
  {
    id: 'super-user',
    title: 'Cergio Super User',
    desc:  `${REWARDS.superUserFriendsPerMonth} friends booking per month. Your social graph compounds for you.`,
  },
];

const PER_FRIEND  = REWARDS.perFriend;            // 250
const EXAMPLE_FRIENDS = 50;
const EXAMPLE_TOTAL   = PER_FRIEND * EXAMPLE_FRIENDS; // 12,500

export function RainmakerApplyScreen() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('influencer');

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* hero */}
      <div className="bg-gradient-to-b from-gm to-g px-7 pt-8 pb-10 relative">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white/95 border-none
                     flex items-center justify-center text-black text-base mb-3"
        >
          ‹
        </button>
        <h1 className="text-[26px] font-extrabold text-white leading-tight">
          Become a Connector
        </h1>
        <p className="text-[13px] text-white/90 leading-relaxed mt-2 font-medium">
          Influencers and super-users with strong local networks.
          Drive growth for your community — share in the upside.
        </p>
      </div>

      {/* sheet */}
      <div className="bg-cr rounded-t-[28px] -mt-7 px-5 pt-7 flex-1 pb-32 overflow-y-auto">
        {/* ── Benefits comparison: User vs Connector ─────────────────── */}
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">
          What you earn
        </p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {/* User column */}
          <div className="bg-white border border-bdr rounded-[16px] p-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-b3 mb-1">User</p>
            <p className="text-[14px] font-extrabold text-black leading-tight">${PER_FRIEND} credit</p>
            <p className="text-[11px] text-b3 mt-0.5 leading-snug">per friend who joins + books</p>
            <ul className="mt-3 space-y-1 text-[11px] text-b2 leading-snug">
              <li>• Free services credit</li>
              <li>• <span className="font-bold">+{REWARDS.friendOfFriendPercent}% (${REWARDS.friendOfFriendBonus})</span> when friends bring friends</li>
              <li>• Growth Participation Income</li>
            </ul>
          </div>
          {/* Connector column */}
          <div className="bg-gl border border-g/30 rounded-[16px] p-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-gd mb-1">Connector</p>
            <p className="text-[14px] font-extrabold text-black leading-tight">${PER_FRIEND} cash</p>
            <p className="text-[11px] text-gd/80 mt-0.5 leading-snug">per friend who joins + books</p>
            <ul className="mt-3 space-y-1 text-[11px] text-b2 leading-snug">
              <li>• <span className="font-bold">Free services</span> (providers pay in spotlights)</li>
              <li>• <span className="font-bold">+{REWARDS.friendOfFriendPercent}% (${REWARDS.friendOfFriendBonus})</span> on second-tier signups</li>
              <li>• <span className="font-bold">Growth Participation Income</span> — higher score</li>
              <li>• <span className="font-bold">Spotlight rate card</span> — paid posts</li>
            </ul>
          </div>
        </div>

        {/* ── Compounding example ───────────────────────────────────── */}
        <div className="bg-white border border-bdr rounded-[18px] p-5 mb-6">
          <p className="text-[12px] font-extrabold uppercase tracking-widest text-b3 mb-1">
            The math
          </p>
          <p className="text-[20px] font-extrabold text-black leading-tight">
            {EXAMPLE_FRIENDS} friends → ${EXAMPLE_TOTAL.toLocaleString()}
          </p>
          <p className="text-[12px] text-b3 mt-2 leading-snug">
            Each friend who joins + books = ${PER_FRIEND} to you. Bring 50 and you're at
            <span className="font-bold text-black"> ${EXAMPLE_TOTAL.toLocaleString()}</span>.
          </p>
          <p className="text-[12px] text-b3 mt-2 leading-snug">
            It compounds: when your friends recommend services that get booked,
            those bookings add to your pool too. Your network does the work — you
            earn the upside.
          </p>
        </div>

        {/* ── Type selector ─────────────────────────────────────────── */}
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-b3 mb-3">
          I am a…
        </p>
        <div className="flex flex-col gap-2">
          {TYPES.map(t => {
            const active = selected === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={`w-full text-left p-4 rounded-[16px] border transition-colors
                  ${active ? 'bg-gl border-g/60' : 'bg-white border-bdr hover:border-g/40'}`}
              >
                <p className="text-[14px] font-extrabold text-black mb-0.5">{t.title}</p>
                <p className="text-[12px] text-b3 leading-relaxed">{t.desc}</p>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-gd/80 font-normal mt-6 leading-snug text-center">
          Cergio's mission: human-powered AI that enables shared prosperity.
        </p>
      </div>

      {/* footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr border-t border-bdr px-5 py-4 flex justify-end">
        <button
          onClick={() => navigate(`/rainmaker/apply/details?type=${selected}`)}
          className="bg-g text-white rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Next
        </button>
      </div>
    </div>
  );
}
