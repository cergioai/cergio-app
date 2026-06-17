// CERGIO-GUARD (2026-06-12): short invite-link landing.
//
// Tarik: "need a much shorter invite link which takes directly to the
// profile of the connector (or the service).. this took to the login
// page https://cergio.ai/?ref=<uuid>"
//
// Route: /i/:code where code = first 10 hex chars of the inviter's
// profile UUID (built by buildInviteUrl in lib/referral.js).
//
// Flow:
//   1. resolve_ref_code RPC (db/migrations/2026-06-12) expands the
//      code to the full profile. LIMIT 2 → exactly 1 row = resolved;
//      0 or 2 rows = unknown/ambiguous.
//   2. storeRef() persists the inviter UUID so referral attribution
//      works exactly like the old ?ref= links (30-day TTL).
//   3. Redirect to /u/<id> — the inviter's PUBLIC PROFILE (their
//      services, headline, Connector badge), not the login page.
//      Unresolvable codes fall back to '/' so the visitor still
//      lands on Cergio.

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, supabaseReady } from '../lib/supabase';
import { storeRef } from '../lib/referral';
import { LeafLogo } from '../components/ui/LeafLogo';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function InviteLandingScreen() {
  const { code } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const clean = String(code || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
      if (!supabaseReady || clean.length < 6) {
        navigate('/', { replace: true });
        return;
      }
      // Per-spotlight click-audit (Tarik 2026-06-15): ?s={bookingId} on the
      // Connector's unique link → stamp that spotlight "verified live" (the
      // link is in the post and working). Best-effort; never blocks the redirect.
      const s = new URLSearchParams(window.location.search).get('s');
      if (s && UUID_RE.test(s)) {
        // supabase.rpc() returns a thenable QUERY BUILDER, not a real Promise —
        // it has NO .catch(). Calling .catch() threw synchronously and aborted
        // this whole effect, so the profile redirect below never ran and every
        // invite/spotlight link hung on "Opening profile…". Adopt it into a
        // real promise so the fire-and-forget audit can't break the redirect.
        // (Tarik 2026-06-16.) record_spotlight_click both increments the
        // per-post click count (shown to the Connector + the service on
        // Earnings) AND stamps verified-live.
        Promise.resolve(supabase.rpc('record_spotlight_click', { p_booking: s })).catch(() => {});
      }
      const { data, error } = await supabase.rpc('resolve_ref_code', { code: clean });
      if (cancelled) return;
      const rows = data || [];
      if (!error && rows.length === 1 && rows[0]?.id) {
        storeRef(rows[0].id);
        navigate(`/u/${rows[0].id}`, { replace: true });
      } else {
        // Unknown or ambiguous code — still land them on Cergio.
        navigate('/', { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigate]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-cream px-5">
      <LeafLogo />
      <p className="text-body text-b3 font-medium mt-4">Opening profile…</p>
    </div>
  );
}
