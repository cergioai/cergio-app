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

  // 1. Insert service. taxonomy_* fields are populated when the
  //    /list-service/about screen ran the provider's typed "Service type"
  //    through resolveOffering(). Null is fine — service still works,
  //    matching falls back to text category.
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
      taxonomy_category:      draft.taxonomy_category      || null,
      taxonomy_provider_type: draft.taxonomy_provider_type || null,
      taxonomy_offering_id:   draft.taxonomy_offering_id   || null,
    })
    .select()
    .single();

  if (svcErr) return { data: null, error: svcErr };

  // 2. Insert offerings (if any). Each offering carries its own
  //    taxonomy_offering_id (resolved when the provider typed the offering
  //    name) plus taxonomy_override=true if we couldn't confidently match
  //    it. Override rows surface in the admin curation queue later.
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
      taxonomy_offering_id: o.taxonomy_offering_id || null,
      taxonomy_override:   !!o.taxonomy_override,
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
  offering_id = null,
  provider_type = null,
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

    let ids = (data || []).map(s => s.id);
    if (ids.length === 0) return { data: [], error: null };

    // Pull offerings in one shot, then attach. Carry taxonomy fields so
    // we can re-filter by offering_id when one was requested.
    const { data: offs } = await supabase
      .from('offerings')
      .select('id, service_id, name, kind, price_cents, duration_minutes, is_default, taxonomy_offering_id')
      .in('service_id', ids);
    const offMap = {};
    (offs || []).forEach(o => { (offMap[o.service_id] ||= []).push(o); });

    let filtered = data.map(s => ({ ...s, offerings: offMap[s.id] || [] }));
    if (offering_id) {
      filtered = filtered.filter(s =>
        (s.taxonomy_offering_id === offering_id) ||
        (s.offerings || []).some(o => o.taxonomy_offering_id === offering_id)
      );
    }
    return { data: filtered, error: null };
  }

  // Plain branch. Prefer taxonomy_offering_id when given — exact targeted
  // match against either the service or one of its offerings. Otherwise
  // fall back to the legacy text-category ilike.
  let q = supabase
    .from('services')
    .select(`
      id, title, category, description, location_text, photo_class,
      rating_avg, rating_count, bookings_count, owner_id, created_at,
      taxonomy_category, taxonomy_provider_type, taxonomy_offering_id,
      offerings ( id, name, kind, price_cents, duration_minutes, is_default, taxonomy_offering_id )
    `)
    .eq('status', 'listed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (offering_id) {
    // Wide net: services whose primary taxonomy_offering_id matches OR who
    // have at least one offering with this id. Post-filter offerings array
    // on the client since we can't easily JSON-filter the embedded join.
    q = q.or(`taxonomy_offering_id.eq.${offering_id},offerings.taxonomy_offering_id.eq.${offering_id}`);
  } else if (provider_type) {
    q = q.ilike('taxonomy_provider_type', provider_type);
  } else if (category) {
    q = q.ilike('category', `%${category}%`);
  }
  const res = await q;
  if (offering_id && res.data) {
    res.data = res.data.filter(s =>
      s.taxonomy_offering_id === offering_id ||
      (s.offerings || []).some(o => o.taxonomy_offering_id === offering_id)
    );
  }
  return res;
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
/**
 * Resolve a free-text service / offering name against the v3 taxonomy.
 * Provider-side helper: when a provider types "Drain unclog" or "fix leaky
 * sinks", we run that through chat-parse and return whatever the resolver
 * picked. The frontend can then save the canonical taxonomy_offering_id
 * alongside the provider's own wording (so consumer queries match).
 *
 * Returns:
 *   {
 *     data: {
 *       offering_id, provider_type, category, offering_name,
 *       confidence, method, candidates, bundle, ok (confidence ≥ 0.60),
 *     },
 *     error
 *   }
 */
export async function resolveOffering(text) {
  if (!text || !text.trim()) {
    return { data: null, error: { message: 'empty input' } };
  }
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase.functions.invoke('chat-parse', {
    body: { user_message: text, state: {} },
  });
  if (error) return { data: null, error };
  if (data?.error) return { data: null, error: { message: data.error } };
  const r = data?._resolver ?? {};
  const out = {
    offering_id:   r.offering_id   || null,
    provider_type: r.provider_type || null,
    category:      data?.parsed?.category || null,   // chat-parse rarely sets this for provider names; left for future use
    offering_name: data?.parsed?.what     || null,
    confidence:    typeof r.confidence === 'number' ? r.confidence : 0,
    method:        r.method,
    candidates:    Array.isArray(r.candidates) ? r.candidates : (r.top_candidates || []),
    bundle:        r.bundle || null,
    ok:            (typeof r.confidence === 'number' ? r.confidence : 0) >= 0.60 && !!r.offering_id,
  };
  return { data: out, error: null };
}

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

// ─── Instagram connection (manual for now, swap for OAuth later) ────────────

/**
 * Save the signed-in user's Instagram handle + follower count to their
 * profile. Used by both the Connector apply flow (required for them) and
 * the provider list-service flow (optional — boosts trust score).
 *
 * When we wire the Meta/Instagram OAuth integration later, swap this for
 * an edge-function call that exchanges the code → access_token, fetches
 * the canonical handle + follower count, and writes verified_at. Until
 * then, verified_at stays null on user-entered values so a future
 * verification pass can re-stamp them.
 */
export async function saveInstagram({ handle, followers, verified = false } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to connect Instagram.' } };
  }
  const cleanHandle = String(handle || '').replace(/^@/, '').trim().slice(0, 60);
  if (!cleanHandle) {
    return { data: null, error: { message: 'Handle is required.' } };
  }
  const followersNum = Number.isFinite(+followers) && +followers >= 0 ? Math.floor(+followers) : null;
  const now = new Date().toISOString();
  return await supabase
    .from('profiles')
    .update({
      instagram_handle:       cleanHandle,
      instagram_followers:    followersNum,
      instagram_connected_at: now,
      instagram_verified_at:  verified ? now : null,
    })
    .eq('id', userRes.user.id)
    .select()
    .single();
}

/** Read the signed-in user's Instagram connection state. */
export async function getMyInstagram() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  return await supabase
    .from('profiles')
    .select('instagram_handle, instagram_followers, instagram_connected_at, instagram_verified_at')
    .eq('id', userRes.user.id)
    .maybeSingle();
}

// ─── TikTok connect ─────────────────────────────────────────────────────────
// Mirrors the Instagram helpers above. Schema v8 added tiktok_* columns to
// profiles. Manual entry for now; once TikTok OAuth ships we flip
// tiktok_verified_at to a timestamp on OAuth-validated saves.

/**
 * Save the user's TikTok handle + audience (follower count) to their
 * profile. `verified` flips when the value came from OAuth, not manual entry.
 */
export async function saveTikTok({ handle, followers, verified = false } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to connect TikTok.' } };
  }
  const cleanHandle = String(handle || '').replace(/^@/, '').trim().slice(0, 60);
  if (!cleanHandle) {
    return { data: null, error: { message: 'Handle is required.' } };
  }
  const followersNum = Number.isFinite(+followers) && +followers >= 0 ? Math.floor(+followers) : null;
  const now = new Date().toISOString();
  return await supabase
    .from('profiles')
    .update({
      tiktok_handle:       cleanHandle,
      tiktok_followers:    followersNum,
      tiktok_connected_at: now,
      tiktok_verified_at:  verified ? now : null,
    })
    .eq('id', userRes.user.id)
    .select()
    .single();
}

/** Read the signed-in user's TikTok connection state. */
export async function getMyTikTok() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  return await supabase
    .from('profiles')
    .select('tiktok_handle, tiktok_followers, tiktok_connected_at, tiktok_verified_at')
    .eq('id', userRes.user.id)
    .maybeSingle();
}

// ─── Connector spotlight pricing (v9) ───────────────────────────────────────
// Rate-card per platform. Stored in cents on profiles. Connectors set these
// during apply flow; providers see them when browsing Connectors for paid
// spotlights. NULL = "free-swap only" — they only do barter, not paid.

/**
 * Save the signed-in user's spotlight prices. Accepts dollars (numbers like
 * 25 or "25.00") or cents (>=100 with a flag). We default to dollars-to-cents
 * conversion since that's what humans type.
 */
export async function saveSpotlightPrices({ instagramDollars, tiktokDollars } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to set spotlight prices.' } };
  }
  const toCents = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = +v;
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };
  return await supabase
    .from('profiles')
    .update({
      spotlight_price_instagram_cents: toCents(instagramDollars),
      spotlight_price_tiktok_cents:    toCents(tiktokDollars),
    })
    .eq('id', userRes.user.id)
    .select('spotlight_price_instagram_cents, spotlight_price_tiktok_cents')
    .single();
}

/** Read the signed-in user's spotlight rate card. */
export async function getMySpotlightPrices() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  return await supabase
    .from('profiles')
    .select('spotlight_price_instagram_cents, spotlight_price_tiktok_cents')
    .eq('id', userRes.user.id)
    .maybeSingle();
}

// ─── Spotlight requests (v10) ───────────────────────────────────────────────
// Provider asks Connector for an IG/TT spotlight. Connector can counter at
// a lower price. RLS scopes reads to the two parties on the row.

/**
 * Create a spotlight request. The Connector sees this in their inbox.
 * `platform` must be 'instagram' or 'tiktok'.
 * `officialPriceCents` should be the rate card snapshot at the time of
 * request — we don't trust the client value beyond what the server can
 * also read from the profile (drift between fetch + insert is tiny).
 * Fires notify-spotlight (event=created) fire-and-forget on success.
 */
export async function createSpotlightRequest({ connectorId, platform, officialPriceCents, message, serviceId = null } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to request a spotlight.' } };
  }
  if (!connectorId) return { data: null, error: { message: 'connectorId required' } };
  if (platform !== 'instagram' && platform !== 'tiktok') {
    return { data: null, error: { message: 'platform must be instagram or tiktok' } };
  }
  const res = await supabase
    .from('spotlight_requests')
    .insert({
      provider_id:          userRes.user.id,
      connector_id:         connectorId,
      service_id:           serviceId,
      platform,
      official_price_cents: Math.max(0, Math.round(+officialPriceCents || 0)),
      message:              (message || '').slice(0, 2000) || null,
      status:               'pending',
    })
    .select()
    .single();
  if (!res.error && res.data?.id) fireSpotlightNotify(res.data.id, 'created');
  return res;
}

/** List requests where the signed-in user is the provider (their outbound). */
export async function listMyOutboundSpotlightRequests({ limit = 50 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  return await supabase
    .from('spotlight_requests')
    .select('*')
    .eq('provider_id', userRes.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
}

/** List requests addressed to the signed-in user (their inbound, as Connector).
 *  Joins service so the InboundCard can show "spotlight for {service title}". */
export async function listMyInboundSpotlightRequests({ limit = 50 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  return await supabase
    .from('spotlight_requests')
    .select('*, service:services(id, title, category)')
    .eq('connector_id', userRes.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
}

/** Counter with a lower price. Either party (Connector or Provider) can
 *  counter — we auto-detect role from the signed-in user vs the row.
 *  Status → 'countered'; last_counter_by stamps who just countered so the
 *  UI knows whose turn it is. Fires notify-spotlight (countered) on success. */
export async function counterSpotlightRequest(id, { offeredPriceCents } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!id) return { data: null, error: { message: 'id required' } };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };

  // Look up the row to determine the caller's role.
  const { data: row, error: rowErr } = await supabase
    .from('spotlight_requests')
    .select('id, provider_id, connector_id')
    .eq('id', id)
    .single();
  if (rowErr || !row) return { data: null, error: rowErr || { message: 'request not found' } };
  let role = null;
  if (row.provider_id  === userRes.user.id) role = 'provider';
  if (row.connector_id === userRes.user.id) role = 'connector';
  if (!role) return { data: null, error: { message: 'You are not on this request' } };

  const res = await supabase
    .from('spotlight_requests')
    .update({
      offered_price_cents: Math.max(0, Math.round(+offeredPriceCents || 0)),
      status:              'countered',
      last_counter_by:     role,
      responded_at:        new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (!res.error && res.data?.id) fireSpotlightNotify(res.data.id, 'countered');
  return res;
}

/**
 * Connector marks the spotlight as posted with the public URL of the
 * IG/TT post. Status semantics stay 'accepted' (we use posted_at + URL
 * to convey the new sub-state). Fires notify-spotlight event=posted →
 * provider gets "{Connector} posted your spotlight" email asking to
 * confirm.
 */
export async function markSpotlightPosted(id, { postedUrl } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!id) return { data: null, error: { message: 'id required' } };
  const url = (postedUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { data: null, error: { message: 'Valid post URL required (must start with https://)' } };
  }
  const res = await supabase
    .from('spotlight_requests')
    .update({
      posted_at:  new Date().toISOString(),
      posted_url: url.slice(0, 500),
    })
    .eq('id', id)
    .is('posted_at', null)   // idempotent — don't overwrite the first post
    .select()
    .single();
  if (!res.error && res.data?.id) fireSpotlightNotify(res.data.id, 'posted');
  return res;
}

/**
 * Provider confirms the spotlight is live. Stamps confirmed_at + released_at
 * (today they're the same; future migration to escrow will split them).
 * Fires notify-spotlight event=confirmed → Connector gets "Provider
 * confirmed — your funds are released" email.
 */
export async function confirmSpotlightPost(id) {
  if (!supabaseReady) return NOT_WIRED;
  if (!id) return { data: null, error: { message: 'id required' } };
  const now = new Date().toISOString();
  const res = await supabase
    .from('spotlight_requests')
    .update({ confirmed_at: now, released_at: now })
    .eq('id', id)
    .is('confirmed_at', null)
    .select()
    .single();
  if (!res.error && res.data?.id) fireSpotlightNotify(res.data.id, 'confirmed');
  return res;
}

/** Set request status (accept / decline / cancel).
 *  Fires notify-spotlight with matching event fire-and-forget on success. */
export async function setSpotlightRequestStatus(id, status) {
  if (!supabaseReady) return NOT_WIRED;
  if (!id) return { data: null, error: { message: 'id required' } };
  if (!['accepted','declined','cancelled'].includes(status)) {
    return { data: null, error: { message: `invalid status: ${status}` } };
  }
  const res = await supabase
    .from('spotlight_requests')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (!res.error && res.data?.id) fireSpotlightNotify(res.data.id, status);
  return res;
}

// ─── CC identity verification (v13 + create-setup-intent edge fn) ──────────

/** Create a Stripe SetupIntent for the signed-in user (creates Customer if
 *  missing). Returns { client_secret, customer_id } for the frontend to
 *  feed into Stripe Elements' confirmSetup. */
export async function createSetupIntent() {
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: {} });
  if (error) return { data: null, error };
  return { data, error: null };
}

/** Read the signed-in user's CC verification state. */
export async function getMyCcStatus() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  return await supabase
    .from('profiles')
    .select('stripe_customer_id, cc_verified_at')
    .eq('id', userRes.user.id)
    .maybeSingle();
}

/** Optimistic flip — frontend calls this after stripe.confirmSetup succeeds.
 *  Real source of truth is the setup_intent.succeeded webhook (future). */
export async function markCcVerified() {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  return await supabase
    .from('profiles')
    .update({ cc_verified_at: new Date().toISOString() })
    .eq('id', userRes.user.id)
    .select('cc_verified_at')
    .single();
}

/**
 * Read the signed-in user's earnings ledger (bookings + spotlights merged).
 * Returns rows ordered by created_at desc, capped at `limit`. Each row has
 * { id, kind, source_id, amount_cents, currency, status, created_at, meta }.
 * Includes both kind='booking' (from paid services) and kind='spotlight'
 * (from accepted + paid spotlight requests).
 */
export async function getMyEarnings({ limit = 50, kind } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  let q = supabase
    .from('earnings')
    .select('id, kind, source_id, amount_cents, currency, status, created_at, meta')
    .eq('profile_id', userRes.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind) q = q.eq('kind', kind);
  return await q;
}

/**
 * Create a PaymentIntent for an accepted spotlight request. Returns the
 * client_secret the frontend feeds to Stripe's PaymentSheet. After the
 * provider completes the payment, the stripe-webhook flips paid_at on the
 * row and writes the Connector's earnings.
 */
export async function createSpotlightPaymentIntent(spotlightRequestId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!spotlightRequestId) return { data: null, error: { message: 'spotlightRequestId required' } };
  const { data, error } = await supabase.functions.invoke('create-spotlight-payment-intent', {
    body: { spotlightRequestId },
  });
  if (error) return { data: null, error };
  return { data, error: null };
}

/** Fire-and-forget call to notify-spotlight edge function. Never awaits or
 *  surfaces errors to the caller — the database row is what matters, email
 *  is best-effort. Mirrors the notifyProvider pattern for bookings. */
function fireSpotlightNotify(requestId, event) {
  const app_url = typeof window !== 'undefined' ? window.location.origin : undefined;
  supabase.functions
    .invoke('notify-spotlight', { body: { requestId, event, app_url } })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[notify-spotlight] best-effort send failed', err);
    });
}

// ─── Generic user notifications (notify-user edge fn) ──────────────────────

/**
 * Dispatch a templated notification via email + SMS (where applicable).
 * Events implemented in notify-user: signup_welcome, invite_received,
 * invite_joined, service_recommended, first_booking, become_connector_prompt.
 * Fire-and-forget — never blocks the caller's UI.
 */
export async function notifyUser({ event, recipient, data = {} } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!event || !recipient) return { data: null, error: { message: 'event + recipient required' } };
  const app_url = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { data: res, error } = await supabase.functions.invoke('notify-user', {
    body: { event, recipient, data, app_url },
  });
  return { data: res, error };
}

// ─── Booking notifications ──────────────────────────────────────────────────

/**
 * Ping the matched provider (Resend email) that a consumer just booked
 * them. Designed to be fire-and-forget — the booking row is what matters;
 * notification is best-effort. createBooking() calls this on success
 * without awaiting so the consumer's UI never waits on email delivery.
 *
 * If Resend is down or RESEND_API_KEY isn't pushed, the function returns
 * an error JSON. We surface that as { error } and the caller swallows it.
 */
export async function notifyProvider(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId)     return { data: null, error: { message: 'bookingId required' } };
  // Pass the current app URL so the email's "Accept or decline →" link
  // points at the right host (preview vs prod vs localhost).
  const app_url = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { data, error } = await supabase.functions.invoke('notify-provider', {
    body: { bookingId, app_url },
  });
  if (error)       return { data: null, error };
  if (data?.error) return { data: null, error: { message: data.error } };
  return { data, error: null };
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

  // Fire-and-forget provider notification. We never block the consumer's
  // UI on email delivery; if Resend is down or unconfigured, the booking
  // still completes and the provider can see the request on next sign-in
  // via the inbox. Errors are logged to console for debugging.
  if (data?.id && !error) {
    notifyProvider(data.id).then(
      ({ error: nErr }) => {
        if (nErr) {
          // eslint-disable-next-line no-console
          console.warn('[notify-provider]', nErr.message || nErr);
        }
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[notify-provider] threw', err);
      }
    );
  }

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
