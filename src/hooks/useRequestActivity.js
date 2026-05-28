// useRequestActivity — live activity counts for an open request.
//
// CERGIO-GUARD (2026-05-28): the SRP status ticker MUST reflect REAL
// activity, not a setInterval timer that fakes progress. The user's
// directive (literally): "make it related to REAL actions (as opposed
// to hard wired...)". So we poll the notifications + bids tables for
// rows tagged with this request, and surface the live counts.
//
// Polling cadence: 2.5s. Cheap enough on a single open SRP, far below
// any rate-limit threshold, and visually feels like real-time without
// needing Supabase realtime channels (which add cost + complexity for
// the launch). Trivial to migrate to a channel later — just swap the
// setInterval for supabase.channel().on('postgres_changes').
//
// Returns:
//   { notified, replied, latest }
//     notified — how many providers we've reached (notifications row count)
//     replied  — how many providers have come back with a bid
//     latest   — the most recent activity ts (so leaf intensity can react)
//
// When requestId is null/undefined the hook is a no-op (returns zeros).
// This lets ResultsScreen call it unconditionally even when chat state
// hasn't materialized yet.

import { useEffect, useState } from 'react';
import { supabase, supabaseReady } from '../lib/supabase';

const POLL_MS = 2500;

export function useRequestActivity(requestId) {
  const [notified, setNotified] = useState(0);
  const [replied,  setReplied]  = useState(0);
  const [latest,   setLatest]   = useState(null);

  useEffect(() => {
    if (!supabaseReady) return;
    if (!requestId)     return;
    let cancelled = false;

    const tick = async () => {
      // Probe both counters in parallel. Use head:true count so we
      // don't pay for the row payload.
      const [nRes, bRes, latestRes] = await Promise.all([
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('data->>request_id', requestId)
          .eq('kind', 'new_request'),
        supabase
          .from('bids')
          .select('id', { count: 'exact', head: true })
          .eq('request_id', requestId),
        supabase
          .from('notifications')
          .select('created_at')
          .eq('data->>request_id', requestId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      // bids table may not exist yet pre-launch — treat schema-cache
      // miss as zero so the SRP still ticks (notifications alone).
      const nc = nRes.error ? 0 : (nRes.count || 0);
      const bc = bRes.error ? 0 : (bRes.count || 0);
      setNotified(nc);
      setReplied(bc);
      setLatest(latestRes?.data?.created_at || null);
    };

    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [requestId]);

  return { notified, replied, latest };
}

// Helper: derive a human status line + leaf intensity from the counts.
// Lives here (not in ResultsScreen) so the contract is one place. The
// caller can override the words, but the intensity formula is canonical
// — bids count 3× notifications because a reply is real engagement.
export function activityToStatus({ notified, replied, plural = 'providers' }) {
  // Intensity 0..1 used by LeafLogo. notifications saturate slower than
  // bids; once 3+ bids land we're at full intensity regardless of fan-out.
  const intensity = Math.min(1, (notified + replied * 3) / 10);
  let line;
  if (replied > 0) {
    line = replied === 1
      ? '1 reply so far — comparing'
      : `${replied} replies so far — comparing`;
  } else if (notified > 0) {
    line = `Pinged ${notified} ${plural} nearby — waiting on replies`;
  } else {
    line = `Pinging ${plural} nearby`;
  }
  return { line, intensity };
}
