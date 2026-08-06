// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "02 — STRUCTURE").
// QuoteBubble: every reco and review anywhere in the app. Soft grey bubble,
// 30px avatar (initials fallback via the shared Avatar), quote in b2, and the
// date line — which is NEVER optional (kit rule). Callers pass the already
// formatted date string ("Reco'd 14 Mar 2024").

import { Avatar } from './Avatar';

export function QuoteBubble({ author, avatarUrl, date, children, className = '' }) {
  return (
    <div className={`bg-soft rounded-[10px] p-3.5 flex items-start gap-2.5 ${className}`}>
      <Avatar url={avatarUrl} name={author} size={30} />
      <div className="flex flex-col gap-1 min-w-0">
        <p className="text-body text-b2 leading-snug">{children}</p>
        <p className="text-meta-sm font-medium text-b3 tracking-[.02em] leading-none">{date}</p>
      </div>
    </div>
  );
}
