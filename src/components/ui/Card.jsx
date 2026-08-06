// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "02 — STRUCTURE").
// Card: the one card, three radii by role.
//   r=18 → media card · r=12 → review card · r=8 → row
// White surface, 1px inset ring in bdr (subtle border on white, design-spec).
// selected swaps the ring to 2px brand green.

const RADIUS = { 8: 'rounded-[8px]', 12: 'rounded-[12px]', 18: 'rounded-[18px]' };

export function Card({ r = 12, selected = false, className = '', children, ...rest }) {
  const radius = RADIUS[r] || RADIUS[12];
  const ring = selected ? 'ring-2 ring-inset ring-g' : 'ring-1 ring-inset ring-bdr';
  return (
    <div className={`bg-white ${radius} ${ring} ${className}`} {...rest}>
      {children}
    </div>
  );
}
