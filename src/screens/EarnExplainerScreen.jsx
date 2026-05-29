// How earnings work — anchored on the 7% platform fee + $250 per user.
// CERGIO-GUARD: no "Cergio Cash" / "Cergio Coin" terms. No 25%-of-services
// math — that wasn't accurate. The real model: Cergio takes 7% on
// bookings; we share that with you up to $250 per friend who joins +
// books. Growth Participation Income explainer is linked back to the
// popup on Earnings.
import { useNavigate } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';
import { RewardFlowAnimation } from '../components/ui/RewardFlowAnimation';

export function EarnExplainerScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      {/* header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-2">
        <div className="w-12 h-12 rounded-full bg-gl border border-g/25 flex items-center justify-center">
          <span className="text-gd text-[20px] font-extrabold">★</span>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center text-black"
        >
          ✕
        </button>
      </div>

      <div className="px-5 pt-3 pb-3">
        <h1 className="text-[24px] font-extrabold text-black leading-tight">
          How earnings work
        </h1>
        <p className="text-[13px] text-b3 leading-relaxed mt-2">
          What you earn as a User vs a Connector — and how the math adds up.
        </p>
      </div>

      {/* CERGIO-GUARD (2026-05-28 v2): live animation walks the four
          mechanisms — direct cash → trust/network → Connector barter →
          Growth Participation. Sprouts represent people. Self-paced. */}
      <div className="px-3 mb-5">
        <RewardFlowAnimation />
      </div>

      <div className="px-5 pb-5">
        <p className="text-[13px] text-b3 leading-relaxed">
          Mechanically: when a friend you invited books a service, Cergio earns a
          <span className="text-black font-extrabold"> 7% fee</span> — and we share that with you,
          up to <span className="text-black font-extrabold">${REWARDS.perFriend}</span> per friend.
        </p>
      </div>

      {/* The model in three lines. */}
      <div className="mx-5 bg-soft rounded-[18px] p-5 mb-4">
        <p className="text-[14px] font-extrabold text-black leading-tight mb-2">The model</p>
        <ol className="text-[13px] text-b2 leading-relaxed space-y-2">
          <li><span className="font-bold">1.</span> You invite a friend (or recommend a service).</li>
          <li><span className="font-bold">2.</span> They join Cergio and book any service.</li>
          <li><span className="font-bold">3.</span> Cergio earns a <span className="font-bold">7%</span> platform fee on each of their bookings; we share that with you until you've earned <span className="font-bold">${REWARDS.perFriend}</span> from them.</li>
        </ol>
      </div>

      {/* Example. */}
      <div className="mx-5 bg-soft rounded-[18px] p-5 mb-4">
        <p className="text-[14px] font-extrabold text-black leading-tight mb-2">Example</p>
        <p className="text-[13px] text-b2 leading-relaxed">
          Your friend Jamie books a $300 deep clean. Cergio's 7% fee on that booking is{' '}
          <span className="font-bold">$21</span> — and you earn that. Keep going across Jamie's
          future bookings until you've earned the full <span className="font-bold">${REWARDS.perFriend}</span>.
        </p>
      </div>

      {/* Growth Participation Income teaser. */}
      <div className="mx-5 bg-gl border border-g/25 rounded-[18px] p-4 mb-4">
        <p className="text-[14px] font-extrabold text-gd leading-tight mb-1">
          Plus: Growth Participation Income
        </p>
        <p className="text-[12px] text-gd/85 leading-snug font-normal">
          Every dollar you earn also builds a participation score — like airmiles, but tied to
          Cergio's growth. Activates if Cergio goes public (IPO). Community participation in
          growth helps accelerate it.
        </p>
      </div>

      {/* Mission. */}
      <p className="mx-5 text-[11px] text-b3 font-normal leading-snug">
        Cergio's mission: human-powered AI that enables shared prosperity. Your bonus is
        directly tied to your participation in that growth.
      </p>
    </div>
  );
}
