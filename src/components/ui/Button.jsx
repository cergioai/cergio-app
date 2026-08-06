// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "03 — ACTION").
// Button: one green, one outline, one disabled — anything else is a bug.
// 50px tall, radius 14 (the kit's CTA geometry for the redesigned screens).
//   variant="solid"    bg-g, white, 700
//   variant="outline"  1px g ring, gd text, 600
//   disabled           bg-gdis (the kit's #C6D9B4, tokenised), white, 700
// text-[15px] matches the design-spec CTA snippets (its sanctioned CTA size).

export function Button({ variant = 'solid', disabled = false, className = '', children, type = 'button', ...rest }) {
  const base = 'w-full h-[50px] rounded-[14px] text-[15px] text-center transition-all active:scale-[.97]';
  const look = disabled
    ? 'bg-gdis text-white font-bold cursor-not-allowed active:scale-100'
    : variant === 'outline'
      ? 'bg-transparent ring-1 ring-inset ring-g text-gd font-semibold hover:bg-gl'
      : 'bg-g text-white font-bold hover:opacity-90';
  return (
    <button type={type} disabled={disabled} className={`${base} ${look} ${className}`} {...rest}>
      {children}
    </button>
  );
}
