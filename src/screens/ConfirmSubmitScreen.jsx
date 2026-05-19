// Per design-spec.md — Step 2: confirm request + payment + submit.
// Shows for first-time users after the free-offers popup.
import { useNavigate, useOutletContext } from 'react-router-dom';

const PHOTOS = ['fv-jamie', 'fv-john', 'fv-steve', 'fv-jamie'];

export function ConfirmSubmitScreen() {
  const navigate = useNavigate();
  const { chat } = useOutletContext();
  const { what, when, where } = chat.state;

  const service = what  || 'Housekeeper';
  const place   = where || '524 Address Way, Los Ang…';
  const date    = when  || 'Thu, Oct 27 at 10:00 AM';

  return (
    <div className="flex-1 flex flex-col bg-cr">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 bg-white border-b border-bdr">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ‹
        </button>
        <p className="text-[14px] font-bold text-b3">Step 2 — Submit Request</p>
        <div className="w-10" />
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="bg-white px-5 pt-6 pb-5">
          <h1 className="text-[24px] font-extrabold text-black mb-5">Confirm and submit</h1>

          {/* service row */}
          <button className="w-full flex items-center justify-between py-2 mb-2 text-left">
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="3" y="6" width="18" height="14" rx="2" />
                <path d="M9 6V4h6v2" />
              </svg>
              <span className="text-[16px] font-extrabold text-black">{service}</span>
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>

          {/* description + photos */}
          <div className="pl-9 mb-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#b06090] to-[#703050] flex-shrink-0" />
              <p className="text-[13px] text-black leading-relaxed">
                I'm looking to get my house deep cleaned after throwin…{' '}
                <span className="font-bold underline">Read more</span>
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {PHOTOS.map((bg, i) => (
                <div key={i} className={`aspect-square rounded-[8px] ${bg}`} />
              ))}
            </div>
          </div>

          {/* location row */}
          <div className="border-t border-bdr py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              <span className="text-[15px] text-black">{place}</span>
            </div>
            <span className="text-b3 text-lg">›</span>
          </div>

          {/* date row */}
          <div className="border-t border-bdr py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M3 10h18M8 2v4M16 2v4" />
              </svg>
              <span className="text-[15px] text-black">{date}</span>
            </div>
            <span className="text-b3 text-lg">›</span>
          </div>
        </div>

        {/* payment section */}
        <div className="bg-white mt-3 px-5 py-5">
          <p className="text-[16px] font-extrabold text-black mb-3">Payment</p>
          <button className="w-full flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
              </svg>
              <span className="text-[15px] font-bold text-black">VISA *5329</span>
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>
          <div className="flex items-center gap-2 mt-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4AA901" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span className="text-[13px] text-g font-bold leading-relaxed">
              You won't be charged until your booking is confirmed.
            </span>
          </div>
        </div>
      </div>

      {/* CTA — black per the mockup */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white px-5 py-5">
        <button
          onClick={() => navigate('/roaming')}
          className="w-full bg-black text-white rounded-[24px] py-4 text-[15px] font-extrabold
                     hover:opacity-90 active:scale-[.97] transition-all"
        >
          Submit request
        </button>
      </div>
    </div>
  );
}
