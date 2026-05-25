// Per design-spec.md — Step 2: confirm request + payment + submit.
// Wired to real chat.state (no hardcoded "Housekeeper" / "VISA *5329" /
// fake photo blocks). When a field is missing, we render an "Add" affordance
// instead of a placeholder string the user would mistake for a real value.
import { useNavigate, useOutletContext } from 'react-router-dom';

export function ConfirmSubmitScreen() {
  const navigate = useNavigate();
  const { chat, auth, showToast } = useOutletContext();
  const { what, when, where, notes, photos } = chat.state || {};

  // Real attached photos (if chat captured any). The old static `PHOTOS`
  // grid is gone — empty array = the photo block doesn't render at all.
  const realPhotos = Array.isArray(photos) ? photos : [];

  return (
    <div className="flex-1 flex flex-col bg-cream">
      {/* top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 bg-white border-b border-bdr">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white border border-bdr
                     flex items-center justify-center text-black text-base"
        >
          ‹
        </button>
        <p className="text-[13px] font-bold text-b3">Step 2 — Submit Request</p>
        <div className="w-10" />
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="bg-white px-5 pt-6 pb-5">
          <h1 className="text-[24px] font-extrabold text-black mb-5 leading-tight">Confirm and submit</h1>

          {/* service row — real value from chat, "Add" affordance if missing */}
          <button
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-between py-2 mb-2 text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="3" y="6" width="18" height="14" rx="2" />
                <path d="M9 6V4h6v2" />
              </svg>
              {what
                ? <span className="text-[16px] font-extrabold text-black">{what}</span>
                : <span className="text-[14px] font-bold text-danger">Add service</span>}
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>

          {/* notes + real attached photos (only render if present) */}
          {(notes || realPhotos.length > 0) && (
            <div className="pl-9 mb-4">
              {notes && (
                <p className="text-[13px] text-black leading-relaxed mb-3">{notes}</p>
              )}
              {realPhotos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {realPhotos.slice(0, 4).map((src, i) => (
                    <img
                      key={i}
                      src={typeof src === 'string' ? src : src?.dataUrl}
                      alt={`Attachment ${i + 1}`}
                      className="aspect-square rounded-[8px] object-cover border border-bdr"
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* location row */}
          <button
            onClick={() => navigate(-1)}
            className="w-full border-t border-bdr py-4 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <path d="M12 22s7-7 7-13a7 7 0 0 0-14 0c0 6 7 13 7 13z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              {where
                ? <span className="text-[15px] text-black truncate max-w-[260px]">{where}</span>
                : <span className="text-[14px] font-bold text-danger">Add address</span>}
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>

          {/* date row */}
          <button
            onClick={() => navigate(-1)}
            className="w-full border-t border-bdr py-4 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M3 10h18M8 2v4M16 2v4" />
              </svg>
              {when
                ? <span className="text-[15px] text-black">{when}</span>
                : <span className="text-[14px] font-bold text-danger">Add date / time</span>}
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>
        </div>

        {/* payment section — placeholder until real card-on-file is wired.
            Doesn't show a fake "VISA *5329" anymore. */}
        <div className="bg-white mt-3 px-5 py-5">
          <p className="text-[14px] font-extrabold uppercase tracking-widest text-b3 mb-3">Payment</p>
          <button
            onClick={() => showToast('Card on file — coming soon')}
            className="w-full flex items-center justify-between py-2 text-left"
          >
            <div className="flex items-center gap-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="1.8">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
              </svg>
              <span className="text-[14px] font-bold text-danger">Add a payment method</span>
            </div>
            <span className="text-b3 text-lg">›</span>
          </button>
          <div className="flex items-start gap-2 mt-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4AA901" strokeWidth="2" className="mt-0.5 flex-shrink-0">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            <span className="text-[12px] text-g font-bold leading-relaxed">
              You won't be charged until your booking is confirmed.
            </span>
          </div>
        </div>
      </div>

      {/* CTA — disabled until the three required fields are present */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px]
                      bg-white px-5 py-5 border-t border-bdr">
        <button
          onClick={() => {
            if (!auth?.isSignedIn) {
              showToast('Sign in to submit your request');
              navigate('/auth');
              return;
            }
            navigate('/roaming', { state: { what, when, where, notes } });
          }}
          disabled={!what || !when || !where}
          className={`w-full rounded-[24px] py-4 text-[16px] font-extrabold transition-all
            ${(what && when && where)
              ? 'bg-black text-white hover:opacity-90 active:scale-[.97]'
              : 'bg-bg5 text-b3 cursor-not-allowed'}`}
        >
          Submit request
        </button>
      </div>
    </div>
  );
}
