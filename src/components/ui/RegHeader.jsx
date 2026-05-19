// Shared header pattern for onboarding flows (Rainmaker reg + Service listing).
// Per design-spec.md — green gradient + white headline + optional sub.
import { useNavigate } from 'react-router-dom';

export function RegHeader({ title, sub, showBack = true, minHeight = 220 }) {
  const navigate = useNavigate();
  return (
    <div
      className="bg-gradient-to-b from-gm to-g px-7 pt-8 pb-12 flex flex-col"
      style={{ minHeight }}
    >
      {showBack && (
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white/95 flex items-center justify-center
                     text-black text-base mb-3"
        >
          ‹
        </button>
      )}
      <div className="mt-auto">
        <h1 className="text-[26px] font-extrabold text-white leading-tight">{title}</h1>
        {sub && <p className="text-[14px] text-white/85 mt-2 leading-relaxed">{sub}</p>}
      </div>
    </div>
  );
}

// Reusable progress + Back/Next footer for multi-step flows.
export function RegFooter({ progress, onBack, onNext, nextLabel = 'Next', nextEnabled = true }) {
  const navigate = useNavigate();
  return (
    <>
      {progress != null && (
        <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[390px] h-[3px] bg-bdr">
          <div className="h-full bg-g" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-cr px-5 py-4 flex items-center justify-between">
        <button
          onClick={onBack || (() => navigate(-1))}
          className="text-[15px] font-extrabold text-black underline underline-offset-2"
        >
          Back
        </button>
        <button
          onClick={() => nextEnabled && onNext && onNext()}
          disabled={!nextEnabled}
          className={`rounded-[24px] px-10 py-3.5 text-[15px] font-extrabold transition-all
            ${nextEnabled
              ? 'bg-g text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          {nextLabel}
        </button>
      </div>
    </>
  );
}
