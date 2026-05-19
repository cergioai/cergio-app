export function Toast({ msg, show }) {
  return (
    <div
      className={`fixed bottom-[90px] left-1/2 -translate-x-1/2 z-[9999]
                  bg-black text-white text-[13px] font-semibold px-5 py-3 rounded-pill
                  whitespace-nowrap pointer-events-none transition-all duration-300
                  ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
    >
      {msg}
    </div>
  );
}
