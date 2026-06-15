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
export function formatKeyCounts(c, { recoKind = 'received' } = {}) {
  if (!c) return null;
  const recos = recoKind === 'made' ? c.recosMade : c.recosReceived;
  const parts = [];
  parts.push(c.mutualCount > 0 ? `${c.mutualCount} mutual` : 'No mutuals');
  if (c.networkCount > 0) parts.push(`${c.networkCount} network`);
  if (recos > 0)          parts.push(`${recos} reco${recos === 1 ? '' : 's'}`);
  if (c.igFollowers > 0)  parts.push(`${fmtK(c.igFollowers)} IG`);
  if (c.ttFollowers > 0)  parts.push(`${fmtK(c.ttFollowers)} TikTok`);
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
