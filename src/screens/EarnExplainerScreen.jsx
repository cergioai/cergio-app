// CERGIO-GUARD (2026-05-29): copy anchored on the TRUE economics —
// Cergio's platform fee is 10% of every booking. Of that, 7% goes
// back to the inviting referrer (per invite/recommend context).
// Tarik flagged the previous "Cergio earns 7%" framing as misleading.
// All numbers from REWARDS — never hardcode percentages in copy.
import { useNavigate } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';
import { RewardFlowAnimation } from '../components/ui/RewardFlowAnimation';

export function EarnExplainerScreen() {
  const navigate = useNavigate();

  // Concrete example: $300 booking → Cergio takes 10% ($30) → 7% ($21)
  // flows to the inviter; Cergio retains 3% ($9) as platform margin.
  const exampleBookingDollars = 300;
  const exampleCergioCents = Math.round(exampleBookingDollars * (REWARDS.platformFeePercent / 100) * 100);
  const exampleReferrerCents = Math.round(exampleBookingDollars * (REWARDS.referrerSharePercent / 100) * 100);
  const exampleCergioDollars   = exampleCergioCents / 100;
  const exampleReferrerDollars = exampleReferrerCents / 100;

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      {/* header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-2">
        <div className="w-12 h-12 rounded-full bg-gl border border-g/25 flex items-center justify-center">
          <span className="text-gd text-heading-1 font-extrabold">★</span>
        </div>
        <button
          onClick={() => navigate(-1)}
          aria-label="Close"
          className="w-9 h-9 flex items-center justify-center text-black rounded-full cg-focusable"
        >
          ✕
        </button>
      </div>

      <div className="px-5 pt-3 pb-3">
        <h1 className="text-display-2 font-extrabold text-black leading-tight">
          How earnings work
        </h1>
        <p className="text-body-sm text-b3 leading-relaxed mt-2">
          What you earn as a User vs a Connector — and how the math adds up.
        </p>
        {/* CERGIO-GUARD (2026-05-30): Connector explainer CTA — Tarik:
            "add a connector's explainer somewhere (perhaps a small i
            that pops up...(also on homepage).. to take to
            /rainmaker/apply". Small text link so it doesn't compete
            with the Replay/Back controls below the animation. */}
        <button
          onClick={() => navigate('/rainmaker/apply')}
          className="inline-flex items-center gap-1.5 mt-2 text-meta font-extrabold text-gd hover:underline"
        >
          <span className="w-4 h-4 rounded-full border border-gd/60 text-gd text-[9px] font-extrabold inline-flex items-center justify-center">
            i
          </span>
          What&apos;s a Connector? Apply to become one →
        </button>
      </div>

      <div className="px-3 mb-5">
        <RewardFlowAnimation />
      </div>

      <div className="px-5 pb-5">
        <p className="text-body-sm text-b3 leading-relaxed">
          Cergio's platform fee is <span className="text-black font-extrabold">{REWARDS.platformFeePercent}%</span> on every booking.
          When you invite or recommend, we share <span className="text-black font-extrabold">{REWARDS.referrerSharePercent}%</span> of
          each booking with you — up to <span className="text-black font-extrabold">${REWARDS.perFriend}</span> per friend.
        </p>
      </div>

      {/* The model in three lines. */}
      <div className="mx-5 bg-soft rounded-[18px] p-5 mb-4">
        <p className="text-body font-extrabold text-black leading-tight mb-2">The model</p>
        <ol className="text-body-sm text-b2 leading-relaxed space-y-2">
          <li><span className="font-extrabold">1.</span> You invite a friend (or recommend a service).</li>
          <li><span className="font-extrabold">2.</span> They join Cergio and book any service.</li>
          <li><span className="font-extrabold">3.</span> Cergio charges a <span className="font-extrabold">{REWARDS.platformFeePercent}%</span> platform fee on each booking. We share <span className="font-extrabold">{REWARDS.referrerSharePercent}%</span> with you (the inviter) until you've earned <span className="font-extrabold">${REWARDS.perFriend}</span> from that friend. Only bookings within <span className="font-extrabold">{REWARDS.friendCapWindowMonths} months</span> of the invite count.</li>
        </ol>
      </div>

      {/* Example. */}
      <div className="mx-5 bg-soft rounded-[18px] p-5 mb-4">
        <p className="text-body font-extrabold text-black leading-tight mb-2">Example</p>
        <p className="text-body-sm text-b2 leading-relaxed">
          Jamie books a ${exampleBookingDollars} deep clean. Cergio's
          {' '}<span className="font-extrabold">{REWARDS.platformFeePercent}%</span> fee on that booking
          is <span className="font-extrabold">${exampleCergioDollars}</span>.
          {' '}You earn <span className="font-extrabold">{REWARDS.referrerSharePercent}%</span> = <span className="font-extrabold">${exampleReferrerDollars}</span> as
          Jamie's inviter. Keep going across Jamie's future bookings until you've earned the full
          {' '}<span className="font-extrabold">${REWARDS.perFriend}</span>.
        </p>
      </div>

      {/* Growth Participation Income teaser. */}
      <div className="mx-5 bg-gl border border-g/25 rounded-[18px] p-4 mb-4">
        <p className="text-body font-extrabold text-gd leading-tight mb-1">
          Plus: Growth Participation Income
        </p>
        <p className="text-meta text-gd/85 leading-snug font-normal">
          Every dollar you earn also builds a participation score — like airmiles, but tied to
          Cergio's growth. Activates if Cergio goes public (IPO). Community participation in
          growth helps accelerate it.
        </p>
      </div>

      {/* Mission. */}
      <p className="mx-5 text-meta-sm text-b3 font-normal leading-snug">
        Cergio's mission: friend-powered AI — built so we all prosper together. Your bonus
        is directly tied to your participation in that growth.
      </p>
    </div>
  );
}
