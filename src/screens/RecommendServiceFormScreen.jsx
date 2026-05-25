// Per design-spec.md (and Profile-as-canon) — manual recommendation blurb form.
// Aligned to app-wide canon: cream bg, 30px page title, 17px primary CTA,
// supportive microcopy that walks the user through what's about to happen +
// what they'll earn (REWARDS-driven).
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { REWARDS } from '../lib/rewards';

export function RecommendServiceFormScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const [text, setText] = useState('');

  const valid = text.trim().length > 0;
  const remaining = Math.max(0, 280 - text.length);

  return (
    <div className="flex-1 flex flex-col bg-cream pb-24">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>

      <div className="px-5 pt-2 pb-5">
        <h1 className="text-[30px] font-extrabold text-black leading-tight">
          Tell us about this service
        </h1>
        <p className="text-[15px] text-b3 font-medium leading-relaxed mt-2">
          Friends-of-friends trust short, honest blurbs. Say why you'd send a
          friend here and what stood out.
        </p>
        {/* Reward hint — keep the user motivated without burying the form. */}
        <p className="text-[12px] text-gd font-extrabold mt-3">
          You earn ${REWARDS.serviceRecoCredit} every time a friend books from your recommendation.
        </p>
      </div>

      <div className="px-5 flex-1">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={280}
          placeholder={`Try: "Maria did our deep clean before move-out — fast, friendly, fair price. Ask for the deep clean package."`}
          className="w-full h-[240px] bg-white border border-bdr rounded-[18px] p-4 text-[15px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans
                     leading-relaxed"
        />
        <p className="text-[11px] text-b3 mt-2 text-right">{remaining} characters left</p>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-cream border-t border-bdr px-5 pt-3 pb-5">
        <button
          onClick={() => {
            if (!valid) return;
            showToast('Recommendation sent ✓');
            navigate('/earnings');
          }}
          disabled={!valid}
          className={`w-full rounded-[24px] py-4 text-[17px] font-extrabold transition-all
            ${valid
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Send recommendation
        </button>
      </div>
    </div>
  );
}
