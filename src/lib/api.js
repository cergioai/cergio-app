// Thin data-layer around Supabase. Screens import from here instead of
// touching `supabase` directly. Each function returns { data, error } so
// callers can branch on either.
import { supabase, supabaseReady } from './supabase';

const NOT_WIRED = { data: null, error: { message: 'Supabase not configured' } };

// ─── Services ────────────────────────────────────────────────────────────────

// Build a default service title from category + location.
function makeTitle(category, location) {
  const cat  = (category || 'Service').trim();
  const loc  = (location  || '').trim();
  return loc ? `${cat} in ${loc}` : cat;
}

// Parse a price string ("$50", "50", "$50 per hour") into integer cents.
function priceToCents(price) {
  if (price == null) return 0;
  const digits = String(price).replace(/[^0-9.]/g, '');
  const n = parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Create a service + its offerings + flip the owner's is_provider flag.
 *
 * draft: {
 *   category, location, description, photoClass,
 *   offerings: [{ name, kind: 'hourly'|'session', price, durationMinutes? }]
 * }
 */
export async function createService(draft) {
  if (!supabaseReady) return NOT_WIRED;

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to list a service.' } };
  }
  const ownerId = userRes.user.id;

  // 1. Insert service
  const { data: svc, error: svcErr } = await supabase
    .from('services')
    .insert({
      owner_id:     ownerId,
      title:        makeTitle(draft.category, draft.location),
      category:     draft.category || null,
      description:  draft.description || null,
      location_text: draft.location || null,
      lat:          draft.lat ?? null,
      lng:          draft.lng ?? null,
      photo_class:  draft.photoClass || 'fv-jamie',
      status:       'listed',
    })
    .select()
    .single();

  if (svcErr) return { data: null, error: svcErr };

  // 2. Insert offerings (if any)
  if (Array.isArray(draft.offerings) && draft.offerings.length > 0) {
    const rows = draft.offerings.map(o => ({
      service_id:        svc.id,
      name:              o.name || (o.kind === 'hourly' ? 'Hourly rate' : 'Session'),
      description:       o.description || null,
      kind:              o.kind,
      price_cents:       priceToCents(o.price),
      duration_minutes:  o.kind === 'session' ? (parseInt(o.durationMinutes, 10) || null) : null,
      currency:          'USD',
      is_default:        true,
    }));
    const { error: offErr } = await supabase.from('offerings').insert(rows);
    if (offErr) return { data: svc, error: offErr };
  }

  // 3. Flip is_provider so this user can be matched as a provider
  await supabase
    .from('profiles')
    .update({ is_provider: true })
    .eq('id', ownerId);

  return { data: svc, error: null };
}

/** Fetch all services owned by the currently signed-in user. */
export async function listMyServices() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };

  return await supabase
    .from('services')
    .select('id, title, category, description, location_text, photo_class, status, rating_avg, rating_count, bookings_count, created_at')
    .eq('owner_id', userRes.user.id)
    .order('created_at', { ascending: false });
}

/**
 * Search listed services, optionally filtered by category.
 * When lat/lng provided, uses the `services_near` PostGIS RPC and returns
 * rows ordered by distance. Otherwise falls back to a plain recency-ordered
 * query.
 *
 *   { category?: string,
 *     lat?: number, lng?: number, radiusMiles?: number,
 *     limit?: number }
 */
export async function listServices({
  category = null,
  lat = null, lng = null, radiusMiles = 25,
  limit = 50,
} = {}) {
  if (!supabaseReady) return NOT_WIRED;

  // Proximity branch — uses the RPC + then back-fills offerings in one extra query.
  if (lat != null && lng != null) {
    const { data, error } = await supabase.rpc('services_near', {
      near_lat: lat, near_lng: lng,
      radius_miles: radiusMiles,
      category_match: category || null,
    });
    if (error) return { data: null, error };

    const ids = (data || []).map(s => s.id);
    if (ids.length === 0) return { data: [], error: null };

    // Pull offerings in one shot, then attach.
    const { data: offs } = await supabase
      .from('offerings')
      .select('id, service_id, name, kind, price_cents, duration_minutes, is_default')
      .in('service_id', ids);
    const offMap = {};
    (offs || []).forEach(o => { (offMap[o.service_id] ||= []).push(o); });

    return {
      data: data.map(s => ({ ...s, offerings: offMap[s.id] || [] })),
      error: null,
    };
  }

  // Plain branch.
  let q = supabase
    .from('services')
    .select(`
      id, title, category, description, location_text, photo_class,
      rating_avg, rating_count, bookings_count, owner_id, created_at,
      offerings ( id, name, kind, price_cents, duration_minutes, is_default )
    `)
    .eq('status', 'listed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category) q = q.ilike('category', `%${category}%`);
  return await q;
}

// ─── Saved addresses (Google-validated, labeled, with a default) ────────────

/** Pull every saved address for the signed-in user, default first. */
export async function listMyAddresses() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  return await supabase
    .from('user_addresses')
    .select('*')
    .eq('profile_id', userRes.user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
}

/** Fetch the user's single default address (or null). */
export async function getDefaultAddress() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  const { data, error } = await supabase
    .from('user_addresses')
    .select('*')
    .eq('profile_id', userRes.user.id)
    .eq('is_default', true)
    .maybeSingle();
  return { data, error };
}

/**
 * Save a Google-validated address. If `makeDefault` is true (or this is the
 * user's first saved address), it's also set as the default.
 */
export async function saveAddress({ label, formattedAddress, lat, lng, placeId, makeDefault = false } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to save an address.' } };
  }
  const uid = userRes.user.id;

  // Dedup on place_id — if user already has this exact place saved, return
  // the existing row instead of duplicating.
  if (placeId) {
    const { data: existing } = await supabase
      .from('user_addresses')
      .select('*')
      .eq('profile_id', uid)
      .eq('place_id',   placeId)
      .maybeSingle();
    if (existing) {
      if (makeDefault) await supabase.rpc('set_default_address', { target_id: existing.id });
      return { data: existing, error: null };
    }
  }

  // Decide whether this should be default. Auto-default if it's their first.
  let shouldBeDefault = !!makeDefault;
  if (!shouldBeDefault) {
    const { count } = await supabase
      .from('user_addresses')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', uid);
    if ((count ?? 0) === 0) shouldBeDefault = true;
  }

  const { data, error } = await supabase
    .from('user_addresses')
    .insert({
      profile_id:         uid,
      label:              (label || 'Home').slice(0, 60),
      formatted_address:  formattedAddress,
      lat: lat ?? null,
      lng: lng ?? null,
      place_id:           placeId ?? null,
      is_default:         false, // flip via RPC below to keep "only one default" invariant
    })
    .select()
    .single();

  if (error) return { data: null, error };

  if (shouldBeDefault) {
    await supabase.rpc('set_default_address', { target_id: data.id });
    data.is_default = true;
  }
  return { data, error: null };
}

/** Flip the given row to default; clears default on every other row. */
export async function setDefaultAddress(addressId) {
  if (!supabaseReady) return NOT_WIRED;
  const { error } = await supabase.rpc('set_default_address', { target_id: addressId });
  return { data: !error, error };
}

/** Delete a saved address. */
export async function deleteAddress(addressId) {
  if (!supabaseReady) return NOT_WIRED;
  return await supabase.from('user_addresses').delete().eq('id', addressId);
}

// ─── Chat parsing (Claude Haiku 4.5 via edge function) ──────────────────────

/**
 * Send the user's latest message + current chat state to the chat-parse
 * edge function. Claude turns the free-text into a structured intent and
 * decides the next step. Returns:
 *   {
 *     parsed: { what, when, where, budget, details },
 *     fits: boolean,
 *     is_flexible_time: boolean | null,
 *     next_step: "what" | "when" | "flexible_check" | "budget" | "where" | "details" | "done",
 *     bot_reply: string,
 *     quick_replies: string[],
 *     switch_to_form: boolean,
 *   }
 *
 * Frontend should fall back to a local heuristic if this errors (e.g.
 * Anthropic outage) so the chat keeps working.
 */
export async function chatParse({
  user_message,
  state = {},
  attempts = {},
  is_repeat_user = false,
  default_address = null,
} = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase.functions.invoke('chat-parse', {
    body: { user_message, state, attempts, is_repeat_user, default_address },
  });
  if (error)        return { data: null, error };
  if (data?.error)  return { data: null, error: { message: data.error, raw: data.raw } };
  // _resolver telemetry is debug-only; log to console so we can see which
  // queries hit the local engine vs Claude.
  if (data?._resolver && typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.debug('[chat-parse]', data._resolver);
  }
  return { data, error: null };
}

// ─── Stripe payments ─────────────────────────────────────────────────────────

/**
 * Create a Stripe PaymentIntent for a pending booking. Returns the client_secret
 * the frontend feeds into Stripe's PaymentElement. The edge function records
 * a payments row (status='requires_payment_method' initially) keyed by
 * stripe_intent_id, which the webhook later updates.
 *
 * Caller must be signed in AND must be the consumer on the booking.
 * Returns { data: null, error } for free bookings — frontend should
 * short-circuit those before calling.
 */
export async function createPaymentIntent(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase.functions.invoke('create-payment-intent', {
    body: { bookingId },
  });
  if (error) return { data: null, error };
  if (data?.error) return { data: null, error: { message: data.error } };
  return { data, error: null };
}

// ─── Stripe Connect ──────────────────────────────────────────────────────────

/**
 * Kick off Stripe Connect onboarding for the signed-in provider.
 * Returns { url } where url is the hosted onboarding link to open in a tab.
 */
export async function getStripeOnboardingUrl() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to set up payouts.' } };
  }
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { return_url: `${window.location.origin}/profile?stripe=done` },
  });
  if (error) return { data: null, error };
  if (data?.error) return { data: null, error: { message: data.error } };
  return { data, error: null };
}

/** Look up the stripe_accounts row for the signed-in user. */
export async function getMyStripeAccount() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  return await supabase
    .from('stripe_accounts')
    .select('*')
    .eq('profile_id', userRes.user.id)
    .maybeSingle();
}

// ─── Bookings ────────────────────────────────────────────────────────────────

/**
 * Create a booking. Caller passes a service row (or anything with id +
 * owner_id) plus optional offering + when/where/notes.
 *
 *   service:     { id (uuid), owner_id (uuid), title, photo_class, category }
 *   offeringId:  uuid (optional — falls back to first default offering)
 *   scheduledAt: Date or ISO string. Defaults to "tomorrow at 10am".
 *   totalCents:  integer. Defaults to 0.
 *   locationText, notes: optional strings.
 */
export async function createBooking({
  service, offeringId = null, scheduledAt = null,
  totalCents = 0, locationText = '', notes = '',
  isFreeForRainmaker = false,
} = {}) {
  if (!supabaseReady) return NOT_WIRED;

  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to book.' } };
  }
  if (!service?.id || !service?.owner_id) {
    return { data: null, error: { message: 'Missing service for booking.' } };
  }

  const when = scheduledAt
    ? new Date(scheduledAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h placeholder

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      consumer_id:           userRes.user.id,
      provider_id:           service.owner_id,
      service_id:            service.id,
      offering_id:           offeringId,
      status:                'pending',
      scheduled_at:          when.toISOString(),
      location_text:         locationText || null,
      notes:                 notes || null,
      total_cents:           totalCents || 0,
      is_free_for_rainmaker: !!isFreeForRainmaker,
    })
    .select()
    .single();

  return { data, error };
}

/** Fetch a single booking by id with consumer + provider + service joined. */
export async function getBooking(id) {
  if (!supabaseReady) return NOT_WIRED;
  return await supabase
    .from('bookings')
    .select(`
      *,
      consumer:profiles!bookings_consumer_id_fkey ( id, display_name ),
      provider:profiles!bookings_provider_id_fkey ( id, display_name ),
      service:services ( id, title, category, description, photo_class, location_text ),
      offering:offerings ( id, name, kind, price_cents, duration_minutes )
    `)
    .eq('id', id)
    .single();
}

/** Update booking.status. Allowed values per the enum:
 *    'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' */
export async function updateBookingStatus(id, status) {
  if (!supabaseReady) return NOT_WIRED;
  return await supabase
    .from('bookings')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

/** Bookings where the signed-in user is the provider (inbox). */
export async function listProviderBookings() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };

  return await supabase
    .from('bookings')
    .select(`
      id, status, scheduled_at, location_text, notes, total_cents,
      is_free_for_rainmaker, created_at,
      consumer:profiles!bookings_consumer_id_fkey ( id, display_name ),
      service:services ( id, title, category, photo_class ),
      offering:offerings ( id, name, kind, duration_minutes )
    `)
    .eq('provider_id', userRes.user.id)
    .order('created_at', { ascending: false });
}

// ─── Messages (per-booking chat) ─────────────────────────────────────────────

/** Fetch all messages for a booking, oldest first. */
export async function listMessages(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  return await supabase
    .from('messages')
    .select('id, sender_id, body, created_at, read_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
}

/** Insert a message in a booking thread, sent by the current user. */
export async function sendMessage(bookingId, body) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to send a message.' } };
  }
  const trimmed = (body || '').trim();
  if (!trimmed) return { data: null, error: { message: 'Empty message.' } };

  return await supabase
    .from('messages')
    .insert({ booking_id: bookingId, sender_id: userRes.user.id, body: trimmed })
    .select()
    .single();
}

/**
 * Subscribe to realtime INSERTs on the messages table for one booking.
 * Returns an unsubscribe function. Caller passes a callback that receives
 * the new message row.
 */
export function subscribeToMessages(bookingId, onInsert) {
  if (!supabaseReady) return () => {};
  const channel = supabase
    .channel(`messages:${bookingId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
      payload => onInsert(payload.new)
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

/**
 * Create a review against a booking. Auto-detects whether the signed-in
 * caller is the consumer or the provider on that booking, and sets
 * rater/rated accordingly. The DB trigger on `reviews` auto-recalculates
 * the service's rating_avg + rating_count.
 *
 * Returns { data, error }. Will fail with a clean message if:
 *   - not signed in
 *   - booking not found
 *   - signed-in user isn't a party to the booking
 *   - a review for this booking already exists (unique constraint)
 */
export async function createReview(bookingId, stars, comment = '') {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId)    return { data: null, error: { message: 'Missing booking id.' } };
  if (!stars || stars < 1 || stars > 5) {
    return { data: null, error: { message: 'Stars must be 1-5.' } };
  }

  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to leave a review.' } };
  }
  const me = userRes.user.id;

  // Look up the booking to determine rater + rated.
  const { data: b, error: bErr } = await supabase
    .from('bookings')
    .select('id, consumer_id, provider_id')
    .eq('id', bookingId)
    .single();
  if (bErr || !b) {
    return { data: null, error: bErr || { message: 'Booking not found.' } };
  }

  let raterId = null, ratedId = null;
  if (me === b.consumer_id)      { raterId = b.consumer_id; ratedId = b.provider_id; }
  else if (me === b.provider_id) { raterId = b.provider_id; ratedId = b.consumer_id; }
  else {
    return { data: null, error: { message: "You're not a party to this booking." } };
  }

  return await supabase
    .from('reviews')
    .insert({
      booking_id: b.id,
      rater_id:   raterId,
      rated_id:   ratedId,
      stars,
      comment:    comment || null,
    })
    .select()
    .single();
}

/** Bookings where the signed-in user is the consumer (their history). */
export async function listConsumerBookings() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };

  return await supabase
    .from('bookings')
    .select(`
      id, status, scheduled_at, location_text, total_cents, created_at,
      provider:profiles!bookings_provider_id_fkey ( id, display_name ),
      service:services ( id, title, category, photo_class )
    `)
    .eq('consumer_id', userRes.user.id)
    .order('scheduled_at', { ascending: false });
}

/** Fetch a single service + its offerings. */
export async function getService(id) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: svc, error: svcErr } = await supabase
    .from('services')
    .select('*')
    .eq('id', id)
    .single();
  if (svcErr) return { data: null, error: svcErr };

  const { data: offerings } = await supabase
    .from('offerings')
    .select('*')
    .eq('service_id', id);

  return { data: { ...svc, offerings: offerings || [] }, error: null };
}
