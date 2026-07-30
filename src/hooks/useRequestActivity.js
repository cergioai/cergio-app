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
      // SPEC-121 — MEASURED 2026-07-30, twice, on live requests:
      //   HEAD /notifications?...data->>request_id=eq.<id>&kind=eq.new_request -> 503
      //   GET  /notifications?...data->>request_id=eq.<id>&limit=1             -> 200
      // The `count: 'exact', head: true` count on a JSON-expression filter times
      // out, so this hook NEVER returned a notification count and the provider dot
      // never appeared — even when the request and the notification both existed.
      // An index alone did not fix it. Select the rows instead of counting them:
      // the SRP only needs "any / how many, capped", never an exact total.
      //
      // `bids` 404s pre-launch (table absent). Kept per SPEC-56's frozen contract,
      // but as a bounded select — its error is tolerated, as before.
      const [nRes, bRes, latestRes] = await Promise.all([
        supabase
          .from('notifications')
          .select('id')
          .eq('data->>request_id', requestId)
          .eq('kind', 'new_request')
          .limit(50),
        supabase
          .from('bids')
          .select('id')
          .eq('request_id', requestId)
          .limit(50),
        supabase
          .from('notifications')
          .select('created_at')
          .eq('data->>request_id', requestId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const nc = nRes.error ? 0 : (nRes.data?.length || 0);
      const bc = bRes.error ? 0 : (bRes.data?.length || 0);
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
