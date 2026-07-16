// Referral attribution — turns the `?ref=<inviter_id>` URL param into a
// real credit chain: friend clicks invite link → ref captured to
// localStorage → friend signs up → invites row written linking inviter
// to invitee → friend's first booking → earnings row credits inviter.
//
// CERGIO-GUARD: every invite link in the app MUST come through
// buildInviteUrl() so they all share the same `?ref=<uuid>` format.
// Free-text URLs with hand-typed refs will not attribute correctly.

import { supabase, supabaseReady } from './supabase';
import { notifyUser } from './api';

const REF_STORAGE_KEY = 'cergio.ref';
const REF_TTL_DAYS    = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── URL helpers ────────────────────────────────────────────────────────────

/** Build a referral URL for a given inviter UUID. Use origin so dev + prod
 *  produce the right link automatically.
 *
 *  CERGIO-GUARD (2026-06-12): short format per Tarik — "need a much
 *  shorter invite link which takes directly to the profile of the
 *  connector (or the service)". `/i/<first-10-hex-of-uuid>` resolves
 *  via the resolve_ref_code RPC (db/migrations/2026-06-12) and lands
 *  on /u/<id> — the inviter's public profile — NOT the login page.
 *  Old `?ref=<uuid>` links keep working through captureRefFromUrl. */
export function buildInviteUrl(inviterId) {
  if (typeof window === 'undefined') return 'https://cergio.ai';
  const base = window.location.origin;
  if (!inviterId || !UUID_RE.test(String(inviterId))) {
    // Fallback to a non-attributable link so the share still works even
    // if the inviter isn't signed in yet. They lose the credit but the
    // invitee can still find Cergio.
    return `${base}/`;
  }
  const code = String(inviterId).replace(/-/g, '').slice(0, 10);
  return `${base}/i/${code}`;
}

/** Connector-invite link (SPEC: Connectors invite Connectors, 2026-06-26).
 *  Same short link with `?c=1` — when a VERIFIED Connector shares THIS link,
 *  the invitee is auto-granted Connector status on signup (server-guarded:
 *  the grant RPC verifies the inviter is actually a Connector). A normal
 *  invite link never grants Connector. Only surface this on the connector hub. */
export function buildConnectorInviteUrl(inviterId) {
  const base = buildInviteUrl(inviterId);
  if (!base.includes('/i/')) return base; // non-attributable fallback
  return `${base}${base.includes('?') ? '&' : '?'}c=1`;
}

/** The ONE canonical invite message (Tarik 2026-07-16 — "make it captivating,
 *  add the AI touch"). Every Share/Copy invite entry point MUST use this so the
 *  copy stays consistent everywhere. Leads with the AI recommendation hook, ends
 *  with the attributable link (never a bare URL). Credit goes to the INVITER
 *  only — the copy never promises the invitee a credit. */
export function buildInviteMessage(url) {
  return `Hey — I found Cergio.Ai: friend recommendations, powered by AI, for booking services you actually trust. Join me 👇 ${url}`;
}

/** Persist a known inviter UUID directly (used by the /i/:code short-link
 *  landing after the RPC expands the code). Same storage + TTL contract
 *  as captureRefFromUrl. */
export function storeRef(inviterId, { connector = false } = {}) {
  if (typeof window === 'undefined') return null;
  if (!inviterId || !UUID_RE.test(String(inviterId))) return null;
  try {
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ inviter: inviterId, capturedAt: Date.now(), connector: !!connector }));
  } catch { /* private mode — ignore */ }
  return inviterId;
}

/** True when the stored ref came from a Connector-invite link (`?c=1`). */
export function isConnectorInvite() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return false;
    return !!JSON.parse(raw).connector;
  } catch { return false; }
}

// ─── Capture (runs on app boot) ─────────────────────────────────────────────

/** Read ?ref=<uuid> from window.location and persist it with a TTL.
 *  Idempotent: calling this multiple times with the same ref is fine;
 *  a new ref overwrites a stale one. */
export function captureRefFromUrl() {
  if (typeof window === 'undefined') return null;
  try {
    const u = new URL(window.location.href);
    const ref = u.searchParams.get('ref');
    if (!ref) return null;
    if (!UUID_RE.test(ref)) {
      // eslint-disable-next-line no-console
      console.warn('[referral] ignoring non-UUID ref:', ref);
      return null;
    }
    const connector = u.searchParams.get('c') === '1';
    const payload = { inviter: ref, capturedAt: Date.now(), connector };
    try {
      localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* private mode — ignore */ }
    return ref;
  } catch {
    return null;
  }
}

// ─── Read / clear ───────────────────────────────────────────────────────────

/** Return the inviter UUID stored in localStorage, or null if missing /
 *  expired / corrupted. */
export function getActiveRef() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REF_STORAGE_KEY);
    if (!raw) return null;
    const { inviter, capturedAt } = JSON.parse(raw);
    if (!inviter || !UUID_RE.test(inviter)) return null;
    const ageMs = Date.now() - (capturedAt || 0);
    if (ageMs > REF_TTL_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(REF_STORAGE_KEY);
      return null;
    }
    return inviter;
  } catch {
    return null;
  }
}

export function clearActiveRef() {
  try { localStorage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
}

// ─── Server-side writes ─────────────────────────────────────────────────────

/** Called from useSession.signUp() after Supabase creates the auth user
 *  AND the profile trigger has fired. Writes an invites row linking the
 *  inviter (from localStorage) to the new invitee. Best-effort — the
 *  signup completes either way; a failed write here just means the
 *  invitee won't earn from this invite chain.
 *
 *  Self-invites (inviter === invitee) are silently dropped.
 *
 *  Returns { error } only; no useful success payload.
 */
export async function recordInviteFromActiveRef(inviteeUserId) {
  if (!supabaseReady) return { error: null };
  const inviter = getActiveRef();
  const connectorInvite = isConnectorInvite();
  if (!inviter) return { error: null };
  if (!inviteeUserId)       return { error: null };
  if (inviter === inviteeUserId) {
    // Self-invite: nothing to do, just drop the ref.
    clearActiveRef();
    return { error: null };
  }
  const { error } = await supabase
    .from('invites')
    .insert({
      inviter_id: inviter,
      invitee_id: inviteeUserId,
      joined_at:  new Date().toISOString(),
    });
  // Clear the ref so we don't double-write if the user signs up again
  // in the same session (e.g. after delete + retry).
  clearActiveRef();
  // Don't surface errors — RLS or duplicate-key just means the invite
  // chain is broken in a benign way.
  // eslint-disable-next-line no-console
  if (error) console.warn('[referral] could not record invite:', error.message);
  // CERGIO-GUARD (2026-06-18, Tarik — invite tracking is the spine): tell the
  // inviter their friend just joined. The notify-user edge fn has the
  // `invite_joined` template; it was never fired. Best-effort.
  if (!error) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai';
    try {
      notifyUser({
        event: 'invite_joined',
        recipient: inviter,
        data: { invitee_id: inviteeUserId, deep_link: `${origin}/earnings/invites` },
      });
    } catch { /* best-effort */ }
  }
  // Connectors invite Connectors (2026-06-26): when the ref came from a
  // Connector-invite link, auto-grant the new user Connector status. The RPC is
  // SECURITY DEFINER + GUARDED — it only grants if the inviter is actually a
  // verified Connector, so a forged ?c=1 from a non-connector does nothing.
  if (connectorInvite) {
    try { await supabase.rpc('grant_connector_from_invite', { p_inviter: inviter }); }
    catch (e) { /* best-effort */ /* eslint-disable-next-line no-console */ console.warn('[referral] connector grant failed:', e?.message || e); }
  }
  return { error };
}

/** Optional: when the invitee makes their first booking, write the
 *  earnings row to the inviter. This is the credit-on-first-booking
 *  path. Best-effort + idempotent (matches on first_booking_at NULL).
 *
 *  CERGIO-GUARD: a Postgres trigger would be more reliable for this,
 *  but writing the migration is gated on the user applying it. The
 *  client-side path is the safety net until the trigger ships.
 *
 *  Side-effect: also fires `creditChainOnFirstBooking` for the 2nd-hop
 *  inviter (friend-of-friend bonus). See that function below.
 */
export async function creditInviterOnFirstBooking(consumerId, bookingId) {
  // SERVER-AUTHORITATIVE settlement (Tarik 2026-06-26): the canonical credit
  // math now lives in the `credit_referral_for_booking` Postgres RPC, called
  // from the Stripe webhook (the reliable path) AND here as a safe redundant
  // trigger. The RPC is idempotent (one row per earner/booking/tier) and guards
  // on the booking being PAID, so this client call can never double-credit or
  // credit an unpaid booking. Economics: 1st tier 7%/booking cap $250 per
  // friend; 2nd tier 0.5%/booking cap $12.50 per friend-of-friend; both
  // ACCUMULATING across bookings; status 'cleared' (counts as earned, not stuck
  // pending). This replaces the old best-effort client-side math (which could
  // silently drop credit and was one-shot, never reaching the cap).
  if (!supabaseReady || !bookingId) return { error: null };
  const { error } = await supabase.rpc('credit_referral_for_booking', { p_booking: bookingId });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[referral] credit_referral_for_booking failed:', error.message);
  }
  return { error: error || null };
}

/** DEPRECATED (2026-06-26): the 2nd-tier (friend-of-friend) credit is now part
 *  of the server-authoritative `credit_referral_for_booking` RPC (0.5%/booking,
 *  cap $12.50, accumulating). Kept as a no-op shim for any stale importer.
 *  Do not call — `creditInviterOnFirstBooking` (→ the RPC) handles both tiers. */
export async function creditChainOnFirstBooking() {
  return { error: null };
}
