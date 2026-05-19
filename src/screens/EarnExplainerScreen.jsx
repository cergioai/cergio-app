// Per design-spec.md — "How to earn Cergio Cash from invites" examples modal.
import { useNavigate } from 'react-router-dom';

export function EarnExplainerScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col bg-white pb-8 overflow-y-auto">
      {/* header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-2">
        <div className="w-12 h-12 rounded-full bg-g flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center text-black"
        >
          ✕
        </button>
      </div>

      <div className="px-5 pt-3 pb-4">
        <h1 className="text-[26px] font-extrabold text-black leading-tight">
          How to earn Cergio Cash<br />from invites
        </h1>
        <p className="text-[14px] text-b3 leading-relaxed mt-3">
          You will earn 25% of the first few services your friend completes, up to $250. See examples below:
        </p>
      </div>

      {/* example: inviting */}
      <div className="mx-5 bg-soft rounded-[18px] p-5 mb-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-[18px] font-extrabold text-black">Inviting a friend</p>
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#b06090] to-[#703050]
                          flex items-center justify-center text-white text-[16px] font-extrabold flex-shrink-0">
            JF
          </div>
        </div>
        <p className="text-[14px] text-black leading-relaxed mb-3">
          Your friend books a personal chef service for $200, you will earn <span className="font-extrabold">$50</span>.
        </p>
        <p className="text-[14px] text-black leading-relaxed">
          You will continue earning from your friend until you reach <span className="font-extrabold">$250</span>.
        </p>
      </div>

      {/* example: recommending */}
      <div className="mx-5 bg-soft rounded-[18px] p-5 mb-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-[18px] font-extrabold text-black">Recommending a service</p>
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#c07050] to-[#903828]
                          flex items-center justify-center text-white text-[16px] font-extrabold flex-shrink-0">
            HK
          </div>
        </div>
        <p className="text-[14px] text-black leading-relaxed mb-3">
          The housekeeper you invited completes a service for $100. You'll earn <span className="font-extrabold">$25 Cergio Cash</span>.
        </p>
        <p className="text-[14px] text-black leading-relaxed">
          You will continue earning from every booking until you reach <span className="font-extrabold">$250</span>.
        </p>
      </div>

      {/* promo footer */}
      <div className="mx-5 bg-gl rounded-[14px] p-4 flex items-start gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4AA901" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
        <p className="text-[13px] font-extrabold text-g leading-relaxed">
          This promotion expires after 90 days from when your friend joins.
        </p>
      </div>
    </div>
  );
}
