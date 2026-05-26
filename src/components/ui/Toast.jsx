// CERGIO-GUARD: when `sticky` is true the toast STAYS UP until the user
// taps the × to dismiss it. We use sticky for actionable error messages
// (the 2.6s default was too short for the user to read + react).
// pointer-events-auto is required when sticky so the dismiss button is
// actually clickable.
export function Toast({ msg, show, sticky = false, onDismiss }) {
  if (!msg) return null;
  return (
    <div
      className={`fixed bottom-[90px] left-1/2 -translate-x-1/2 z-[9999]
                  bg-black text-white text-[13px] font-semibold px-5 py-3 rounded-pill
                  max-w-[92vw] transition-all duration-300
                  ${sticky ? 'pointer-events-auto whitespace-normal text-center' : 'pointer-events-none whitespace-nowrap'}
                  ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      role={sticky ? 'alert' : 'status'}
    >
      <div className="flex items-center gap-3">
        <span className="leading-snug">{msg}</span>
        {sticky && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-white/80 hover:text-white text-[16px] font-bold leading-none px-1"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
