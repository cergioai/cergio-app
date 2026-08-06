// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "03 — ACTION").
// Pill: follow, share, discount tags.
//   tone="solid" → bg-g, white ("Follow", "20% off")
//   tone="quiet" → white, 1px line ring, b2 text ("Share")
// Rounded-pill always. Renders a button when given an onClick, a span
// otherwise (discount tags are not pressable).

export function Pill({ tone = 'solid', onClick, className = '', children, ...rest }) {
  const look = tone === 'quiet'
    ? 'bg-white ring-1 ring-inset ring-line text-b2'
    : 'bg-g text-white';
  const cls = `inline-flex items-center justify-center rounded-pill px-3 py-1.5 text-meta font-extrabold leading-none ${look} ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} {...rest}>{children}</button>
    );
  }
  return <span className={cls} {...rest}>{children}</span>;
}
