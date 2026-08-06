// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "02 — STRUCTURE").
// PerkPanel: the mint callout ("Local Creator perk! …"). This is THE ONLY
// place bg-gl is used as a panel surface — never use gl for a neutral panel
// (kit rule). Bold 12 text in gd, perk icon on the right.
//
// PerkIcon is exported because RequestBox's echo line uses the same glyph
// (kit "04 — WHAT THE AI TOUCHES").

export function PerkIcon({ size = 19 }) {
  const w = size * (26 / 22.286);
  return (
    <svg width={w} height={size} viewBox="0 0 26 22.286" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path fillRule="evenodd" d="M 4.508 7.705 C 4.452 7.179 4.473 6.639 4.566 6.101 C 3.493 5.723 2.562 5.445 1.647 5.222 C 0.002 4.822 -0.681 2.657 0.874 1.977 C 2.478 1.275 4.18 1.366 6.568 2.253 C 7.861 0.915 9.672 0 11.766 0 L 14.004 0 C 16.154 0 18.053 0.908 19.378 2.273 C 21.794 1.367 23.51 1.27 25.126 1.977 C 26.681 2.657 25.998 4.822 24.353 5.222 C 23.398 5.454 22.425 5.748 21.292 6.152 C 21.367 6.778 21.343 7.416 21.206 8.047 L 21.002 9.14 L 20.564 12.594 C 20.185 15.574 18.12 17.955 15.424 18.79 C 14.815 19.669 14.987 20.956 15.94 21.605 C 15.94 22.27 15.515 22.324 14.732 22.27 C 12.801 22.139 11.205 20.745 10.748 18.873 C 8.025 18.154 5.878 15.873 5.368 12.938 L 4.709 9.14 L 4.508 7.705 Z M 16.674 10.993 C 17.085 10.464 17.388 9.893 17.452 9.237 C 17.516 8.579 17.393 7.959 16.99 7.397 C 16.739 7.028 16.367 6.738 15.925 6.567 C 15.483 6.395 14.993 6.35 14.522 6.438 C 13.943 6.54 13.414 6.803 13.01 7.189 C 12.931 7.261 12.857 7.337 12.784 7.413 C 12.751 7.448 12.717 7.482 12.683 7.517 C 12.675 7.515 12.668 7.512 12.661 7.508 C 12.655 7.502 12.649 7.495 12.643 7.489 C 12.624 7.469 12.605 7.449 12.587 7.428 C 12.296 7.096 11.927 6.826 11.507 6.637 C 10.567 6.22 9.511 6.339 8.769 6.971 C 8.138 7.507 7.897 8.19 7.897 8.955 C 7.904 9.588 8.114 10.206 8.503 10.734 C 9.031 11.481 9.68 12.154 10.43 12.729 C 10.863 13.077 11.351 13.367 11.878 13.588 C 12.183 13.709 12.495 13.798 12.835 13.76 C 13.273 13.71 13.658 13.539 14.023 13.33 C 15.089 12.719 15.951 11.919 16.674 10.993 Z" />
    </svg>
  );
}

export function PerkPanel({ children, icon = true, className = '' }) {
  return (
    <div className={`bg-gl rounded-[8px] px-3.5 py-3 flex items-center gap-2.5 text-gd ${className}`}>
      <span className="flex-1 text-meta font-bold leading-snug">{children}</span>
      {icon ? <PerkIcon /> : null}
    </div>
  );
}
