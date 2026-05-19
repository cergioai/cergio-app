// Per design-spec.md — manual recommendation blurb form.
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

export function RecommendServiceFormScreen() {
  const navigate = useNavigate();
  const { showToast } = useOutletContext();
  const [text, setText] = useState('');

  const valid = text.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col bg-white pb-24">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(-1)}
          className="text-2xl text-black font-bold w-9 h-9 flex items-center justify-center"
        >
          ‹
        </button>
      </div>

      <div className="px-5 pt-2 pb-5">
        <h1 className="text-[24px] font-extrabold text-black">Tell us about this service</h1>
        <p className="text-[14px] text-b3 leading-relaxed mt-2">
          Write a quick blurb about why you recommend this service. Users looking to book this service
          will see your recommendation.
        </p>
      </div>

      <div className="px-5 flex-1">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="I recommend this service because…"
          className="w-full h-[260px] border border-bdr rounded-[18px] p-4 text-[14px] text-black
                     placeholder-b3 outline-none focus:ring-2 focus:ring-g/30 resize-none font-sans"
        />
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-white border-t border-bdr px-5 pt-3 pb-5">
        <button
          onClick={() => {
            if (!valid) return;
            showToast('Recommendation sent');
            navigate('/earnings');
          }}
          disabled={!valid}
          className={`w-full rounded-[24px] py-3.5 text-[15px] font-extrabold transition-all
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
