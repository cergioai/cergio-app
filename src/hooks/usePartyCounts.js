// Shared inbox "key counts" loader. Given the profile ids of the other party
// on each inbox card, lazily fetches mutual friends · network on Cergio ·
// reco's · IG/TikTok reach and returns a map keyed by id. Used by both the
// spotlight inbox (ConnectorRequestsScreen) and the free-service inbox
// (JobsInboxScreen) so a request can be judged at a glance. Tarik 2026-06-15.
import { useEffect, useState } from 'react';
import { getInboxPartyCounts } from '../lib/api';

function fmtK(n) {
  const x = +n || 0;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (x >= 1_000)     return `${(x / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(x);
}

// Compact one-line summary. Mutual connections ALWAYS render (even 0 →
// "No mutuals") per Tarik; the rest appear only when present. `recoKind`
// chooses reco's made (free-service requester) vs received (spotlight provider).
// `includeReco=false` suppresses the auto reco's-made/received chip — used by
// the unified profile (ProfileSignalBlock), which renders an always-on
// "N recos received/made" label in the facet heading and doesn't want it
// duplicated in the sub-line. Defaults to true so every existing caller (inbox
// cards, booking detail) is byte-for-byte unchanged.
export function formatKeyCounts(c, { recoKind = 'received', includeMutual = true, includeReco = true, includeReach = true, includeNetwork = true } = {}) {
  if (!c) return null;
  const parts = [];
  // includeMutual=false on screens that already render a dedicated
  // friends-in-common block (e.g. the booking detail), to avoid duplication.
  const pushMutual = () => { if (includeMutual) parts.push(c.mutualCount > 0 ? `${c.mutualCount} mutual` : 'No mutuals'); };
  // includeReach=false drops IG/TikTok reach from the line. The unified
  // profile's SERVICE facet uses this (SPEC-49, Tarik 2026-06-17): IG reach
  // belongs around the CONNECTOR badge, not on a service like a plumber, and
  // it was rendering on both facets (duplicated). Defaults true so every
  // existing caller (inbox cards, booking detail, connector facet) is unchanged.
  if (recoKind === 'made') {
    // Reach-led — a Connector requesting a FREE service is judged on reach
    // first (Tarik 2026-06-15): IG followers, then network, then reco's made.
    if (includeReach && c.igFollowers > 0)  parts.push(`${fmtK(c.igFollowers)} IG`);
    if (includeReach && c.ttFollowers > 0)  parts.push(`${fmtK(c.ttFollowers)} TikTok`);
    if (includeNetwork && c.networkCount > 0) parts.push(`${c.networkCount} network`);
    if (includeReco && c.recosMade > 0) parts.push(`${c.recosMade} reco${c.recosMade === 1 ? '' : 's'} made`);
    pushMutual();
  } else {
    // Service-led — a Connector judging a provider's spotlight: reputation first.
    pushMutual();
    if (includeNetwork && c.networkCount > 0)  parts.push(`${c.networkCount} network`);
    if (includeReco && c.recosReceived > 0) parts.push(`${c.recosReceived} reco${c.recosReceived === 1 ? '' : 's'}`);
    if (includeReach && c.igFollowers > 0)   parts.push(`${fmtK(c.igFollowers)} IG`);
    if (includeReach && c.ttFollowers > 0)   parts.push(`${fmtK(c.ttFollowers)} TikTok`);
  }
  return parts.join(' · ');
}

export function usePartyCounts(ids) {
  const [counts, setCounts] = useState({});
  const idsKey = [...new Set((ids || []).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!idsKey) { setCounts({}); return; }
    let cancelled = false;
    getInboxPartyCounts(idsKey.split(',')).then(({ data }) => {
      if (!cancelled) setCounts(data || {});
    });
    return () => { cancelled = true; };
  }, [idsKey]);
  return counts;
}
