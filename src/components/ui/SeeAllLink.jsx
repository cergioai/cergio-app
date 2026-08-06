// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "03 — ACTION").
// SeeAllLink: section footers are links with a count — NEVER a green button
// (kit rule). Label + (count) + right-pointing chevron. Given `to` it renders
// a router Link; given onClick, a button.

import { Link } from 'react-router-dom';

function Chevron() {
  return (
    <svg width="6" height="11" viewBox="0 0 6 10.909" fill="currentColor" aria-hidden="true" className="shrink-0 -scale-x-100">
      <path fillRule="evenodd" d="M 5.25 0 L 6 0.779 L 1.5 5.455 L 6 10.13 L 5.25 10.909 L 0.75 6.234 L 0 5.455 L 0.75 4.675 L 5.25 0 Z" />
    </svg>
  );
}

export function SeeAllLink({ label, count, to, onClick, className = '' }) {
  const body = (
    <>
      <span className="text-body text-b2">
        {label}{Number.isFinite(Number(count)) && count !== null && count !== undefined ? ` (${count})` : ''}
      </span>
      <span className="text-b2"><Chevron /></span>
    </>
  );
  const cls = `inline-flex items-center gap-3 ${className}`;
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}
