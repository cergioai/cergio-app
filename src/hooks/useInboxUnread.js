// CERGIO-GUARD (2026-06-12): unread Inbox dot.
//
// Tarik: "need the DOT over inbox (to show i'm getting a notification)".
// Mirrors useActivityUnread exactly — localStorage stamp + poll.
//
//   • `localStorage['cergio:lastInboxSeenAt']` is stamped every time
//     JobsInboxScreen mounts (and while the user sits on /inbox).
//   • The hook polls three sources and flags unread when anything is
//     newer than the stamp:
//       1. open consumer requests near this provider (listInboundRequests)
//       2. pending bookings on the provider's services (listProviderBookings)
//       3. provider responses to requests the USER posted
//          (listMyRequestsWithResponses) — the "info accepted your
//          request" confirm the requester was never seeing.
//   • Auto-suppresses while the user is on /inbox.
//   • Never flags unread on fetch failure.
//
// BottomNav consumes the boolean to render the red dot on the Inbox icon.

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  listInboundRequests,
  listProviderBookings,
  listMyRequestsWithResponses,
  recoTimesOnMyServices,
  listMyInboundSpotlightRequests,
  listMyOutboundSpotlightRequests,
} from '../lib/api';

const LS_KEY = 'cergio:lastInboxSeenAt';
const POLL_MS = 60_000;

export function stampInboxSeen() {
  try { localStorage.setItem(LS_KEY, new Date().toISOString()); } catch { /* private mode */ }
}

export function getLastInboxSeen() {
  try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
}

export function useInboxUnread({ enabled = true } = {}) {
  const location = useLocation();
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    if (!enabled) { setUnread(false); return; }
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      // Suppress while the user is on the Inbox tab itself.
      if (location.pathname.startsWith('/inbox')) {
        if (!cancelled) setUnread(false);
        stampInboxSeen();
        return;
      }
      const lastSeenIso = getLastInboxSeen();
      const lastSeenMs  = lastSeenIso ? Date.parse(lastSeenIso) : 0;
      const isFresh = (iso) => {
        const ms = Date.parse(iso || 0);
        return Number.isFinite(ms) && ms > lastSeenMs;
      };
      try {
        const [inb, bookings, mine, recos, spotIn, spotOut] = await Promise.all([
          listInboundRequests({ limit: 10 }),
          listProviderBookings(),
          listMyRequestsWithResponses({ limit: 10 }),
          recoTimesOnMyServices({ limit: 20 }),
          listMyInboundSpotlightRequests({ limit: 20 }),
          listMyOutboundSpotlightRequests({ limit: 20 }),
        ]);
        const freshInbound = (inb?.data || []).some(r => isFresh(r.created_at));
        const freshBooking = (bookings?.data || []).some(
          b => b.status === 'pending' && isFresh(b.created_at),
        );
        const freshResponse = (mine?.data || []).some(
          r => (r.responses || []).some(resp => isFresh(resp.responded_at)),
        );
        // CERGIO-GUARD (2026-06-12): barter-loop events light the dot
        // too — a Connector just posted their IG spotlight (provider
        // must review) on my provider bookings.
        const freshBarter = (bookings?.data || []).some(
          b => b.is_free_for_rainmaker && !b.post_confirmed_at && isFresh(b.posted_at),
        );
        // CERGIO-GUARD (2026-06-18, Tarik): a fresh recommendation RECEIVED on
        // one of my services (a 4★+ rate writes one) lights the dot too — "T
        // rated but info didn't get a notification".
        const freshReco = (recos?.data || []).some(r => isFresh(r.sent_at));
        // CERGIO-GUARD (2026-06-18, Tarik): the dot also covers SPOTLIGHT
        // requests — a new inbound spotlight ask, or the other party responding
        // so it's now my turn. Inbound: a new request (created) or the provider
        // just countered (my turn as Connector). Outbound: the Connector
        // accepted, or countered back (my turn as provider).
        const freshSpotIn = (spotIn?.data || []).some(r =>
          isFresh(r.created_at) ||
          (r.status === 'countered' && r.last_counter_by === 'provider' && isFresh(r.responded_at)));
        const freshSpotOut = (spotOut?.data || []).some(r =>
          (r.status === 'accepted' && isFresh(r.responded_at)) ||
          (r.status === 'countered' && r.last_counter_by === 'connector' && isFresh(r.responded_at)));
        if (!cancelled) setUnread(
          freshInbound || freshBooking || freshResponse || freshBarter || freshReco || freshSpotIn || freshSpotOut,
        );
      } catch {
        // Network/RLS hiccups — never flag unread on failure.
        if (!cancelled) setUnread(false);
      }
    };

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, location.pathname]);

  return unread;
}
