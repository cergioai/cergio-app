// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "02 — STRUCTURE").
// SectionTitle: section header + optional sub.
//   size="profile" (default) → 18/700 (heading-2 step, kit mandates 700)
//   size="pdp"               → 20/600 (kit-mandated; sits between the
//                              heading-2 and heading-1 scale steps)
// Sub is body (14) in b3, per the kit card.

export function SectionTitle({ children, sub, size = 'profile', className = '' }) {
  const title = size === 'pdp'
    ? 'text-[20px] leading-[1.15] font-semibold text-black'
    : 'text-heading-2 font-bold text-black';
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <h2 className={title}>{children}</h2>
      {sub ? <p className="text-body text-b3">{sub}</p> : null}
    </div>
  );
}
