// Referral attribution — turns the `?ref=<inviter_id>` URL param into a
// real credit chain: friend clicks invite link → ref captured to
// localStorage → friend signs up → invites row written linking inviter
// to invitee → friend's first booking → earnings row credits inviter.
//
// CERGIO-GUARD: every invite link in the app MUST come through
// buildInviteUrl() so they all share the same `?ref=<uuid>` format.
// Free-text URLs with hand-typed refs will not attribute correctly.

import { supabase, supabaseReady } from './supabase';
import { REWARDS } from './rewards';

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
 *
 *  Side-effect: also fires `creditChainOnFirstBooking` for the 2nd-hop
 *  inviter (friend-of-friend bonus). See that function below.
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

  // CERGIO-GUARD (2026-06-05 v7): credit a REAL 7% slice of the
  // booking, capped at $250 per friend — not the lump $250-on-first-
  // booking that the previous implementation used. Tarik:
  //   "data is hardcoded — can't have $250 max reached for several
  //    rows when only one user invited."
  // That symptom came from this function writing a single $250 row
  // for every new invitee's first booking, ignoring the actual
  // booking total.
  //
  // New behaviour:
  //   1. Look up the booking total.
  //   2. Sum prior direct earnings for this (inviter, invitee) pair.
  //   3. Credit min(7% × total, $250 - prior).
  //   4. Also resolve the invitee's display name so the cap-walk
  //      logic in EarningsScreen buckets the rows correctly.
  const SHARE_PERCENT = REWARDS.referrerSharePercent; // 7
  const PER_FRIEND_CAP_CENTS = REWARDS.perFriend * 100;

  // 1. Booking total.
  let bookingTotalCents = 0;
  if (bookingId) {
    const { data: bkRow } = await supabase
      .from('bookings')
      .select('total_cents')
      .eq('id', bookingId)
      .maybeSingle();
    bookingTotalCents = bkRow?.total_cents || 0;
  }

  // 2. Prior credit toward this friend's cap (sum existing tier='direct'
  //    earnings rows for the same invitee_id).
  let priorCents = 0;
  const { data: priorRows } = await supabase
    .from('earnings')
    .select('amount_cents')
    .eq('profile_id', invite.inviter_id)
    .eq('kind', 'invite')
    .contains('meta', { invitee_id: consumerId, tier: 'direct' });
  if (Array.isArray(priorRows)) {
    priorCents = priorRows.reduce((s, r) => s + (r.amount_cents || 0), 0);
  }

  // 3. Compute this row's actual credit.
  const grossCents  = Math.round(bookingTotalCents * (SHARE_PERCENT / 100));
  const roomCents   = Math.max(0, PER_FRIEND_CAP_CENTS - priorCents);
  const creditCents = Math.min(grossCents, roomCents);

  // 4. Invitee display name (so EarningsScreen's cap-walk groups by
  //    friend name — see rowCapState in EarningsScreen.jsx).
  let inviteeName = null;
  const { data: invteePr } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', consumerId)
    .maybeSingle();
  inviteeName = invteePr?.display_name || null;

  // Stamp first_booking_at + the ACTUAL credit (not the cap).
  await supabase
    .from('invites')
    .update({ first_booking_at: new Date().toISOString(), reward_cents: creditCents })
    .eq('id', invite.id);

  // Skip the insert when there's no credit to write (booking $0 or
  // cap already reached). We still stamped first_booking_at above so
  // we don't re-fire endlessly.
  let earnErr = null;
  if (creditCents > 0) {
    const result = await supabase
      .from('earnings')
      .insert({
        profile_id:   invite.inviter_id,
        kind:         'invite',
        source_id:    invite.id,
        amount_cents: creditCents,
        status:       'pending',
        meta:         {
          booking_id:        bookingId || null,
          booking_total_cents: bookingTotalCents,
          invitee_id:        consumerId,
          tier:              'direct',
          friend:            inviteeName,
        },
      });
    earnErr = result.error;
  }
  if (earnErr) {
    // eslint-disable-next-line no-console
    console.warn('[referral] could not write earnings:', earnErr.message);
  }

  // 2nd-hop: walk the chain and credit the grandparent inviter with the
  // friend-of-friend bonus. Fire-and-forget — failure here doesn't
  // affect the direct earnings write above.
  creditChainOnFirstBooking({
    invite,
    consumerId,
    bookingId,
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[referral] chain credit failed:', e?.message || e);
  });

  return { error: earnErr };
}

/** 2-degree (friend-of-friend) credit. CERGIO-GUARD (2026-06-01): the
 *  REWARDS contract since 2026-05-28 promises a 5% chain bonus
 *  (`friendOfFriendBonus` = $12.50) to the inviter's inviter when a
 *  3rd-hop user makes their first booking — but no code path actually
 *  wrote those earnings rows. EarningsScreen.jsx had the "Chain +5%"
 *  tier badge wired but `meta.tier='fof'` rows were never produced.
 *  This function closes that gap.
 *
 *  Contract:
 *    • Cap at depth 2: the great-grandparent (3rd hop) does NOT earn.
 *    • Bonus is a FLAT $12.50, not a % of the booking — keeps the math
 *      consistent with rewards.js `friendOfFriendBonus`.
 *    • Best-effort: a missing chain (invitee at depth 1 has no inviter)
 *      is a silent no-op, not an error.
 *    • Idempotent: keyed off the booking_id + earner so re-firing
 *      doesn't double-credit. The audit verifies this.
 *
 *  Args:
 *    invite       — the direct invite row (already loaded by caller)
 *    consumerId   — the invitee (3rd-hop user) — only used for telemetry
 *    bookingId    — the booking that triggered the credit
 */
export async function creditChainOnFirstBooking({ invite, consumerId, bookingId }) {
  if (!supabaseReady) return { error: null };
  if (!invite?.inviter_id) return { error: null };

  // Look up the GRANDPARENT invite — the row where the direct inviter
  // is the invitee. If none exists, the chain stops at depth 1 and
  // there's no fof bonus to write.
  const { data: gpInvite, error: gpErr } = await supabase
    .from('invites')
    .select('id, inviter_id, joined_at')
    .eq('invitee_id', invite.inviter_id)
    .limit(1)
    .maybeSingle();
  if (gpErr || !gpInvite?.inviter_id) return { error: gpErr || null };
  if (gpInvite.inviter_id === invite.inviter_id) {
    // Self-loop guard. Should never happen if invites are well-formed.
    return { error: null };
  }

  // Idempotency: check whether we already credited this earner for
  // this booking with the fof tier. The earnings table doesn't have a
  // hard unique constraint on (profile_id, booking_id, tier), so the
  // client enforces it.
  const { data: dupes } = await supabase
    .from('earnings')
    .select('id')
    .eq('profile_id', gpInvite.inviter_id)
    .eq('kind', 'invite')
    .contains('meta', { booking_id: bookingId, tier: 'fof' })
    .limit(1);
  if (Array.isArray(dupes) && dupes.length > 0) {
    // Already credited — silent no-op.
    return { error: null };
  }

  // CERGIO-GUARD (2026-06-05): pull from REWARDS so the chain bonus
  // tracks canonical (was a hardcoded 1250 with "must match" comment).
  const FOF_BONUS_CENTS = Math.round(REWARDS.friendOfFriendBonus * 100);

  const { error: earnErr } = await supabase
    .from('earnings')
    .insert({
      profile_id:   gpInvite.inviter_id,
      kind:         'invite',
      source_id:    gpInvite.id,
      amount_cents: FOF_BONUS_CENTS,
      status:       'pending',
      meta:         {
        booking_id:           bookingId || null,
        invitee_id:           consumerId,
        // The DIRECT inviter (depth-1) of this booking's consumer.
        // Useful for the Earnings UI to render "via {direct_inviter}".
        via_inviter_id:       invite.inviter_id,
        tier:                 'fof',
      },
    });
  if (earnErr) {
    // eslint-disable-next-line no-console
    console.warn('[referral] could not write fof earnings:', earnErr.message);
  }
  return { error: earnErr };
}
