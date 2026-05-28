// CERGIO-GUARD (2026-05-27): observability pill — shows the current
// build's short git SHA in a tiny, low-contrast badge. Was the single
// missing observability piece during the 2-day search bug: HMR was
// silently mounting stale ResultsScreen for hours. With this pill,
// the user can compare what's on screen to `git rev-parse --short
// HEAD` and instantly tell whether to hard-reload.
//
// Constants __CERGIO_BUILD_SHA__ + __CERGIO_BUILD_TIME__ are injected
// at build/server-start time by vite.config.js define{}. Falls back
// to 'dev' / now() if Vite skipped the define for some reason.
//
// Visual rules:
//   • Bottom-left, just above BottomNav, so it never hides nav buttons
//   • text-[9px] muted gray — visible if you look, invisible if you don't
//   • Hover/long-press → tooltip with full SHA + build time
//   • Clicking the pill copies "<sha> · <iso-time>" to clipboard so
//     screenshots-only triage is one tap

import { useState } from 'react';

const SHA  = typeof __CERGIO_BUILD_SHA__  !== 'undefined' ? __CERGIO_BUILD_SHA__  : 'dev';
const TIME = typeof __CERGIO_BUILD_TIME__ !== 'undefined' ? __CERGIO_BUILD_TIME__ : new Date().toISOString();

export function BuildVersionPill() {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(`${SHA} · ${TIME}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — pill still shows */ }
  };
  // Format time as "May 27 6:30p" (local), trimmed for the pill.
  const short = (() => {
    try {
      const d = new Date(TIME);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit' }).replace(' ', ' ');
    } catch { return ''; }
  })();
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Build ${SHA} · ${TIME}`}
      aria-label={`Build version ${SHA}, click to copy`}
      className="fixed left-2 bottom-[64px] z-30
                 text-[9px] font-mono tracking-tight
                 text-b3/40 hover:text-b2 bg-transparent border-0
                 px-1 py-0.5 cursor-pointer select-none
                 leading-none"
      data-cergio-build={SHA}
    >
      {copied ? '✓ copied' : `v ${SHA} · ${short}`}
    </button>
  );
}
