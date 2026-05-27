// Referral attribution — turns the `?ref=<inviter_id>` URL param into a
// real credit chain: friend clicks invite link → ref captured to
// localStorage → friend signs up → invites row written linking inviter
// to invitee → friend's first booking → earnings row credits inviter.
//
// CERGIO-GUARD: every invite link in the app MUST come through
// buildInviteUrl() so they all share the same `?ref=<uuid>` format.
// Free-text URLs with hand-typed refs will not attribute correctly.

import { supabase, supabaseReady } from './supabase';

const REF_STORAGE_KEY = 'cergio.ref';
const REF_TTL_DAYS    = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── URL helpers ────────────────────────────────────────────────────────────

/** Build a referral URL for a given inviter UUID. Use origin so dev + prod
 *  produce the right link automatically. */
export function buildInviteUrl(inviterId) {
  if (typeof window === 'undefined') return 'https://cergio.ai';
  const base = window.location.origin;
  if (!inviterId || !UUID_RE.test(String(inviterId))) {
    // Fallback to a non-attributable link so the share still works even
    // if the inviter isn't signed in yet. They lose the credit but the
    // invitee can still find Cergio.
    return `${base}/`;
  }
  return `${base}/?ref=${inviterId}`;
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
    const payload = { inviter: ref, capturedAt: Date.now() };
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
  return { error };
}

/** Optional: when the invitee makes their first booking, write the
 *  earnings row to the inviter. This is the credit-on-first-booking
 *  path. Best-effort + idempotent (matches on first_booking_at NULL).
 *
 *  CERGIO-GUARD: a Postgres trigger would be more reliable for this,
 *  but writing the migration is gated on the user applying it. The
 *  client-side path is the safety net until the trigger ships.
 */
export async function creditInviterOnFirstBooking(consumerId, bookingId) {
  if (!supabaseReady) return { error: null };
  if (!consumerId)    return { error: null };

  // Find a pending invite where this consumer is the invitee + no
  // first_booking_at recorded yet.
  const { data: invite, error: findErr } = await supabase
    .from('invites')
    .select('id, inviter_id, first_booking_at, reward_cents')
    .eq('invitee_id', consumerId)
    .is('first_booking_at', null)
    .limit(1)
    .maybeSingle();
  if (findErr || !invite) return { error: findErr };

  // Stamp first_booking_at + record reward amount on the invite row.
  const REWARD_CENTS = 25000; // $250 — must match REWARDS.perFriend
  await supabase
    .from('invites')
    .update({ first_booking_at: new Date().toISOString(), reward_cents: REWARD_CENTS })
    .eq('id', invite.id);

  // Write the earnings row crediting the inviter.
  const { error: earnErr } = await supabase
    .from('earnings')
    .insert({
      profile_id:   invite.inviter_id,
      kind:         'invite',
      source_id:    invite.id,
      amount_cents: REWARD_CENTS,
      status:       'pending',
      meta:         { booking_id: bookingId || null, invitee_id: consumerId },
    });
  if (earnErr) {
    // eslint-disable-next-line no-console
    console.warn('[referral] could not write earnings:', earnErr.message);
  }
  return { error: earnErr };
}
