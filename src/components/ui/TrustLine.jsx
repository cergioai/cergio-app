// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "01 — IDENTITY").
// TrustLine: the counts strings under a person — bold number, quiet label,
// mutuals green and ALWAYS NAMED.
//
// This FOLDS the existing shared reputational primitives (SPEC-49g,
// reputation.jsx) rather than competing with them — per the handoff brief
// ("fold the existing ProfileSignalBlock.jsx and reputation.jsx wording into
// TrustLine"). The counts row IS TrustStream (same bold-number/quiet-label
// treatment everywhere); the mutuals line IS mutualNamesText (the wording
// ProfileSignalBlock already ships). No re-styled copies (SPEC-48b DRY rule).
//
//   <TrustLine counts={counts} mutualNames={names} recoKind="made" />
//
// counts: one entry from getInboxPartyCounts (networkCount, recosMade,
// recosReceived, mutualCount, …). mutualNames: display names of the shared
// friends, for the named green line. Every number is real or its element
// collapses (SPEC-12: no fake data).

import { TrustStream, mutualNamesText } from './reputation';

export function TrustLine({ counts, recoKind = 'made', mutualNames, named = true, className = '' }) {
  if (!counts) return null;
  const mutualCount = Number(counts.mutualCount) || 0;

  // Counts row via the SHARED stream; the mutual stat is stripped because it
  // gets its own NAMED green line below (same split ProfileSignalBlock uses).
  const stream = <TrustStream counts={{ ...counts, mutualCount: 0 }} recoKind={recoKind} />;

  const mutualLine = mutualCount > 0 ? (
    <p className="text-body-sm font-semibold leading-snug text-gd">
      {(named && mutualNamesText(mutualNames, mutualCount))
        || `${mutualCount} mutual ${mutualCount === 1 ? 'friend' : 'friends'} in common`}
    </p>
  ) : null;

  if (!stream && !mutualLine) return null;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {stream}
      {mutualLine}
    </div>
  );
}
