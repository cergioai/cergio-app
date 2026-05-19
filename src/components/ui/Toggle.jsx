// iOS-style sliding toggle (airplane-mode style).
// Per design-spec.md — uses brand green when ON.
export function Toggle({ on, onChange, size = 'md' }) {
  const dims = size === 'sm'
    ? { w: 40, h: 24, knob: 20 }
    : { w: 52, h: 30, knob: 26 };
  const knobShift = dims.w - dims.knob - 4; // 4px = inset on both sides

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative rounded-full transition-colors flex-shrink-0
                  ${on ? 'bg-g' : 'bg-bdr'}`}
      style={{ width: dims.w, height: dims.h }}
    >
      <span
        className="absolute top-0.5 left-0.5 bg-white rounded-full shadow-card transition-transform"
        style={{
          width: dims.knob,
          height: dims.knob,
          transform: on ? `translateX(${knobShift}px)` : 'translateX(0)',
        }}
      />
    </button>
  );
}
