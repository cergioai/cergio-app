// Thin data-layer around Supabase. Screens import from here instead of
// touching `supabase` directly. Each function returns { data, error } so
// callers can branch on either.
import { supabase, supabaseReady } from './supabase';
import { pointInPolygon } from './geo';
// SPEC-80 ontology bridge — expand a searched provider type into its whole
// family so a search matches sibling/variant listing types ("Tutor" ⇄
// "Language Immersion"/"Math Tutor"/"Language Tutor", "Nail Tech" ⇄ "Nail
// Technician", etc.). The bridge only WIDENS the allow-set; an un-familied
// type still bridges to itself, so a strict match is never lost.
import { expandAllowlist, bridgeAllowSetLC } from './ontologyBridge';

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
  const title = makeTitle(draft.category, draft.location);

  // CERGIO-GUARD (2026-06-19, Tarik — duplicate-listings bug): a double-tap /
  // double effect was inserting two identical services microseconds apart
  // (info@cergio had 2 identical Personal Chef rows). Before inserting, return
  // any listing this owner already has with the SAME title created in the last
  // 2 minutes — idempotent regardless of how the caller fires.
  {
    const since = new Date(Date.now() - 120000).toISOString();
    const { data: dupes } = await supabase
      .from('services')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('title', title)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (dupes && dupes.length) {
      return { data: dupes[0], error: null, deduped: true };
    }
  }

  // 1. Insert service. taxonomy_* fields are *optional* in the schema —
  //    older deployments don't have those columns yet (the PostgREST
  //    cache returns "Could not find the 'taxonomy_category' column"
  //    when it tries to insert them). We retry without taxonomy fields
  //    on that specific failure so the listing still saves; routing
  //    just degrades to text category until the migration lands.
  const baseRow = {
    owner_id:     ownerId,
    title:        title,
    category:     draft.category || null,
    description:  draft.description || null,
    location_text: draft.location || null,
    lat:          draft.lat ?? null,
    lng:          draft.lng ?? null,
    photo_class:  draft.photoClass || 'fv-jamie',
    status:       'listed',
    // CERGIO-GUARD (2026-05-30): provider-drawn coverage polygon
    // (GeoJSON Polygon). Nullable — when null, consumer search falls
    // back to the radius logic. Schema-cache miss path below retries
    // without this field so the listing still publishes on legacy
    // deployments that haven't run "Apply Service Area Migration".
    service_area_geojson: draft.serviceAreaGeoJson || null,
  };
  const taxonomyRow = {
    taxonomy_category:      draft.taxonomy_category      || null,
    taxonomy_provider_type: draft.taxonomy_provider_type || null,
    taxonomy_offering_id:   draft.taxonomy_offering_id   || null,
  };
  let svc; let svcErr;
  {
    const r = await supabase
      .from('services')
      .insert({ ...baseRow, ...taxonomyRow })
      .select()
      .single();
    svc = r.data; svcErr = r.error;
  }
  // Schema cache miss → retry without taxonomy_* columns.
  if (svcErr && /taxonomy_(category|provider_type|offering_id)/.test(svcErr.message || '')) {
    // eslint-disable-next-line no-console
    console.warn('[createService] taxonomy_* columns missing in schema; retrying without. Apply the migration to enable taxonomy routing.', svcErr.message);
    const r = await supabase
      .from('services')
      .insert(baseRow)
      .select()
      .single();
    svc = r.data; svcErr = r.error;
  }
  // Same defensive pattern for service_area_geojson — old deployments
  // that haven't run "Apply Service Area Migration" reject the column.
  // Drop it and retry so the listing still publishes (just without the
  // polygon — provider can re-add it once the migration's applied).
  if (svcErr && /service_area_geojson/.test(svcErr.message || '')) {
    // eslint-disable-next-line no-console
    console.warn('[createService] service_area_geojson missing in schema; retrying without. Apply the migration.', svcErr.message);
    const { service_area_geojson: _drop, ...rowSansArea } = baseRow;
    const r = await supabase
      .from('services')
      .insert({ ...rowSansArea, ...taxonomyRow })
      .select()
      .single();
    svc = r.data; svcErr = r.error;
  }

  if (svcErr) return { data: null, error: svcErr };

  // 2. Insert offerings (if any). Each offering carries its own
  //    taxonomy_offering_id (resolved when the provider typed the offering
  //    name) plus taxonomy_override=true if we couldn't confidently match
  //    it. Override rows surface in the admin curation queue later.
  if (Array.isArray(draft.offerings) && draft.offerings.length > 0) {
    const baseRows = draft.offerings.map(o => ({
      service_id:        svc.id,
      name:              o.name || (o.kind === 'hourly' ? 'Hourly rate' : 'Session'),
      description:       o.description || null,
      kind:              o.kind,
      price_cents:       priceToCents(o.price),
      duration_minutes:  o.kind === 'session' ? (parseInt(o.durationMinutes, 10) || null) : null,
      currency:          'USD',
      is_default:        true,
    }));
    const taxonomyRows = draft.offerings.map(o => ({
      taxonomy_offering_id: o.taxonomy_offering_id || null,
      taxonomy_override:    !!o.taxonomy_override,
    }));
    // Same defensive pattern as the services insert above — try with
    // taxonomy columns; if PostgREST schema cache rejects them, retry
    // without so the listing still publishes.
    let offErr;
    {
      const rows = baseRows.map((r, i) => ({ ...r, ...taxonomyRows[i] }));
      const r = await supabase.from('offerings').insert(rows);
      offErr = r.error;
    }
    if (offErr && /taxonomy_(offering_id|override)/.test(offErr.message || '')) {
      // eslint-disable-next-line no-console
      console.warn('[createService] offerings taxonomy_* columns missing; retrying without.', offErr.message);
      const r = await supabase.from('offerings').insert(baseRows);
      offErr = r.error;
    }
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
    .select('id, title, category, taxonomy_provider_type, description, location_text, photo_class, cover_url, status, rating_avg, rating_count, bookings_count, created_at')
    .eq('owner_id', userRes.user.id)
    .order('created_at', { ascending: false });
}

// ─── PROVIDER FANOUT GUARD ──────────────────────────────────────────────────
//
// CERGIO-GUARD: any future "notify these providers" path (an edge function
// fan-out, an SMS blast, an email blast — anything that touches a real
// provider's inbox) MUST go through getProvidersForNotify() below. The
// helper enforces three invariants that the free-text matching path is
// deliberately too forgiving for:
//
//   1. EXACT provider_type match (no substring, no stem, no fuzzy).
//      A "plumber" request goes to providers with
//      taxonomy_provider_type = 'Plumber' (or 'Plumbing Technician' /
//      'Master Plumber' from an allowlist), NEVER to a Driver or
//      Dog Sitter because some token happened to overlap.
//
//   2. notify_safe flag from chat state must be TRUE. If the chat
//      resolver wasn't confident (confidence < 0.7 or generic
//      provider_type), we refuse to fan out and surface a
//      disambiguation step to the user instead. This is the kill switch
//      that prevents a 'I need help' request from being blasted to
//      every provider on the platform.
//
//   3. Geo gate: provider must be within radius. No nationwide spam.
//
// If you find yourself bypassing this helper, STOP. Either route through
// it or get explicit sign-off; sending a toilet-unclog request to a
// driver because we 'thought it might be related' is exactly the kind of
// trust-shattering failure mode the gate exists to prevent.
//
/**
 * Get providers eligible for a notification fan-out for a given request.
 * STRICT: requires verifiedProviderType (exact match) + notifySafe.
 *
 * @param {Object} args
 * @param {string} args.verifiedProviderType  Exact taxonomy_provider_type — REQUIRED
 * @param {boolean} args.notifySafe           From chat.state.notifySafe — REQUIRED true
 * @param {number}  args.lat                  REQUIRED
 * @param {number}  args.lng                  REQUIRED
 * @param {number}  args.radiusMiles          Default 25
 * @param {string[]} args.providerTypeAllowlist  Optional related types
 *                                               (e.g. ['Plumber', 'Master Plumber'])
 * @returns {Promise<{ data: Array, error: any, blocked?: string }>}
 *   blocked is set when the call refuses to fan out for a safety reason
 *   so the caller can surface the disambiguation UI.
 */
export async function getProvidersForNotify({
  verifiedProviderType,
  notifySafe,
  lat,
  lng,
  radiusMiles = 25,
  providerTypeAllowlist = null,
} = {}) {
  if (!supabaseReady) return { data: null, error: NOT_WIRED.error };

  // SAFETY GATE — refuse the call unless every invariant is satisfied.
  if (!notifySafe) {
    return {
      data: null, error: null,
      blocked: 'notify_safe_false: chat resolver not confident — ask the user to pick a category before fanning out.',
    };
  }
  if (!verifiedProviderType || typeof verifiedProviderType !== 'string') {
    return {
      data: null, error: null,
      blocked: 'no_verified_provider_type: refusing to blast all providers.',
    };
  }
  if (lat == null || lng == null) {
    return {
      data: null, error: null,
      blocked: 'no_coords: refusing to fan out without geo.',
    };
  }

  // Allowlist = the type + caller allowlist, each widened through the SPEC-80
  // ontology bridge (Tutor → Language Immersion / Math Tutor / Language Tutor …).
  // Un-familied types bridge to themselves, so a strict match is never lost.
  const allow = expandAllowlist(
    [verifiedProviderType, ...(providerTypeAllowlist || [])]
      .map(s => String(s).trim()).filter(Boolean)
  );

  // Proximity via services_near, then post-filter on exact provider_type.
  const { data, error } = await supabase.rpc('services_near', {
    near_lat: lat, near_lng: lng,
    radius_miles: radiusMiles,
    category_match: null,
  });
  if (error) return { data: null, error };

  // CERGIO-GUARD (2026-06-18): services_near returns ONLY proximity columns
  // (id / title / location / distance) — NOT taxonomy_provider_type. Filtering
  // the RAW rpc rows on `s.taxonomy_provider_type` matched NOTHING (it's always
  // undefined → allow.includes('') → false), so NO provider was EVER fanned out
  // a new_request — confirmed by zero new_request rows in the notifications
  // table. Re-hydrate full rows by id (the SAME fix searchServices already
  // applies) BEFORE the strict provider-type filter so matching actually works.
  const ids = (data || []).map(s => s.id).filter(Boolean);
  if (ids.length === 0) return { data: [], error: null };
  const { data: full, error: fullErr } = await supabase
    .from('services')
    .select('id, owner_id, taxonomy_provider_type, category, status')
    .in('id', ids)
    .eq('status', 'listed');
  if (fullErr) return { data: null, error: fullErr };

  // CERGIO-GUARD (2026-06-25): match CASE-INSENSITIVELY on taxonomy_provider_type
  // OR category. The old exact, case-sensitive match on taxonomy_provider_type
  // alone silently dropped providers whenever the request type and the listing
  // differed only by case or sat one level apart (type vs category) — e.g. a
  // "Personal Chef" request never reaching a chef listed under category "Food".
  const allowLC = new Set(allow.map(s => s.toLowerCase()));
  const norm = (v) => String(v || '').trim().toLowerCase();
  const filtered = (full || []).filter(s =>
    allowLC.has(norm(s.taxonomy_provider_type)) || allowLC.has(norm(s.category))
  );
  return { data: filtered, error: null };
}

/** Partial update on a service row. RLS enforces ownership. Pass any
 *  subset of { title, description, category, location_text, lat, lng,
 *  photo_class, cover_url }. Returns { data, error }. */
export async function updateService(serviceId, patch) {
  if (!supabaseReady) return NOT_WIRED;
  if (!serviceId)    return { data: null, error: { message: 'serviceId required' } };
  return await supabase
    .from('services')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', serviceId)
    .select()
    .maybeSingle();
}

/** Flip a service to draft (unlist) — owner can re-list anytime. RLS
 *  enforces ownership; if the call returns an error, the caller should
 *  surface it instead of pretending the action succeeded. */
export async function unlistService(serviceId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!serviceId)    return { data: null, error: { message: 'serviceId required' } };
  return await supabase
    .from('services')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', serviceId)
    .select()
    .maybeSingle();
}

/** Re-list a previously-unlisted service. */
export async function relistService(serviceId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!serviceId)    return { data: null, error: { message: 'serviceId required' } };
  return await supabase
    .from('services')
    .update({ status: 'listed', updated_at: new Date().toISOString() })
    .eq('id', serviceId)
    .select()
    .maybeSingle();
}

/** Hard-delete a service. RLS policy 'owner can delete service' enforces
 *  ownership. Offerings + bookings cascade per schema definitions.
 *  Returns { error } only — there's nothing meaningful to return on
 *  success. */
export async function deleteService(serviceId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!serviceId)    return { error: { message: 'serviceId required' } };
  const { error } = await supabase.from('services').delete().eq('id', serviceId);
  return { error };
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
// CERGIO-GUARD (2026-05-29): hydrate recommenders for a list of service
// IDs. Two-query path: pull recommendations rows, then pull display_names
// from profiles. Avoids relying on a PostgREST foreign-key join that
// recommendations.recommender_id (→ auth.users) doesn't expose. The
// result is a { [service_id]: [{id, name, message, created_at}] } map
// that listServices stitches onto each service row as `recommenders`.
//
// ResultsScreen → ProviderCard renders the avatar stack from these.
// Empty array (no rows for that service) renders "No mutual friends yet".
async function fetchRecommendersByServiceId(serviceIds) {
  if (!supabaseReady || !serviceIds?.length) return {};
  // CERGIO-GUARD (2026-05-29): the recommendations table uses `sent_at`,
  // NOT `created_at`. Diagnose Money Flow.command surfaced this — every
  // hydration query was erroring with "column created_at does not exist"
  // and silently returning {} → all cards showed "No mutual friends yet"
  // even when recs existed. Use sent_at + alias it back to created_at on
  // the returned object so the consumers (PDP, ResultsScreen) keep the
  // same field name they already expect.
  //
  // ALSO (2026-05-30): includes is_connector per recommender, derived
  // from profiles.cc_verified_at. ProviderCard renders bucketed copy
  // "Reco'd by Jennifer Hu, 3 other friends and 21 Connectors" — needs
  // to distinguish a Connector rec from a regular friend rec.
  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, service_id, recommender_id, message, sent_at')
    .in('service_id', serviceIds)
    .order('sent_at', { ascending: false });
  // CERGIO-DIAG (gated): surfaces in DevTools when something's off —
  // e.g. RLS blocking reads, or seed not yet run. Toggle off with
  // window.__cergioDiag = false. Logs to help debug "No mutual friends"
  // on cards even when the seed claims to have written rows.
  if (typeof window !== 'undefined' && window.__cergioDiag !== false) {
    // eslint-disable-next-line no-console
    console.log('[CERGIO/recommenders]', {
      askedFor: serviceIds.length,
      gotRows:  recs?.length || 0,
      error:    error?.message || null,
      sample:   (recs || []).slice(0, 3),
    });
  }
  if (error || !recs?.length) return {};
  const profileIds = [...new Set(recs.map(r => r.recommender_id).filter(Boolean))];
  let profMap = {};
  if (profileIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, cc_verified_at')
      .in('id', profileIds);
    profMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
  }
  const map = {};
  for (const r of recs) {
    if (!r.service_id) continue;
    const p = profMap[r.recommender_id];
    (map[r.service_id] ||= []).push({
      id:           r.recommender_id,
      name:         p?.display_name || 'A friend',
      message:      r.message,
      // Alias DB `sent_at` → `created_at` for the consumers' shape stability.
      created_at:   r.sent_at,
      // True when this recommender has been verified as a Connector
      // (cc_verified_at set on their profile). ProviderCard reads this
      // to bucket the recoText into friends + Connectors.
      is_connector: !!p?.cc_verified_at,
    });
  }
  return map;
}

/**
 * rankProviders — THE best-match order for a covered area (launch-03, SPEC-78).
 *
 * Tarik 2026-07-14: "best match = highest rating + closest distance."
 *
 * Deterministic and total, so the same three providers always come back in the
 * same order (a ranking that ties non-deterministically is a ranking you cannot
 * test, and a user who reloads and sees a different "best match" does not trust
 * the list):
 *   1. RATING first  — rating_avg descending. Quality is the primary signal.
 *   2. DISTANCE next — distance_miles ascending. Closest wins the tie.
 *   3. rating_count, then id — final tie-breakers so the order is stable across
 *      runs even when rating AND distance are identical.
 *
 * Unrated (null rating) sorts BELOW any rated provider rather than pretending to
 * be a 0.0 — an unrated provider is unknown, not bad. Missing distance sorts last.
 *
 * Pure: takes rows, returns a NEW sorted array. Exported so qa.mjs can assert the
 * order directly on known fixtures, with no DB and no browser.
 */
export function rankProviders(rows = []) {
  const rating = (s) => (typeof s?.rating_avg === 'number' ? s.rating_avg : -1);
  const dist   = (s) => (typeof s?.distance_miles === 'number' ? s.distance_miles : 9e9);
  const count  = (s) => (typeof s?.rating_count === 'number' ? s.rating_count : 0);
  return [...rows].sort((a, b) =>
    (rating(b) - rating(a)) ||
    (dist(a)   - dist(b))   ||
    (count(b)  - count(a))  ||
    String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
  );
}

export async function listServices({
  category = null,
  offering_id = null,
  provider_type = null,
  lat = null, lng = null, radiusMiles = 25,
  limit = 50,
  // CERGIO-GUARD: matching filters previously not applied — fixed
  // 2026-05-26. Budget pill on Results was cosmetic only; free/paid
  // toggle on Home didn't filter. Now: maxBudgetCents filters to
  // services whose default (or cheapest) offering fits the budget;
  // freeOnly filters to services with at least one $0 offering.
  maxBudgetCents = null,
  freeOnly = false,
  // CERGIO-GUARD: originalQuery is the user's RAW words from chat. It's
  // the safety net — when the parser's offering_id/provider_type point
  // at taxonomy values the seeded services don't carry (e.g. parser
  // says "Housekeeper" but service has "House Cleaner"), we fall back
  // to stem-substring matching across title/description/category using
  // the user's own words. Without this, perfectly seeded data shows up
  // empty just because the parser used a different synonym.
  originalQuery = null,
} = {}) {
  if (!supabaseReady) return NOT_WIRED;

  // Proximity branch — uses the RPC + then back-fills offerings in one extra query.
  // CERGIO-GUARD: geo filtering is STRICT — if no providers are within
  // radiusMiles, the result IS empty. You can't realistically book a
  // cleaner 1000mi away, so showing nationwide results would be a worse
  // UX than an honest empty state. (Confirmed by user 2026-05-27.)
  if (lat != null && lng != null) {
    // CERGIO-GUARD: do NOT pass `category` as category_match — the RPC
    // does an EXACT string match on services.category, and our parser
    // sets `what` to phrases like "Deep Cleaning" while seeded rows
    // carry the base category "Cleaning". Mismatch → zero results,
    // even though the row is geographically right there. Confirmed
    // 2026-05-27 via Diagnose Search.command: query 5 with
    // category_match='Cleaning' returned Maria's row; the app was
    // sending 'Deep Cleaning' and getting nothing.
    //
    // Strategy: pull everything in radius, then let applyMatchingFilters
    // rank by originalQuery stems + preferOfferingId. Same OR-not-AND
    // philosophy as the non-proximity path's collectMatchOrClauses.
    const { data, error } = await supabase.rpc('services_near', {
      near_lat: lat, near_lng: lng,
      radius_miles: radiusMiles,
      category_match: null,
    });
    if (error) return { data: null, error };

    let ids = (data || []).map(s => s.id);
    if (ids.length === 0) return { data: [], error: null };

    // CERGIO-GUARD (2026-05-27): services_near RPC returns only the
    // proximity columns (id/title/location_text/distance) — NOT the
    // taxonomy_* columns the strict filter below needs. Without the
    // re-fetch, `s.taxonomy_provider_type` is undefined for every row,
    // and every strict filter excludes everything → zero results.
    // Confirmed via Chrome JS probe: services_near returned 8 Miami
    // rows but `filtered` was [] because taxonomy_provider_type
    // wasn't in the response shape.
    //
    // Fix: take the IDs proximity gave us, hydrate full rows from
    // services WITH taxonomy_provider_type + taxonomy_offering_id, then
    // strict-filter. Costs one extra round-trip but lets the spec's
    // strict-match guarantee actually hold.
    const [{ data: full, error: fullErr }, { data: offs }] = await Promise.all([
      supabase
        .from('services')
        .select(`
          id, title, category, description, location_text, photo_class,
          cover_url, rating_avg, rating_count, bookings_count, owner_id,
          created_at, taxonomy_category, taxonomy_provider_type,
          taxonomy_offering_id, status, service_area_geojson
        `)
        .in('id', ids)
        .eq('status', 'listed'),
      supabase
        .from('offerings')
        .select('id, service_id, name, kind, price_cents, duration_minutes, is_default, taxonomy_offering_id')
        .in('service_id', ids),
    ]);
    if (fullErr) return { data: null, error: fullErr };

    // Build a distance lookup so we preserve services_near's ordering.
    const distById = Object.fromEntries((data || []).map(s => [s.id, s.distance_miles]));
    const offMap = {};
    (offs || []).forEach(o => { (offMap[o.service_id] ||= []).push(o); });

    let filtered = rankProviders((full || []).map(s => ({
      ...s,
      distance_miles: distById[s.id],
      offerings: offMap[s.id] || [],
    })));
    // CERGIO-GUARD: matching is STRICT on provider_type — this is the
    // trust model from the spec. Users asking for "unclog toilet"
    // expect ONLY plumbers to surface (and be notified). Showing a
    // House Cleaner because words share stems would break trust the
    // moment we actually fan out notifications. So the search uses
    // the same exact-match philosophy as getProvidersForNotify
    // (invariant #4): taxonomy_provider_type == resolved provider_type.
    //
    // If provider_type is not set, we ALSO accept an exact match on
    // taxonomy_offering_id (the parser sometimes resolves to a more
    // specific offering than the provider type).
    //
    // If NEITHER resolved → return [] with no fuzzy fallback. The
    // empty state UI tells the user we couldn't understand, with a
    // suggestion to use simpler/more canonical terms.
    if (provider_type) {
      // SPEC-80: match the searched type OR any sibling/child in its ontology
      // family (bridgeAllowSetLC). A "Tutor" search now surfaces a listing
      // typed "Language Immersion" / "Math Tutor" / "Language Tutor"; category
      // is also checked (category-derived types like "Language Immersion" live
      // in taxonomy_provider_type on the listing, but this keeps parity with
      // getProvidersForNotify's type-OR-category rule). An un-familied type
      // yields a one-element set, preserving the strict single-type match.
      const wantSet = bridgeAllowSetLC(provider_type);
      filtered = filtered.filter(s =>
        wantSet.has(String(s.taxonomy_provider_type || '').trim().toLowerCase()) ||
        wantSet.has(String(s.category || '').trim().toLowerCase())
      );
    } else if (offering_id) {
      filtered = filtered.filter(s =>
        (s.taxonomy_offering_id === offering_id) ||
        (s.offerings || []).some(o => o.taxonomy_offering_id === offering_id)
      );
    } else {
      // Parser produced neither — honest empty.
      filtered = [];
    }
    // Budget + freeOnly still apply (real, user-controlled filters).
    filtered = applyMatchingFilters(filtered, { maxBudgetCents, freeOnly });

    // CERGIO-GUARD (2026-05-30): provider-drawn service-area filter.
    // When a service has service_area_geojson set, the consumer's
    // search point (lat/lng) MUST fall inside the polygon — that
    // provider explicitly drew their coverage. Services WITHOUT a
    // polygon are unaffected (radius-based proximity is still in
    // play via services_near). Implemented client-side because:
    //   1. PostGIS isn't enabled on this Supabase project yet
    //   2. Volume is small enough that a JS ray-cast is fine
    //   3. Adds zero RLS surface
    // If we ever scale past low thousands of providers per query,
    // swap for a PostGIS ST_Contains in the RPC.
    filtered = filtered.filter(s => {
      const geo = s.service_area_geojson;
      if (!geo) return true; // no polygon → keep
      return pointInPolygon(lng, lat, geo);
    });

    // Hydrate recommenders so ResultsScreen + PDP can render avatars.
    if (filtered.length) {
      const recoMap = await fetchRecommendersByServiceId(filtered.map(s => s.id));
      filtered = filtered.map(s => ({ ...s, recommenders: recoMap[s.id] || [] }));
    }
    return { data: filtered, error: null };
  }

  // Plain branch. Prefer taxonomy_offering_id when given — exact targeted
  // match against either the service or one of its offerings. Otherwise
  // fall back to the legacy text-category ilike.
  let q = supabase
    .from('services')
    .select(`
      id, title, category, description, location_text, photo_class, cover_url,
      rating_avg, rating_count, bookings_count, owner_id, created_at,
      taxonomy_category, taxonomy_provider_type, taxonomy_offering_id,
      offerings ( id, name, kind, price_cents, duration_minutes, is_default, taxonomy_offering_id )
    `)
    .eq('status', 'listed')
    .order('created_at', { ascending: false })
    .limit(limit);

  // CERGIO-GUARD: matching is INCLUSIVE — every signal we have (parser
  // offering_id, provider_type, category, AND the user's raw words)
  // contributes OR clauses. Previously the code used else-if so once
  // offering_id was set, the other signals never ran — and since the
  // parser returned offering_ids that the seeded services don't carry
  // (e.g. parser says "HOME-CLEAN-002" but services have null), every
  // search came back empty. The stem-text fallback from originalQuery
  // is the safety net: "Housekeeper" → stem "House" matches "House
  // Cleaner"; "plumber" → stem "plumb" matches "Plumbing"; etc.
  const orClauses = collectMatchOrClauses({
    offering_id, provider_type, category, originalQuery,
  });
  if (orClauses.length > 0) {
    q = q.or(orClauses.join(','));
  }
  const res = await q;
  if (offering_id && res.data) {
    res.data = res.data.filter(s =>
      s.taxonomy_offering_id === offering_id ||
      (s.offerings || []).some(o => o.taxonomy_offering_id === offering_id)
    );
  }
  // CERGIO-GUARD: apply budget + free filters client-side. The
  // offerings join is already loaded so the filter is cheap.
  if (res.data) {
    res.data = applyMatchingFilters(res.data, { maxBudgetCents, freeOnly, originalQuery });
  }
  // Hydrate recommenders so ResultsScreen + PDP can render avatars.
  if (res.data && res.data.length > 0) {
    const recoMap = await fetchRecommendersByServiceId(res.data.map(s => s.id));
    res.data = res.data.map(s => ({ ...s, recommenders: recoMap[s.id] || [] }));
  }
  return res;
}

// Shared post-query filter + relevance sort so both the proximity branch
// and the plain branch behave identically.
//   - freeOnly  → at least one $0 offering
//   - maxBudgetCents → cheapest offering fits the budget
//   - originalQuery → relevance score (count of distinct stem hits in
//     title/description/category), descending. Resolves the "personal
//     chef" returning both Marcus + Tasha issue — Marcus matches BOTH
//     'personal' and 'chef' (score 2), Tasha matches only 'personal'
//     (score 1), so Marcus ranks first.
function applyMatchingFilters(rows, { maxBudgetCents, freeOnly, originalQuery, preferOfferingId } = {}) {
  let out = rows;
  if (freeOnly) {
    out = out.filter(s => (s.offerings || []).some(o => (o.price_cents ?? 0) === 0));
  }
  if (maxBudgetCents != null && maxBudgetCents > 0) {
    out = out.filter(s => {
      const prices = (s.offerings || []).map(o => o.price_cents ?? 0).filter(p => p >= 0);
      if (prices.length === 0) return true; // unknown — don't exclude
      const min = Math.min(...prices);
      return min <= maxBudgetCents;
    });
  }
  // CERGIO-GUARD: scoring is INCLUSIVE — every signal we have boosts
  // a row up the list. Nothing here filters rows out (filtering happens
  // above via budget/free toggles). originalQuery + preferOfferingId
  // are both BOOSTS only. This is the OR-not-AND philosophy that keeps
  // a perfectly seeded row from disappearing because the parser used
  // a synonym the row doesn't carry.
  const stems = (() => {
    if (!originalQuery) return [];
    const tokens = String(originalQuery).toLowerCase().match(/[a-z]+/g) ?? [];
    const meaningful = tokens.filter(t => t.length >= 4 && !MATCH_STOPWORDS.has(t));
    return [...new Set(meaningful.map(stemTerm))];
  })();
  if (stems.length > 0 || preferOfferingId) {
    const scoreOne = (s) => {
      let n = 0;
      // +10 per stem hit on title/description/category — drives the
      // user's raw words straight to the top.
      if (stems.length > 0) {
        const hay = [
          s.title, s.description, s.category,
          s.taxonomy_category, s.taxonomy_provider_type,
        ].filter(Boolean).join(' ').toLowerCase();
        for (const st of stems) if (hay.includes(st)) n += 10;
      }
      // +50 if the parser's offering_id matches this service OR any
      // of its offerings — a strong but not exclusive signal.
      if (preferOfferingId) {
        if (s.taxonomy_offering_id === preferOfferingId) n += 50;
        else if ((s.offerings || []).some(o => o.taxonomy_offering_id === preferOfferingId)) n += 50;
      }
      return n;
    };
    out = out
      .map(s => ({ s, score: scoreOne(s) }))
      .sort((a, b) => b.score - a.score)
      .map(o => o.s);
  }
  return out;
}

// CERGIO-GUARD: build the PostgREST `.or()` clause list. Every signal
// contributes — there is NO else-if. The stem function below trims to
// 5 chars so "Housekeeper" matches "House Cleaner" and "plumber" matches
// "Plumbing". Stopword + length filters keep the OR clause length sane.
const MATCH_STOPWORDS = new Set([
  'a','an','the','of','for','to','in','on','and','or','at','my','i','need','want',
  'looking','find','book','hire','get','some','please','this','that','it','help',
  'service','services','someone','people','can','will','do','near','around','from',
  'with','my','your','our','their',
  // Time-ish words that aren't service terms:
  'today','tomorrow','tonight','sunday','monday','tuesday','wednesday','thursday',
  'friday','saturday','this','next','week','month','weekend','morning','afternoon',
  'evening','night','noon','midnight','am','pm','flexible','any','anytime',
  // Budget-ish:
  'under','over','max','maximum','minimum','min','budget','dollars','usd','bucks','cash',
  'free','cheap','affordable','expensive','quote','quoted','about','around',
  // Address-ish:
  'home','house','apartment','apt','street','avenue','road','drive','blvd','suite',
  'unit','floor','near','close','distance',
]);
function safeIlike(s) {
  return String(s ?? '').replace(/[,()*&|!]/g, ' ').trim();
}
function stemTerm(t) {
  const s = String(t).toLowerCase();
  // 5-char stem matches both 'plumber'/'plumbing', 'cleaner'/'cleaning'.
  return s.length > 5 ? s.slice(0, 5) : s;
}
function collectMatchOrClauses({ offering_id, provider_type, category, originalQuery }) {
  const clauses = [];
  const fields = [
    'title', 'description', 'category',
    'taxonomy_category', 'taxonomy_provider_type',
  ];
  const pushStemClauses = (term) => {
    const stem = stemTerm(safeIlike(term));
    if (!stem || stem.length < 3) return;
    for (const f of fields) clauses.push(`${f}.ilike.%${stem}%`);
  };

  if (offering_id) {
    // Exact match on services.taxonomy_offering_id. Embedded-table
    // filtering through or() is brittle in PostgREST, so we also
    // re-filter the offerings array client-side after the SELECT.
    clauses.push(`taxonomy_offering_id.eq.${safeIlike(offering_id)}`);
  }
  if (provider_type) pushStemClauses(provider_type);
  if (category)      pushStemClauses(category);

  if (originalQuery) {
    const tokens = String(originalQuery).toLowerCase().match(/[a-z]+/g) ?? [];
    const meaningful = tokens.filter(t => t.length >= 4 && !MATCH_STOPWORDS.has(t));
    const stems = new Set();
    for (const t of meaningful) stems.add(stemTerm(t));
    for (const s of stems) {
      if (!s || s.length < 3) continue;
      for (const f of fields) clauses.push(`${f}.ilike.%${s}%`);
    }
  }

  // Cap to keep the URL under ~2KB — Supabase rejects very long or()
  // strings. With 5 fields × ~5 stems we're already at ~25 clauses,
  // which is fine. Hard cap for paranoia.
  return clauses.slice(0, 60);
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

// CERGIO-GUARD: the user_addresses table comes from
// supabase/migrations/20260526000000_user_addresses.sql. On deployments
// that haven't applied that migration, Supabase returns a schema-cache
// "relation does not exist" error. We detect that signature in BOTH
// getters and writers below and swallow it (data: null, error: null)
// so the address chip falls back gracefully to localStorage instead of
// throwing red toasts. The console.warn surfaces the diagnosis once.
function isMissingAddressesTable(err) {
  if (!err) return false;
  const m = (err.message || '') + ' ' + (err.details || '') + ' ' + (err.hint || '');
  return /user_addresses|relation .* does not exist|schema cache/i.test(m);
}
let warnedMissingAddresses = false;
function logMissingAddresses(where, err) {
  if (warnedMissingAddresses) return;
  warnedMissingAddresses = true;
  // eslint-disable-next-line no-console
  console.warn(`[${where}] user_addresses table missing — apply migration 20260526000000_user_addresses.sql via Run Migrations.command. Falling back to localStorage-only address persistence. (${err?.message || 'no message'})`);
}

/**
 * Fetch the user's default address.
 *
 * CERGIO-GUARD: this is the PERMANENT source of truth. We store the
 * default address inside Supabase auth user_metadata (always exists
 * for any signed-in user, no migration needed). The user_addresses
 * table is a NICE-TO-HAVE for multi-address lists once migration
 * 20260526000000 lands, but the default address persists either way.
 *
 * Read order:
 *   1. user.user_metadata.default_address  ← bulletproof, this is the canon
 *   2. user_addresses fallback              ← only if migration applied AND
 *                                              metadata didn't already have it
 *
 * Shape returned matches the prior user_addresses row shape so existing
 * callers in HomeScreen don't need to change.
 */
export async function getDefaultAddress() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };

  // 1. user_metadata path (canonical). Survives logouts/logins because
  //    Supabase auth keeps user_metadata across sessions.
  const meta = userRes.user.user_metadata?.default_address;
  if (meta?.formatted_address) {
    return {
      data: {
        id:                meta.id || 'meta',
        formatted_address: meta.formatted_address,
        lat:               meta.lat ?? null,
        lng:               meta.lng ?? null,
        place_id:          meta.place_id ?? null,
        label:             meta.label || 'Home',
        is_default:        true,
      },
      error: null,
    };
  }

  // 2. Fallback to user_addresses table (only if migration applied).
  const { data, error } = await supabase
    .from('user_addresses')
    .select('*')
    .eq('profile_id', userRes.user.id)
    .eq('is_default', true)
    .maybeSingle();
  if (isMissingAddressesTable(error)) {
    // Table not migrated yet — totally fine, metadata path is the
    // primary one. Quiet log so we still know if it stays missing.
    logMissingAddresses('getDefaultAddress', error);
    return { data: null, error: null };
  }
  return { data, error };
}

/**
 * Save a Google-validated address.
 *
 * CERGIO-GUARD: writes the default address to TWO places:
 *   1. supabase.auth.updateUser({ data: { default_address: {...} } })
 *      → guaranteed to persist (user_metadata always exists in auth.users).
 *        This is the PERMANENT path — survives any schema state.
 *   2. user_addresses table (if migration applied)
 *      → enables the future multi-address list. Failures here are
 *        non-fatal because path 1 already succeeded.
 *
 * Returns success as long as path 1 succeeded — so the chip shows
 * "Saved ✓" reliably even before any migration runs.
 */
export async function saveAddress({ label, formattedAddress, lat, lng, placeId, makeDefault = false } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to save an address.' } };
  }
  const uid = userRes.user.id;

  // ─── Path 1: bulletproof user_metadata write ──────────────────────────
  // This ALWAYS works for any signed-in user — no table required.
  //
  // CERGIO-GUARD (2026-07-14, launch-06 — THE ADDRESS THAT VANISHED OVERNIGHT):
  // this function's own docblock promises "returns success as long as path 1
  // succeeded". The code did not honour that in EITHER direction:
  //   • A path-1 FAILURE was only console.warn'd, then path 2's missing-table
  //     branch returned `{ error: null }` — i.e. the app reported SAVED while
  //     NOTHING had persisted server-side. The address lived only in
  //     localStorage, and the next storage eviction / other device / other
  //     browser lost it. That is precisely "saved last night, gone this
  //     morning": no server row ever existed to restore from.
  //   • A path-2 error (RLS, constraint, anything not a missing table) MASKED a
  //     perfectly good path-1 write and surfaced "Server sync failed" for an
  //     address that was, in fact, durably saved.
  // Both are fixed by tracking whether the durable write actually landed, and
  // telling the truth about it. `persisted` is the honest signal for callers.
  let metaOk = false;
  const metaRow = makeDefault ? {
    id:                'meta',
    formatted_address: formattedAddress,
    lat:               lat ?? null,
    lng:               lng ?? null,
    place_id:          placeId ?? null,
    label:             label || 'Home',
    is_default:        true,
  } : null;

  if (makeDefault) {
    const metaPayload = {
      formatted_address: formattedAddress,
      lat:     lat ?? null,
      lng:     lng ?? null,
      place_id: placeId ?? null,
      label:   label || 'Home',
      saved_at: new Date().toISOString(),
    };
    const { error: metaErr } = await supabase.auth.updateUser({
      data: { default_address: metaPayload },
    });
    if (metaErr) {
      // eslint-disable-next-line no-console
      console.warn('[saveAddress] user_metadata write failed:', metaErr.message);
    } else {
      metaOk = true; // the address is now DURABLE — it survives storage clears.
    }
  }

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

  // Schema-cache miss (table not yet migrated): the metadata path is the
  // canonical store anyway, so this is only fatal if path 1 ALSO failed.
  if (isMissingAddressesTable(error)) {
    logMissingAddresses('saveAddress', error);
    if (metaOk) return { data: metaRow, error: null, persisted: 'metadata' };
    return {
      data: null,
      persisted: 'none',
      error: { message: 'Could not save your address — you may be signed out. Sign in and try again.' },
    };
  }
  // A real table error (RLS / constraint / network) must NOT mask a durable
  // path-1 write. If the address is safely in user_metadata, this succeeded.
  if (error) {
    if (metaOk) return { data: metaRow, error: null, persisted: 'metadata' };
    return { data: null, error, persisted: 'none' };
  }

  if (shouldBeDefault) {
    await supabase.rpc('set_default_address', { target_id: data.id });
    data.is_default = true;
  }
  return { data, error: null, persisted: metaOk ? 'metadata+table' : 'table' };
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

// ─── Request responses (MARKETPLACE_SPEC Step 1, 2026-06-03) ────────────────
// A provider's confirmed offer on an open consumer request. Each row
// represents ONE provider responding to ONE request with ONE service —
// status='offered' (took the asking price), 'countered' (added a price),
// 'declined' (passed), 'withdrawn' (changed their mind), 'accepted'
// (consumer picked them), or 'expired' (broadcast hit the 60-min cap).
//
// RLS (enforced by the migration, mirrored here for documentation):
//   • Request owner (the consumer) SELECTs all responses on their request.
//   • Responder (the provider) SELECTs / INSERTs / UPDATEs their own row.
//   • No one else can read these rows — open offers are private.

/**
 * Provider writes a response to an open request.
 * @param {string} requestId  — the request being responded to
 * @param {Object} opts
 * @param {'offered' | 'countered' | 'declined' | 'withdrawn'} opts.status
 * @param {string} [opts.serviceId]      — the provider's own service
 *                                          fulfilling this offer (optional)
 * @param {number} [opts.offeredPriceCents] — null = accept at asking price;
 *                                            >0 = counter at this amount
 * @param {string} [opts.message]        — free-form note to the consumer
 * @param {number} [opts.waveN]          — broadcast wave the responder is in
 *                                          (set by the wave dispatcher in
 *                                          a later step; null on direct
 *                                          provider-side accept).
 *
 * Idempotent — upserts on the unique (request_id, responder_id,
 * service_id) tuple so re-clicks don't duplicate. If a previous
 * row exists, status / price / message overwrite.
 *
 * Returns { data, error }.
 */
export async function respondToRequest(requestId, {
  status,
  serviceId         = null,
  offeredPriceCents = null,
  message           = null,
  waveN             = null,
} = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!requestId) return { data: null, error: { message: 'requestId required' } };
  if (!['offered', 'countered', 'declined', 'withdrawn'].includes(status)) {
    return { data: null, error: { message: 'invalid status' } };
  }
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  const uid = userRes.user.id;

  // Time-to-offer telemetry — used by rank_results for time-decay
  // weighting (MARKETPLACE_SPEC § 6 Q3). Best-effort; if the request
  // lookup fails we still write the row without it.
  let timeToOfferSeconds = null;
  try {
    const { data: req } = await supabase
      .from('requests')
      .select('created_at')
      .eq('id', requestId)
      .maybeSingle();
    if (req?.created_at) {
      timeToOfferSeconds = Math.max(
        0,
        Math.floor((Date.now() - new Date(req.created_at).getTime()) / 1000),
      );
    }
  } catch { /* ignore — telemetry is optional */ }

  const row = {
    request_id:            requestId,
    responder_id:          uid,
    service_id:            serviceId,
    status,
    offered_price_cents:   offeredPriceCents,
    message:               (message || '').slice(0, 1000) || null,
    last_counter_by:       status === 'countered' ? 'provider' : null,
    time_to_offer_seconds: timeToOfferSeconds,
    wave_n:                waveN,
    responded_at:          new Date().toISOString(),
  };

  const res = await supabase
    .from('request_responses')
    .upsert(row, { onConflict: 'request_id,responder_id,service_id' })
    .select()
    .maybeSingle();
  // CERGIO-GUARD (2026-06-12): notify the REQUESTER that a provider
  // accepted/countered — email + SMS + in-app notifications row via the
  // notify-request edge fn. This is the "info@cergio.ai accepted but
  // t@cergio.ai never got a confirm" fix on the delivery side.
  if (!res.error && res.data?.id && ['offered', 'countered'].includes(status)) {
    fireRequestNotify({ event: 'response', responseId: res.data.id });
  }
  return res;
}

/**
 * Provider accepts a free-service request AND picks a time → a CONFIRMED booking
 * at that time (Tarik 2026-06-16). Goes through the accept_request_with_time
 * SECURITY DEFINER RPC (the provider creates the booking on the Connector's
 * behalf). Either party can reschedule afterwards. Returns { bookingId }.
 */
export async function acceptRequestWithTime({ requestId, serviceId, scheduledAt } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!requestId || !serviceId) return { data: null, error: { message: 'A listed service is required to accept.' } };
  const { data, error } = await supabase.rpc('accept_request_with_time', {
    p_request_id:  requestId,
    p_service_id:  serviceId,
    p_scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  });
  if (error) return { data: null, error };
  // CERGIO-GUARD (2026-06-18, Tarik): notify the requester their request was
  // accepted + confirmed. This path creates a booking directly (no
  // request_response row), so without this fire the consumer got no email/SMS.
  if (data) fireBookingNotify(data, 'accepted');
  return { data: { bookingId: data }, error: null };
}

/** Either party reschedules a confirmed booking (the "change the time together"
 *  half of accept-with-time). Updates scheduled_at + notifies the other side. */
export async function rescheduleBooking(bookingId, when) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId || !when) return { data: null, error: { message: 'Pick a new time.' } };
  const res = await supabase
    .from('bookings')
    .update({
      scheduled_at:          new Date(when).toISOString(),
      schedule_confirmed_at: new Date().toISOString(),
      updated_at:            new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select()
    .maybeSingle();
  if (!res.error && res.data?.id) fireBookingNotify(bookingId, 'rescheduled');
  return res;
}

/**
 * List every confirmed response on a request. The request owner sees
 * all rows; a responder only sees their own. Caller is expected to be
 * the consumer who posted the request (called from ResultsScreen).
 *
 * Joins the responder profile + service so the consumer card can
 * render the provider's name + service title without an extra fetch.
 */
export async function listResponsesForRequest(requestId, { limit = 50 } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!requestId) return { data: [], error: null };
  return await supabase
    .from('request_responses')
    .select(`
      id, request_id, responder_id, service_id, status,
      offered_price_cents, message, responded_at, last_counter_by,
      time_to_offer_seconds, wave_n,
      responder:profiles!request_responses_responder_id_fkey ( id, display_name, cc_verified_at ),
      service:services ( id, title, category, taxonomy_provider_type,
                         description, location_text, photo_class, cover_url )
    `)
    .eq('request_id', requestId)
    .in('status', ['offered', 'countered', 'accepted'])
    .order('responded_at', { ascending: true })
    .limit(limit);
}

/**
 * Consumer counters a provider's offer — writes status='countered' and
 * stamps last_counter_by='consumer' so the UI knows it's the provider's
 * turn again. Mirrors the spotlight counter loop.
 */
export async function counterRequestResponse(responseId, {
  offeredPriceCents,
  message = null,
} = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!responseId) return { data: null, error: { message: 'responseId required' } };
  return await supabase
    .from('request_responses')
    .update({
      status:              'countered',
      offered_price_cents: Math.max(0, Math.round(+offeredPriceCents || 0)),
      message:             (message || '').slice(0, 1000) || null,
      last_counter_by:     'consumer',
      responded_at:        new Date().toISOString(),
    })
    .eq('id', responseId)
    .select()
    .maybeSingle();
}

/**
 * Consumer picks one of the confirmed responses — flips that row to
 * 'accepted' and withdraws every other open response on the same
 * request in one transaction-ish update pair. Returns the chosen row.
 */
export async function acceptRequestResponse(responseId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!responseId) return { data: null, error: { message: 'responseId required' } };

  // 1. Accept the chosen row.
  const { data: chosen, error: acceptErr } = await supabase
    .from('request_responses')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', responseId)
    .select('id, request_id')
    .maybeSingle();
  if (acceptErr || !chosen) return { data: null, error: acceptErr };

  // 2. Withdraw all other open offers on the same request.
  await supabase
    .from('request_responses')
    .update({ status: 'withdrawn', responded_at: new Date().toISOString() })
    .eq('request_id', chosen.request_id)
    .neq('id', chosen.id)
    .in('status', ['offered', 'countered']);

  return { data: chosen, error: null };
}

/**
 * Provider-side: list open consumer requests this provider should
 * respond to. Filters to requests whose taxonomy_provider_type the
 * provider matches via at least one of their listed services AND
 * which the provider hasn't already responded to.
 *
 * Returns rows shaped { id, service_type, description, location_text,
 * created_at, requester:{id, display_name}, my_service_id }
 * — `my_service_id` is the provider's matching service so the inbox
 * card knows what to attach when respondToRequest fires.
 */
/**
 * CERGIO-GUARD (2026-06-03): Follow / unfollow + relationship lookup.
 * The `network` table is the canonical graph (follower_id, followed_id).
 * Per Tarik 2026-06-03 a "follow" makes the target the equivalent of
 * a friend in downstream feed filters + reco surfaces — regardless of
 * whether they're a Connector, a service provider, or a regular user.
 */
export async function followProfile(targetId) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  if (!targetId) return { data: null, error: { message: 'targetId required' } };
  if (targetId === userRes.user.id) {
    return { data: null, error: { message: "Can't follow yourself" } };
  }
  const { data, error } = await supabase
    .from('network')
    .insert({ follower_id: userRes.user.id, followed_id: targetId })
    .select()
    .maybeSingle();
  // Treat duplicate-key as success — idempotent follow.
  if (error && /duplicate|unique/i.test(error.message)) {
    return { data: { follower_id: userRes.user.id, followed_id: targetId }, error: null };
  }
  return { data, error };
}

export async function unfollowProfile(targetId) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  if (!targetId) return { data: null, error: { message: 'targetId required' } };
  return await supabase
    .from('network')
    .delete()
    .eq('follower_id', userRes.user.id)
    .eq('followed_id', targetId);
}

export async function amIFollowing(targetId) {
  if (!supabaseReady) return { data: false, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: false, error: null };
  if (!targetId || targetId === userRes.user.id) return { data: false, error: null };
  const { data, error } = await supabase
    .from('network')
    .select('follower_id', { head: false })
    .eq('follower_id', userRes.user.id)
    .eq('followed_id', targetId)
    .limit(1);
  return { data: !!(data && data.length > 0), error };
}

/**
 * CERGIO-GUARD (2026-06-13): Mutual connections between the signed-in user
 * and `otherId`, over the canonical `network` graph (Tarik flow board —
 * "friends in common with the Connector requesting the service").
 *
 * A connection counts in EITHER direction (a follow OR a follower edge),
 * so "mutual" = any profile X that both the signed-in user and `otherId`
 * are linked to, regardless of who followed whom. This matches the
 * intent: shared people across the network (mutual friends, follows,
 * recos all resolve to network edges).
 *
 * Returns { data: { count, connectors, sample: [{id,name,is_connector,
 * initial}] }, error }. count is the total number of mutuals; sample is
 * a capped slice (default 3) for avatar/name rendering; connectors is how
 * many of the mutuals are verified Connectors. No fake data: when the
 * graph yields nothing, count is 0 and sample is [] (caller hides block).
 */
export async function getMutualConnections(otherId, { sampleLimit = 3 } = {}) {
  if (!supabaseReady) return { data: { count: 0, connectors: 0, sample: [] }, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  const meId = userRes?.user?.id || null;
  if (!meId || !otherId || meId === otherId) {
    return { data: { count: 0, connectors: 0, sample: [] }, error: null };
  }

  // All edges touching a given user → set of the OTHER endpoints.
  const endpointsFor = async (uid) => {
    const { data, error } = await supabase
      .from('network')
      .select('follower_id, followed_id')
      .or(`follower_id.eq.${uid},followed_id.eq.${uid}`);
    if (error) return { ids: new Set(), error };
    const ids = new Set();
    for (const r of data || []) {
      const other = r.follower_id === uid ? r.followed_id : r.follower_id;
      if (other && other !== uid) ids.add(other);
    }
    return { ids, error: null };
  };

  const mine  = await endpointsFor(meId);
  if (mine.error)  return { data: { count: 0, connectors: 0, sample: [] }, error: mine.error };
  const theirs = await endpointsFor(otherId);
  if (theirs.error) return { data: { count: 0, connectors: 0, sample: [] }, error: theirs.error };

  // Intersection, excluding the two endpoints themselves.
  const mutualIds = [...mine.ids].filter(id => theirs.ids.has(id) && id !== meId && id !== otherId);
  if (mutualIds.length === 0) {
    return { data: { count: 0, connectors: 0, sample: [] }, error: null };
  }

  const { data: profs, error } = await supabase
    .from('profiles')
    .select('id, display_name, cc_verified_at')
    .in('id', mutualIds);
  if (error) return { data: { count: 0, connectors: 0, sample: [] }, error };

  const named = (profs || []).filter(p => (p.display_name || '').trim().length > 0);
  const connectors = named.filter(p => !!p.cc_verified_at).length;
  // Surface Connectors first in the sample — they carry more signal.
  const sample = named
    .sort((a, b) => (b.cc_verified_at ? 1 : 0) - (a.cc_verified_at ? 1 : 0))
    .slice(0, sampleLimit)
    .map(p => ({
      id:           p.id,
      name:         p.display_name.trim(),
      is_connector: !!p.cc_verified_at,
      initial:      (p.display_name.trim()[0] || '?').toUpperCase(),
    }));

  return { data: { count: mutualIds.length, connectors, sample }, error: null };
}

/**
 * CERGIO-GUARD (2026-06-04): invite lifecycle counters per Tarik —
 * "where's the friend count and services invited VS Join". Returns
 * { invited, joined, booked } pulled from invites table timestamps.
 * Used by the EarningsScreen ReferralsSummary header.
 */
export async function getMyInviteCounts() {
  if (!supabaseReady) return { data: { invited: 0, joined: 0, booked: 0 }, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: { invited: 0, joined: 0, booked: 0 }, error: null };
  const { data, error } = await supabase
    .from('invites')
    .select('id, joined_at, first_booking_at')
    .eq('inviter_id', userRes.user.id);
  if (error) return { data: { invited: 0, joined: 0, booked: 0 }, error };
  const rows = data || [];
  const invited = rows.length;
  const joined  = rows.filter(r => r.joined_at).length;
  const booked  = rows.filter(r => r.first_booking_at).length;
  return { data: { invited, joined, booked }, error: null };
}

/**
 * CERGIO-GUARD (2026-06-04): list every invite the signed-in user
 * has sent, with the joined invitee profile (when present) hydrated.
 * Used by the InviteTrackingScreen / Earnings → Invites surface.
 * Returns rows shaped:
 *   {
 *     id, invitee_phone, invitee_email, invitee_id,
 *     invited_at, joined_at, first_booking_at, reward_cents,
 *     invitee: { id, display_name } | null
 *   }
 */
export async function getMyInvitesDetailed({ limit = 100 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const { data, error } = await supabase
    .from('invites')
    .select(`
      id, invitee_phone, invitee_email, invitee_id,
      invited_at, joined_at, first_booking_at, reward_cents,
      invitee:profiles!invites_invitee_id_fkey ( id, display_name )
    `)
    .eq('inviter_id', userRes.user.id)
    .order('invited_at', { ascending: false })
    .limit(limit);
  if (error) {
    // If the join syntax errors out (older PG schema), fall through to a
    // bare select so the screen still renders names from the lookup.
    const bare = await supabase
      .from('invites')
      .select('id, invitee_phone, invitee_email, invitee_id, invited_at, joined_at, first_booking_at, reward_cents')
      .eq('inviter_id', userRes.user.id)
      .order('invited_at', { ascending: false })
      .limit(limit);
    return { data: bare.data || [], error: bare.error };
  }
  return { data: data || [], error: null };
}

// ────────────────────────────────────────────────────────────────────────
// CERGIO-GUARD (2026-06-05): Reco tracking + invite context.
// Tarik: "clicking on # of reco's should show the reco's made and ability
// to edit them" + "don't see how to track invite with type of service
// added and nudge — per UX video at 2:32".
//
// The recommendations table stores rows shaped:
//   id, recommender_id, recipient_id|recipient_phone, service_id, message, sent_at
//
// When the user reco'd a NEW service-provider (no service_id), the
// RecommendServiceFormScreen submit path persists message as
//   `[ServiceType] blurb`
// so we can parse the service-type label back out for display. When a
// service_id IS set, the joined service row carries title +
// taxonomy_provider_type and we use that directly.
//
// Three helpers below are tightly scoped to this UX surface:
//   listMyRecommendations  → rows for the user's Recos tracking screen
//   updateRecommendation   → patch message (rebuild [Type] prefix)
//   deleteRecommendation   → remove a row
// ────────────────────────────────────────────────────────────────────────

/**
 * Parses "[ServiceType] free-form blurb" → { service_type_label, body }.
 * When the prefix isn't present the body is returned verbatim and
 * service_type_label is null.
 */
function splitRecoMessage(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (m) return { service_type_label: m[1].trim(), body: m[2].trim() };
  return { service_type_label: null, body: s };
}

/**
 * Builds the persisted message string from a label + body, matching the
 * shape RecommendServiceFormScreen.submit() writes.
 */
function joinRecoMessage(label, body) {
  const lbl = String(label || '').trim();
  const txt = String(body || '').trim();
  if (!lbl) return txt;
  return `[${lbl}] ${txt}`;
}

/**
 * List recommendations sent by the current user, hydrated with the
 * recipient profile (when invitee_id is set) and service title +
 * provider taxonomy (when service_id is set). Falls back gracefully to
 * just the raw row when joins fail so the screen still renders.
 *
 * Each returned row is shaped:
 *   {
 *     id, sent_at, raw_message,
 *     service_type_label,   // "[Plumber]" prefix or service.taxonomy
 *     body,                 // blurb without the prefix
 *     recipient: { id?, display_name?, phone? },
 *     service:   { id, title, taxonomy_provider_type, category } | null,
 *   }
 */
export async function listMyRecommendations({ limit = 100 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };

  // Step 1: pull recommendation rows authored by me.
  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, recipient_id, recipient_phone, service_id, message, sent_at')
    .eq('recommender_id', userRes.user.id)
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error || !recs?.length) return { data: [], error: error || null };

  // Step 2: hydrate recipient profiles (when we have ids).
  const rIds = [...new Set(recs.map(r => r.recipient_id).filter(Boolean))];
  let recipientMap = {};
  if (rIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', rIds);
    recipientMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  }

  // Step 3: hydrate referenced services (when we have ids).
  const sIds = [...new Set(recs.map(r => r.service_id).filter(Boolean))];
  let svcMap = {};
  if (sIds.length > 0) {
    const { data: svcs } = await supabase
      .from('services')
      .select('id, title, category, taxonomy_provider_type')
      .in('id', sIds);
    svcMap = Object.fromEntries((svcs || []).map(s => [s.id, s]));
  }

  // Step 4: shape rows.
  const rows = recs.map(r => {
    const parsed = splitRecoMessage(r.message);
    const svc = r.service_id ? svcMap[r.service_id] : null;
    // Service-type label resolution priority: explicit service taxonomy →
    // service title → parsed [Type] prefix from the persisted message.
    const labelFromService =
      svc?.taxonomy_provider_type || svc?.title || null;
    return {
      id:                 r.id,
      sent_at:            r.sent_at,
      raw_message:        r.message || '',
      service_type_label: labelFromService || parsed.service_type_label,
      body:               parsed.body,
      recipient: {
        id:           r.recipient_id || null,
        display_name: recipientMap[r.recipient_id]?.display_name || null,
        phone:        r.recipient_phone || null,
      },
      service: svc ? {
        id:                     svc.id,
        title:                  svc.title,
        taxonomy_provider_type: svc.taxonomy_provider_type || null,
        category:               svc.category || null,
      } : null,
    };
  });
  return { data: rows, error: null };
}

/**
 * Patch the message on a recommendation owned by the current user.
 * If `service_type_label` is provided, the persisted message is rebuilt
 * as `[Label] body`; otherwise body is written as-is. RLS already pins
 * updates to recommender_id = auth.uid().
 */
export async function updateRecommendation(id, { body, service_type_label } = {}) {
  if (!supabaseReady || !id) return { error: new Error('not ready') };
  const message = joinRecoMessage(service_type_label, body);
  const { error } = await supabase
    .from('recommendations')
    .update({ message })
    .eq('id', id);
  return { error: error || null };
}

/**
 * Hard-delete a recommendation row. Confirmation is handled inline in
 * the UI (armed → confirm pattern, no window.confirm) — this helper
 * just removes the row. RLS pins delete to recommender_id = auth.uid().
 */
export async function deleteRecommendation(id) {
  if (!supabaseReady || !id) return { error: new Error('not ready') };
  const { error } = await supabase
    .from('recommendations')
    .delete()
    .eq('id', id);
  return { error: error || null };
}

/**
 * CERGIO-GUARD (2026-06-17, Tarik): recommend an ON-PLATFORM service from its
 * page. Unlike the invite/reco form (which recommends a free-text type to a
 * friend and stores service_id=null), this writes a recommendation LINKED to a
 * real service_id — so it shows on the provider's profile ("People who love")
 * AND the recommender's Go-Tos. `review` is the recommender's blurb. RLS pins
 * recommender_id = auth.uid().
 */
export async function recommendService(serviceId, { review = '' } = {}) {
  if (!supabaseReady) return { error: new Error('not ready') };
  if (!serviceId) return { error: new Error('missing service') };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { error: new Error('not signed in') };
  const { data, error } = await supabase
    .from('recommendations')
    .insert({
      recommender_id: userRes.user.id,
      service_id:     serviceId,
      message:        (review || '').trim() || null,
    })
    .select('id')
    .maybeSingle();
  // CERGIO-GUARD (2026-06-18, Tarik): notify the service owner they were
  // recommended/rated — the notify-user edge fn already has a
  // `service_recommended` template, but recommendService never fired it (so the
  // provider got no email/SMS, only the in-app dot). Best-effort, never blocks.
  if (!error && data?.id) {
    try {
      const { data: svc } = await supabase
        .from('services')
        .select('owner_id, title')
        .eq('id', serviceId)
        .maybeSingle();
      if (svc?.owner_id && svc.owner_id !== userRes.user.id) {
        notifyUser({
          event: 'service_recommended',
          recipient: svc.owner_id,
          data: { service_id: serviceId, service_title: svc.title || null, recommender_id: userRes.user.id },
        });
      }
    } catch { /* best-effort — never block the rating */ }
  }
  return { data: data || null, error: error || null };
}

/**
 * CERGIO-GUARD (2026-06-05): invite → reco service-type bridge.
 *
 * The `invites` table has no service_type column (pure referral
 * tracking), but when a user invited a friend through the Reco flow we
 * wrote a row to `recommendations` for the same inviter+recipient. This
 * helper joins the two so the InviteTrackingScreen can render
 * "Reco'd as Plumber" alongside each invite row.
 *
 * Matching is done by:
 *   1. recommendations.recipient_id   = invites.invitee_id
 *   2. recommendations.recipient_phone = invites.invitee_phone (digits)
 *
 * Returns a map keyed by invite id → { service_type_label } so callers
 * can lookup in O(1) while rendering rows.
 */
export async function getInviteServiceContexts(invites) {
  if (!supabaseReady || !Array.isArray(invites) || invites.length === 0) {
    return { data: {}, error: null };
  }
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: {}, error: null };

  // Pull all my recos once and lookup locally — far fewer than N
  // round-trips and easier to keep in sync with listMyRecommendations.
  const { data: myRecos } = await listMyRecommendations({ limit: 500 });
  const byPhone = {};
  const byProfile = {};
  for (const r of (myRecos || [])) {
    const label = r.service_type_label;
    if (!label) continue;
    if (r.recipient.phone) {
      const digits = String(r.recipient.phone).replace(/[^\d]/g, '');
      if (digits) byPhone[digits] = byPhone[digits] || label;
    }
    if (r.recipient.id) {
      byProfile[r.recipient.id] = byProfile[r.recipient.id] || label;
    }
  }

  const out = {};
  for (const inv of invites) {
    if (inv.invitee_id && byProfile[inv.invitee_id]) {
      out[inv.id] = { service_type_label: byProfile[inv.invitee_id] };
      continue;
    }
    if (inv.invitee_phone) {
      const digits = String(inv.invitee_phone).replace(/[^\d]/g, '');
      if (digits && byPhone[digits]) {
        out[inv.id] = { service_type_label: byPhone[digits] };
      }
    }
  }
  return { data: out, error: null };
}

/**
 * CERGIO-GUARD (2026-06-04): public network-impact stats for any
 * profile (not just self). Used by PublicProfileScreen's "By the
 * numbers" block — Tarik 2026-06-04: "need # of friends invited
 * (or services reco'd) and joined and services on users profiles
 * prominently so they track their networks". Returns counts only
 * (no $ amounts — those stay on the self-view via getMyEarnings).
 *
 * Falls back to 0 on RLS errors so the UI stays honest.
 */
export async function getPublicProfileStats(profileId) {
  const empty = { invited: 0, joined: 0, booked: 0, recommended: 0, recosReceived: 0, networkCount: 0, listedServices: 0, services: [], serviceNames: [] };
  if (!supabaseReady || !profileId) return { data: empty, error: null };

  // Owned services first — need their ids for per-service reco counts.
  const { data: svcs } = await supabase
    .from('services')
    .select('id, title, taxonomy_provider_type, category')
    .eq('owner_id', profileId)
    .eq('status', 'listed');
  const ownedIds = (svcs || []).map(s => s.id).filter(Boolean);

  const [invitesRes, recosMadeRes, recRowsRes, netRes] = await Promise.all([
    supabase
      .from('invites')
      .select('id, joined_at, first_booking_at')
      .eq('inviter_id', profileId),
    // Reco's MADE — this profile recommended others.
    supabase
      .from('recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('recommender_id', profileId),
    // Reco's RECEIVED — fetched per service so we can show a count next to each.
    ownedIds.length
      ? supabase.from('recommendations').select('service_id').in('service_id', ownedIds)
      : Promise.resolve({ data: [], error: null }),
    // Cergio network — friends/connections this profile follows on the platform.
    supabase.from('network').select('id', { count: 'exact', head: true }).eq('follower_id', profileId),
  ]);
  const recRows = recRowsRes.data || [];
  const recoBySvc = {};
  for (const r of recRows) recoBySvc[r.service_id] = (recoBySvc[r.service_id] || 0) + 1;
  // One entry per DISTINCT service name, summing reco counts across duplicates.
  const svcAgg = {};
  for (const s of (svcs || [])) {
    const name = s.taxonomy_provider_type || s.category || s.title;
    if (!name) continue;
    svcAgg[name] = (svcAgg[name] || 0) + (recoBySvc[s.id] || 0);
  }
  const services = Object.entries(svcAgg).map(([name, recos]) => ({ name, recos }));
  const serviceNames = services.map(s => s.name);

  const invites = invitesRes.data || [];
  const joined        = invites.filter(r => r.joined_at).length;
  const recommended   = recosMadeRes.error ? 0 : (recosMadeRes.count || 0);
  const recosReceived = recRows.length;
  const follows       = netRes.error ? 0 : (netRes.count || 0);
  return {
    data: {
      invited:         invites.length,
      joined,
      booked:          invites.filter(r => r.first_booking_at).length,
      recommended,                 // reco's made
      recosReceived,               // received on owned services
      follows,
      // "Network on Cergio" (Tarik 2026-06-14): composite of registered
      // invites + reco's made + reco's received + follows.
      networkCount:    joined + recommended + recosReceived + follows,
      listedServices:  services.length,
      services,
      serviceNames,
    },
    error: null,
  };
}

/**
 * Re-stamp an invite so it bumps to the top of the tracking screen
 * and (via a server cron, in a follow-up) re-fires the SMS/WhatsApp
 * nudge to the invitee. Today this is a UI-only re-send marker —
 * the actual outbound message is sent client-side via the
 * WhatsApp / SMS share intent on the row.
 */
export async function bumpInvite(inviteId) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  return await supabase
    .from('invites')
    .update({ invited_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('inviter_id', userRes.user.id);
}

/**
 * Return the set of profile ids the signed-in user follows. Used to
 * compute is_friend on the social feed + reco surfaces.
 */
export async function getMyFollowedIds() {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const { data, error } = await supabase
    .from('network')
    .select('followed_id')
    .eq('follower_id', userRes.user.id);
  if (error) return { data: [], error };
  return { data: (data || []).map(r => r.followed_id), error: null };
}

// CERGIO-GUARD (2026-06-17, Tarik — SPEC-49c): the signed-in viewer's FULL
// network — every profile id connected to them in either direction (they
// follow OR are followed by). Used by the unified profile to flag which
// recommenders on a service are people the VIEWER already knows ("mutuals
// with the viewer"), the trust signal Tarik wants surfaced on every
// recommended service. Returns a plain array of ids; signed-out → [].
export async function getMyNetworkIds() {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  const meId = userRes?.user?.id || null;
  if (!meId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('network')
    .select('follower_id, followed_id')
    .or(`follower_id.eq.${meId},followed_id.eq.${meId}`);
  if (error) return { data: [], error };
  const ids = new Set();
  for (const r of data || []) {
    const other = r.follower_id === meId ? r.followed_id : r.follower_id;
    if (other && other !== meId) ids.add(other);
  }
  return { data: [...ids], error: null };
}

/**
 * CERGIO-GUARD (2026-06-13): fetch ONE open request by id for the
 * dedicated connector-request screen (the screen a provider opens from
 * "New requests near you"). Pulls the full job fields the screen renders
 * — when_text / scheduled_at, location, free flag, budget — plus the
 * requester's profile (Connector status + IG handle/followers) so the
 * screen can show connector status, the IG block, and friends-in-common
 * without a second profile fetch. All real columns; nothing synthesized.
 */
// CERGIO-GUARD (2026-06-13): a "Connector" is anyone with an audience big
// enough to barter social reach for a free service. Tarik 2026-06-13: the
// launch threshold is 300 followers, read from the user-entered IG count
// (live IG verification isn't approved yet). Post-launch this rises to
// 3000, OR a profile is accepted manually via the future admin module
// (which stamps cc_verified_at). Connector status drives BOTH the
// Connector badge AND the free-barter framing — a request FROM a Connector
// is a free service ↔ social-reach exchange, not a paid job.
export const CONNECTOR_MIN_FOLLOWERS = 300;
export function isConnectorProfile(p) {
  if (!p) return false;
  if (p.cc_verified_at) return true;  // manually accepted (admin module)
  const followers = Number(p.instagram_followers ?? p.follower_count ?? 0);
  return followers >= CONNECTOR_MIN_FOLLOWERS;
}

/**
 * A Connector's previous IG spotlights (Tarik 2026-06-15): confirmed free-barter
 * bookings they completed that carry a post URL. Powers the "Previous spotlights"
 * track record on the frame-3 connector-request screen + their profile. Real
 * post links only (tappable IG tiles); no fabricated media (SPEC-12).
 */
/**
 * CERGIO-GUARD (2026-06-18, Tarik): sent_at times of recommendations RECEIVED on
 * the signed-in user's own services. Powers the Inbox dot — when someone
 * recommends you (a 4★+ rate writes a recommendation, SPEC-53), the provider
 * gets a notification dot. Read-only; empty on signed-out / no services / error.
 */
export async function recoTimesOnMyServices({ limit = 50 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const { data: svcs } = await supabase
    .from('services')
    .select('id')
    .eq('owner_id', userRes.user.id);
  const ids = (svcs || []).map(s => s.id);
  if (!ids.length) return { data: [], error: null };
  const { data } = await supabase
    .from('recommendations')
    .select('sent_at')
    .in('service_id', ids)
    .order('sent_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error: null };
}

/**
 * listRecosOnMyServices — recommendations RECEIVED on the signed-in user's
 * services, hydrated with recommender name + service title. Powers the
 * "You were recommended" item in the Inbox Overview so the reco dot
 * (useInboxUnread → recoTimesOnMyServices) has somewhere to land instead of
 * dead-ending (SPEC-67b, Tarik 2026-06-24). Two-step (no FK-name embed) so it
 * works across environments. Read-only; empty on signed-out / no services.
 */
export async function listRecosOnMyServices({ limit = 10, sinceDays = 45 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const { data: svcs } = await supabase
    .from('services')
    .select('id, title')
    .eq('owner_id', userRes.user.id);
  const svcMap = Object.fromEntries((svcs || []).map(s => [s.id, s.title]));
  const ids = Object.keys(svcMap);
  if (!ids.length) return { data: [], error: null };
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: recs, error } = await supabase
    .from('recommendations')
    .select('id, message, sent_at, service_id, recommender_id')
    .in('service_id', ids)
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };
  // Hydrate recommender display names in one follow-up query.
  const recIds = [...new Set((recs || []).map(r => r.recommender_id).filter(Boolean))];
  let nameMap = {};
  if (recIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', recIds);
    nameMap = Object.fromEntries((profs || []).map(p => [p.id, p.display_name]));
  }
  return {
    data: (recs || []).map(r => ({
      id:               r.id,
      message:          r.message || null,
      sent_at:          r.sent_at,
      service_id:       r.service_id,
      service_title:    svcMap[r.service_id] || 'your service',
      recommender_id:   r.recommender_id || null,
      recommender_name: nameMap[r.recommender_id] || 'Someone',
    })),
    error: null,
  };
}

export async function getConnectorSpotlights(connectorId, { limit = 6 } = {}) {
  if (!supabaseReady || !connectorId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('bookings')
    .select('id, post_url, post_confirmed_at, posted_at, service:services(title)')
    .eq('consumer_id', connectorId)
    .eq('is_free_for_rainmaker', true)
    .not('post_url', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };
  return {
    data: (data || []).map(b => ({ id: b.id, post_url: b.post_url, title: b.service?.title || 'spotlight' })),
    error: null,
  };
}

export async function getInboundRequest(reqId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!reqId) return { data: null, error: { message: 'reqId required' } };
  return await supabase
    .from('requests')
    .select(`
      id, service_type, category, description, what, query, when_text, scheduled_at,
      location_text, lat, lng, is_free_for_rainmaker, budget_cents,
      status, created_at,
      requester:profiles!requests_requester_id_fkey
        ( id, display_name, headline, bio, instagram_handle, instagram_followers, tiktok_handle, tiktok_followers, cc_verified_at )
    `)
    .eq('id', reqId)
    .maybeSingle();
}

// ─── Pre-booking Q&A on a request (provider asks the requester) ──────────────
// CERGIO-GUARD (2026-06-14): lets a provider ask follow-up questions BEFORE
// accepting (who buys ingredients, pay food costs upfront, send a list…).
// Backed by request_questions (RLS: asker + request owner only).

const Q_COLS = 'id, request_id, asker_id, body, reply, created_at, replied_at';

export async function askRequestQuestion(requestId, body) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  const text = (body || '').trim().slice(0, 600);
  if (!requestId || !text) return { data: null, error: { message: 'question required' } };
  const res = await supabase
    .from('request_questions')
    .insert({ request_id: requestId, asker_id: userRes.user.id, body: text })
    .select(Q_COLS)
    .maybeSingle();
  if (!res.error && res.data?.id) fireRequestNotify({ event: 'question', questionId: res.data.id, requestId });
  return res;
}

/** The signed-in user's profile display name (for greeting them by name). */
export async function getMyDisplayName() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return { data: null, error: null };
  const { data } = await supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle();
  return { data: data?.display_name || null, error: null };
}

export async function listRequestQuestions(requestId) {
  if (!supabaseReady || !requestId) return { data: [], error: null };
  return await supabase
    .from('request_questions')
    .select(Q_COLS)
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });
}

/** Questions asked on the signed-in user's OWN requests (for them to answer). */
export async function listMyRequestQuestions() {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return { data: [], error: null };
  const { data: myReqs } = await supabase.from('requests').select('id, service_type').eq('requester_id', uid);
  const reqIds = (myReqs || []).map(r => r.id);
  if (!reqIds.length) return { data: [], error: null };
  const { data: qs, error } = await supabase
    .from('request_questions')
    .select(Q_COLS)
    .in('request_id', reqIds)
    .order('created_at', { ascending: false });
  if (error) return { data: [], error };
  const askerIds = [...new Set((qs || []).map(q => q.asker_id).filter(Boolean))];
  let profMap = {};
  if (askerIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', askerIds);
    profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  }
  const svcMap = Object.fromEntries((myReqs || []).map(r => [r.id, r.service_type]));
  return {
    data: (qs || []).map(q => ({
      ...q,
      askerName: profMap[q.asker_id]?.display_name || 'A provider',
      serviceType: svcMap[q.request_id] || null,
    })),
    error: null,
  };
}

export async function replyRequestQuestion(questionId, reply) {
  if (!supabaseReady) return NOT_WIRED;
  const text = (reply || '').trim().slice(0, 600);
  if (!questionId || !text) return { data: null, error: { message: 'reply required' } };
  const res = await supabase
    .from('request_questions')
    .update({ reply: text, replied_at: new Date().toISOString() })
    .eq('id', questionId)
    .select('id, reply, replied_at')
    .maybeSingle();
  if (!res.error && res.data?.id) fireRequestNotify({ event: 'question_reply', questionId });
  return res;
}

export async function listInboundRequests({ limit = 20 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const uid = userRes.user.id;

  // 1. What services does this provider have listed?
  //    Pull taxonomy_provider_type AND category + title as fallbacks for
  //    providers whose listing pre-dates taxonomy resolution.
  const { data: mySvcs, error: svcErr } = await supabase
    .from('services')
    .select('id, taxonomy_provider_type, category, title')
    .eq('owner_id', uid)
    .eq('status', 'listed');
  if (svcErr) return { data: [], error: svcErr };
  if (!mySvcs || mySvcs.length === 0) return { data: [], error: null };

  // Build lookup: exact taxonomy match first; fall back to category/title.
  const myTypes = [...new Set(mySvcs.map(s => s.taxonomy_provider_type).filter(Boolean))];
  // Also collect categories for the fallback query.
  const myCategories = [...new Set(mySvcs.map(s => s.category).filter(Boolean))];

  // Map service_type/category string → service id for the card's CTA.
  const typeToSvc = {};
  for (const s of mySvcs) {
    const key = s.taxonomy_provider_type || s.category || s.title;
    if (key && !typeToSvc[key]) typeToSvc[key] = s.id;
  }
  // Catch-all: if no key matched, any service works for the Accept CTA.
  const fallbackSvcId = mySvcs[0]?.id || null;

  // 2. Pull open requests.
  //    Window: 24 h (was 60 min — too short for realistic testing and
  //    providers who check intermittently). Status must be 'pending'.
  const windowMs  = 24 * 60 * 60 * 1000;
  const windowISO = new Date(Date.now() - windowMs).toISOString();

  // Build OR filter: match on service_type (taxonomy) OR category.
  // When taxonomy_provider_type is set we get exact matches; when it's
  // null we fall through to category so providers without taxonomy data
  // still see relevant requests.
  let query = supabase
    .from('requests')
    .select(`
      id, service_type, category, description, location_text, created_at,
      requester:profiles!requests_requester_id_fkey ( id, display_name )
    `)
    .eq('status', 'pending')
    .gte('created_at', windowISO)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (myTypes.length > 0 && myCategories.length > 0) {
    // Match on either taxonomy type OR category.
    query = query.or(
      `service_type.in.(${myTypes.map(t => `"${t}"`).join(',')}),` +
      `category.in.(${myCategories.map(c => `"${c}"`).join(',')})`,
    );
  } else if (myTypes.length > 0) {
    query = query.in('service_type', myTypes);
  } else if (myCategories.length > 0) {
    query = query.in('category', myCategories);
  }
  // If neither is set just fetch recent pending requests — better than
  // showing nothing to a provider who skipped taxonomy resolution.

  const { data: reqs, error: reqErr } = await query;
  if (reqErr) return { data: [], error: reqErr };

  // 3. Drop requests I've already responded to.
  if (reqs && reqs.length > 0) {
    const { data: mine } = await supabase
      .from('request_responses')
      .select('request_id')
      .eq('responder_id', uid)
      .in('request_id', reqs.map(r => r.id));
    const skip = new Set((mine || []).map(r => r.request_id));
    return {
      data: reqs
        .filter(r => !skip.has(r.id))
        .map(r => ({
          ...r,
          my_service_id:
            typeToSvc[r.service_type] ||
            typeToSvc[r.category]     ||
            fallbackSvcId,
        })),
      error: null,
    };
  }
  return { data: [], error: null };
}

/**
 * CERGIO-GUARD (2026-06-12): consumer-side request visibility.
 * Tarik: "t@cergio.ai didn't get a confirm that info@cergio.ai
 * confirmed" — the requester had NO surface showing provider
 * responses once they left /results. This lists the signed-in
 * user's own posted requests (last 7 days) with every confirmed
 * response joined, so JobsInboxScreen can render "{provider}
 * accepted your {service_type} request".
 *
 * RLS: request owner reads all response rows on their request
 * (same policy listResponsesForRequest relies on).
 */
export async function listMyRequestsWithResponses({ limit = 20 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const uid = userRes.user.id;

  const windowISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('requests')
    .select(`
      id, service_type, category, description, location_text, status, created_at,
      responses:request_responses (
        id, status, offered_price_cents, message, responded_at, last_counter_by,
        responder:profiles!request_responses_responder_id_fkey ( id, display_name ),
        service:services ( id, title, taxonomy_provider_type )
      )
    `)
    .eq('requester_id', uid)
    .gte('created_at', windowISO)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { data: [], error };

  // Only surface meaningful responses; keep declined/withdrawn out of
  // the requester's face. Sort responses newest-first.
  return {
    data: (data || []).map(r => ({
      ...r,
      responses: (r.responses || [])
        .filter(resp => ['offered', 'countered', 'accepted'].includes(resp.status))
        .sort((a, b) => new Date(b.responded_at || 0) - new Date(a.responded_at || 0)),
    })),
    error: null,
  };
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

/**
 * Broadcast a FREE spotlight request to matching Connectors — the provider-side
 * mirror of createRequestAndNotify (a consumer posts a service request, we fan
 * out, they wait for offers). Tarik 2026-06-14: the provider-asks-for-a-
 * spotlight flow must be IDENTICAL to the connector-asks-for-a-free-service
 * flow — broadcast, then "we'll notify you when they respond / cancel."
 *
 * Inserts one pending spotlight_requests row per matching Connector so each
 * sees it inbound and can offer / counter / decline. official_price_cents = 0
 * → this is a free-swap ask (the Connector may counter with a price). Skips
 * Connectors who already have a live request from this provider so a
 * re-broadcast can't duplicate. Fires notify-spotlight (created) best-effort.
 */
export async function broadcastSpotlightRequest({ serviceId = null, message = null, limit = 40 } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { data: null, error: { message: 'You must be signed in to request a spotlight.' } };
  }
  const me = userRes.user.id;

  // Matching Connectors = profiles with at least one social handle (the same
  // pool the roster shows), excluding the requester. NULL rate = free-swap only.
  const { data: pool, error: poolErr } = await supabase
    .from('profiles')
    .select('id, instagram_handle, tiktok_handle')
    .or('instagram_handle.not.is.null,tiktok_handle.not.is.null')
    .neq('id', me)
    .limit(limit);
  if (poolErr) return { data: null, error: poolErr };
  if (!pool || pool.length === 0) return { data: { count: 0 }, error: null };

  // Don't double-send: skip Connectors who already have a live request from
  // this provider (any non-terminal status).
  const { data: existing } = await supabase
    .from('spotlight_requests')
    .select('connector_id')
    .eq('provider_id', me)
    .in('status', ['pending', 'offered', 'countered', 'accepted']);
  const already = new Set((existing || []).map(r => r.connector_id));

  const rows = pool
    .filter(c => !already.has(c.id))
    .map(c => ({
      provider_id:          me,
      connector_id:         c.id,
      service_id:           serviceId,
      platform:             c.instagram_handle ? 'instagram' : 'tiktok',
      official_price_cents: 0,
      message:              (message || '').slice(0, 2000) || null,
      status:               'pending',
    }));
  if (rows.length === 0) return { data: { count: 0 }, error: null };

  const res = await supabase.from('spotlight_requests').insert(rows).select('id');
  if (res.error) return { data: null, error: res.error };
  // Best-effort fan-out notify (never awaited, never blocks the UI).
  for (const r of (res.data || [])) fireSpotlightNotify(r.id, 'created');

  // CERGIO-GUARD (2026-06-18, Tarik): on-demand INFLUENCER expansion. If we have
  // no influencer coverage for this service's CITY, enqueue a crawl (5 best
  // adjacent, 10k–200k). Best-effort + city-scoped; idempotent via the dedupe
  // index. Wrapped so a missing leads_influencers column never breaks broadcast.
  if (serviceId) {
    try {
      const { data: svc } = await supabase
        .from('services')
        .select('location_text, lat, lng, taxonomy_provider_type, category')
        .eq('id', serviceId)
        .maybeSingle();
      const city = svc?.location_text || null;
      if (city) {
        const cityKey = city.split(',')[0].trim();
        const { count, error: cErr } = await supabase
          .from('leads_influencers')
          .select('id', { count: 'exact', head: true })
          .ilike('city', `%${cityKey}%`);
        if (!cErr && (count || 0) === 0) {
          enqueueCityCrawl({
            kind: 'influencers', city, lat: svc?.lat ?? null, lng: svc?.lng ?? null,
            serviceType: svc?.taxonomy_provider_type || svc?.category || null,
            targetCount: 5,
          }).catch(() => {});
        }
      }
    } catch { /* leads_influencers may lack a city column — skip the trigger */ }
  }

  return { data: { count: (res.data || []).length }, error: null };
}

/**
 * My OFFERS on others' free-service requests that are awaiting the requester to
 * pick a time (two-step barter, SPEC-47). Tarik 2026-06-15: after a provider
 * accepts a request it sits as an offer with no date — surface it as "Awaiting
 * schedule" so it isn't lost until the requester books a time (→ Upcoming).
 */
export async function listMySentOffers({ limit = 30 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const uid = userRes.user.id;

  const { data: resp, error } = await supabase
    .from('request_responses')
    .select('id, request_id, status, offered_price_cents, responded_at')
    .eq('responder_id', uid)
    .in('status', ['offered', 'countered'])
    .order('responded_at', { ascending: false })
    .limit(limit);
  if (error || !resp?.length) return { data: [], error };

  const reqIds = [...new Set(resp.map(r => r.request_id).filter(Boolean))];
  const { data: reqs } = await supabase
    .from('requests')
    .select('id, service_type, category, requester_id, when_text, scheduled_at, status')
    .in('id', reqIds);
  const reqMap = Object.fromEntries((reqs || []).map(r => [r.id, r]));
  const requesterIds = [...new Set((reqs || []).map(r => r.requester_id).filter(Boolean))];
  let profMap = {};
  if (requesterIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', requesterIds);
    profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  }

  const rows = resp.map(r => {
    const req = reqMap[r.request_id] || {};
    return {
      id:                r.id,
      requestId:         r.request_id,
      status:            r.status,
      offeredPriceCents: r.offered_price_cents,
      serviceType:       req.service_type || req.category || 'service',
      requesterId:       req.requester_id || null,
      requesterName:     profMap[req.requester_id]?.display_name || 'A user',
      whenText:          req.when_text || null,
      scheduledAt:       req.scheduled_at || null,
      respondedAt:       r.responded_at,
    };
  });
  return { data: rows, error: null };
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
 *  Joins service + provider profile so the InboundCard can:
 *   • show "spotlight for {service title}" + provider taxonomy_provider_type
 *     (for the friendly "Jane is offering you a free Personal Trainer
 *     session in return for an IG post" rewrite — CERGIO-GUARD 2026-06-05).
 *   • route the row to /u/{provider_id} on tap (Tarik 2026-06-05: each
 *     spotlight row should drill into the service provider's profile,
 *     not stay locked on the dense rate-card row).
 *
 *  Provider lookup happens in two passes so the join doesn't tie the
 *  whole query to a single foreign key (spotlight_requests.provider_id
 *  may or may not have a strict FK on every environment).
 */
export async function listMyInboundSpotlightRequests({ limit = 50 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const { data: rows, error } = await supabase
    .from('spotlight_requests')
    .select('*, service:services(id, title, category, taxonomy_provider_type, owner_id)')
    .eq('connector_id', userRes.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !rows?.length) return { data: rows || [], error };

  const providerIds = [...new Set(rows.map(r => r.provider_id).filter(Boolean))];
  if (providerIds.length === 0) return { data: rows, error: null };
  const { data: provProfs } = await supabase
    .from('profiles')
    .select('id, display_name, headline, bio')
    .in('id', providerIds);
  const provMap = Object.fromEntries((provProfs || []).map(p => [p.id, p]));

  // Service reputation per provider — the Connector decides on a spotlight by
  // the provider's quality (services + reco's RECEIVED), not their IG reach.
  const { data: provSvcs } = await supabase
    .from('services')
    .select('id, owner_id, title, taxonomy_provider_type, category')
    .in('owner_id', providerIds)
    .eq('status', 'listed');
  const svcIds = (provSvcs || []).map(s => s.id);
  const recoBySvc = {};
  if (svcIds.length) {
    const { data: recRows } = await supabase.from('recommendations').select('service_id').in('service_id', svcIds);
    for (const r of recRows || []) recoBySvc[r.service_id] = (recoBySvc[r.service_id] || 0) + 1;
  }
  const repByProvider = {};
  for (const s of (provSvcs || [])) {
    const name = s.taxonomy_provider_type || s.category || s.title;
    if (!name) continue;
    const rep = (repByProvider[s.owner_id] ||= { services: {}, recosReceived: 0 });
    rep.services[name] = (rep.services[name] || 0) + (recoBySvc[s.id] || 0);
    rep.recosReceived += (recoBySvc[s.id] || 0);
  }

  const hydrated = rows.map(r => {
    const rep = repByProvider[r.provider_id];
    return {
      ...r,
      provider: provMap[r.provider_id] || null,
      providerServices: rep ? Object.entries(rep.services).map(([name, recos]) => ({ name, recos })) : [],
      providerRecosReceived: rep ? rep.recosReceived : 0,
    };
  });
  return { data: hydrated, error: null };
}

/**
 * CERGIO-GUARD (2026-06-14): one inbound spotlight request by id, hydrated with
 * the provider's SERVICE reputation (services + reco's received + bio) — the
 * Connector decides on a spotlight by the provider's quality, not their reach.
 * Powers the dedicated spotlight-request detail screen (/spotlight/:id).
 */
export async function getSpotlightRequest(id) {
  if (!supabaseReady) return NOT_WIRED;
  if (!id) return { data: null, error: { message: 'id required' } };
  const { data: r, error } = await supabase
    .from('spotlight_requests')
    .select('*, service:services(id, title, category, taxonomy_provider_type, owner_id)')
    .eq('id', id)
    .maybeSingle();
  if (error || !r) return { data: null, error };

  const pid = r.provider_id;
  let provider = null, providerServices = [], providerRecosReceived = 0;
  if (pid) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, display_name, headline, bio, instagram_handle, instagram_followers, tiktok_handle, tiktok_followers, cc_verified_at')
      .eq('id', pid).maybeSingle();
    provider = prof || null;
    const { data: svcs } = await supabase
      .from('services')
      .select('id, title, taxonomy_provider_type, category')
      .eq('owner_id', pid).eq('status', 'listed');
    const svcIds = (svcs || []).map(s => s.id);
    const recoBySvc = {};
    if (svcIds.length) {
      const { data: recRows } = await supabase.from('recommendations').select('service_id').in('service_id', svcIds);
      for (const rr of recRows || []) recoBySvc[rr.service_id] = (recoBySvc[rr.service_id] || 0) + 1;
    }
    const agg = {};
    for (const s of (svcs || [])) {
      const name = s.taxonomy_provider_type || s.category || s.title;
      if (!name) continue;
      agg[name] = (agg[name] || 0) + (recoBySvc[s.id] || 0);
      providerRecosReceived += (recoBySvc[s.id] || 0);
    }
    providerServices = Object.entries(agg).map(([name, recos]) => ({ name, recos }));
  }
  return { data: { ...r, provider, providerServices, providerRecosReceived }, error: null };
}

/**
 * Glanceable "key counts" for a set of profile ids — the other party on each
 * inbox card. Tarik 2026-06-15: surface mutual friends · network on Cergio ·
 * reco's · IG/TikTok reach right in the inbox so a Connector/provider can
 * judge a request without opening it. Inbox lists are small (≤20), so a
 * per-id fan-out for network/mutuals is fine; followers come from one batched
 * read. Returns { [id]: { networkCount, recosMade, recosReceived, igFollowers,
 * ttFollowers, mutualCount } }.
 */
export async function getInboxPartyCounts(ids = []) {
  if (!supabaseReady) return { data: {}, error: null };
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return { data: {}, error: null };

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, instagram_followers, tiktok_followers, cc_verified_at')
    .in('id', unique);
  const followerMap = Object.fromEntries((profs || []).map(p => [p.id, p]));

  const entries = await Promise.all(unique.map(async (id) => {
    const [statsRes, mutRes] = await Promise.all([
      getPublicProfileStats(id),
      getMutualConnections(id),
    ]);
    const s = statsRes?.data || {};
    const m = mutRes?.data || {};
    const f = followerMap[id] || {};
    return [id, {
      networkCount:  s.networkCount || 0,
      recosMade:     s.recommended || 0,
      recosReceived: s.recosReceived || 0,
      igFollowers:   f.instagram_followers || 0,
      ttFollowers:   f.tiktok_followers || 0,
      mutualCount:   m.count || 0,
      // Connector flag so cards can lead with the badge (Tarik 2026-06-15 rule:
      // a service viewing a Connector leads with the Connector badge).
      isConnector:   isConnectorProfile(f),
    }];
  }));
  return { data: Object.fromEntries(entries), error: null };
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

/** Fetch offerings for an existing service by ID. Used by
 *  ServiceListMoreOfferingsScreen when editing an already-published
 *  service (instead of reading from the in-memory listingDraft). */
export async function getServiceOfferings(serviceId) {
  if (!supabaseReady || !serviceId) return { data: [], error: null };
  return await supabase
    .from('offerings')
    .select('id, name, description, kind, price, duration_minutes')
    .eq('service_id', serviceId)
    .order('created_at', { ascending: true });
}

/** Create a Stripe SetupIntent for the signed-in user (creates Customer if
 *  missing). Returns { client_secret, customer_id } for the frontend to
 *  feed into Stripe Elements' confirmSetup. */
export async function createSetupIntent() {
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase.functions.invoke('create-setup-intent', { body: {} });
  if (error) return { data: null, error };
  return { data, error: null };
}

// CERGIO-GUARD (2026-06-19, Tarik): test accounts bypass the credit-card
// identity gate (post / request / listing / photos) — they're treated as
// verified without a real card so QA isn't blocked. Single source of truth, so
// EVERY gate that reads getMyCcStatus honors it.
export const IDENTITY_BYPASS_EMAILS = ['t@cergio.ai', 'info@cergio.ai'];
export function isIdentityBypassEmail(email) {
  return IDENTITY_BYPASS_EMAILS.includes(String(email || '').trim().toLowerCase());
}

// SPEC-63: admin allowlist — who can see the Admin → Crawls dashboard.
export const ADMIN_EMAILS = ['t@cergio.ai', 'info@cergio.ai'];
export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').trim().toLowerCase());
}

/** SPEC-63: live crawl + outreach dashboard data (admin-only; the edge fn
 *  re-checks admin server-side). Returns health, queue, stalled/failed/empty,
 *  recent requests, and the leads funnel. */
export async function getAdminCrawlStatus() {
  if (!supabaseReady) return { data: null, error: NOT_WIRED.error };
  const { data, error } = await supabase.functions.invoke('admin-crawl-status', { body: {} });
  if (error) return { data: null, error };
  return { data, error: null };
}

/** Read the signed-in user's CC verification state. */
export async function getMyCcStatus() {
  if (!supabaseReady) return { data: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: null };
  // Test-account bypass — verified without a card (see IDENTITY_BYPASS_EMAILS).
  if (isIdentityBypassEmail(userRes.user.email)) {
    return { data: { stripe_customer_id: null, cc_verified_at: '2000-01-01T00:00:00Z', cc_bypass: true }, error: null };
  }
  return await supabase
    .from('profiles')
    .select('stripe_customer_id, cc_verified_at')
    .eq('id', userRes.user.id)
    .maybeSingle();
}

/** Claim-profile flow (2026-06-26): attach pending recommendations made to the
 *  signed-in user's PHONE (recipient_phone, recipient_id NULL) to their account.
 *  Server-side, phone-matched (claim_recommendations RPC). Returns { data: N }. */
export async function claimRecommendations() {
  if (!supabaseReady) return { data: 0, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: 0, error: null };
  const { data, error } = await supabase.rpc('claim_recommendations');
  return { data: data ?? 0, error: error || null };
}

/** Optimistic flip — frontend calls this after stripe.confirmSetup succeeds
 *  for a snappy UX. The CANONICAL flip is the setup_intent.succeeded webhook
 *  (stripe-webhook), which sets cc_verified_at server-side once Stripe confirms
 *  a real chargeable card. Both are idempotent. */
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
 * Read the signed-in user's earnings ledger (bookings + spotlights + invite
 * referrals merged). Returns rows ordered by occurred_at desc, capped at
 * `limit`. Each row has { id, kind, source_id, amount_cents, currency,
 * status, occurred_at, meta }.
 *
 * CERGIO-GUARD (2026-06-03): the real earnings table column is
 * `occurred_at`, not `created_at`. Previous version selected/ordered by
 * `created_at` and PostgREST silently 400'd → t@cergio.ai's Earnings
 * screen showed $0 even though the ledger had $838 in invite payouts.
 *
 * Aliased to `created_at` in the returned shape so EarningsScreen and
 * other consumers don't have to know the underlying column name.
 */
export async function getMyEarnings({ limit = 50, kind } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  let q = supabase
    .from('earnings')
    .select('id, kind, source_id, amount_cents, currency, status, occurred_at, meta')
    .eq('profile_id', userRes.user.id)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (kind) q = q.eq('kind', kind);
  const res = await q;
  if (res.data) {
    // Backwards-compat: expose occurred_at as created_at so existing UI
    // (EarningsScreen ledger row formatter) doesn't have to change.
    res.data = res.data.map(r => ({ ...r, created_at: r.occurred_at }));
  }
  return res;
}

/**
 * Quick earnings summary for motivation surfaces (Tarik 2026-06-15): total
 * EARNED (paid/released) vs PENDING across the ledger. Spotlight + referral
 * earnings are what the Connector grows by posting, so this is shown at the
 * post moment + on the inbox Overview.
 */
export async function getMyEarningsSummary() {
  const { data, error } = await getMyEarnings({ limit: 500 });
  if (error) return { data: { earnedCents: 0, pendingCents: 0 }, error };
  let earnedCents = 0, pendingCents = 0;
  for (const r of (data || [])) {
    const c = r.amount_cents || 0;
    // 'cleared' = settled/available (provider booking share + referral credit
    // once the booking is paid). Was missing here, so referral + provider
    // earnings showed as perpetually pending (Tarik 2026-06-26).
    if (['paid', 'released', 'completed', 'confirmed', 'cleared'].includes(r.status)) earnedCents += c;
    else pendingCents += c;
  }
  return { data: { earnedCents, pendingCents }, error: null };
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

/** CERGIO-GUARD (2026-06-12): fire-and-forget call to notify-request edge
 *  function — email/SMS for (a) request fan-out → providers and (b) provider
 *  response → requester. Tarik: "need to receive an sms and email ... of
 *  these (connector requesting and service accepting)". Never awaits or
 *  surfaces errors — the DB rows are what matters, delivery is best-effort.
 *  NOTE: email delivery to arbitrary users stays blocked until the
 *  cergio.ai domain is verified in Resend (sandbox sender restriction). */
function fireRequestNotify(payload) {
  const app_url = typeof window !== 'undefined' ? window.location.origin : undefined;
  supabase.functions
    .invoke('notify-request', { body: { ...payload, app_url } })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[notify-request] best-effort send failed', err);
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

/**
 * createRequestAndFanOut — the WRITE SIDE of the search money flow.
 * Called once when a consumer's chat parser hits phase='ready' (Home).
 *
 *   1. INSERT a `requests` row anchoring the open search (consumer_id +
 *      provider_type + lat/lng + raw query + parser fields). This is the
 *      id every notification + bid + first-booking credit hangs off.
 *   2. Find matching providers via getProvidersForNotify() (RLS-safe).
 *      Refuses to fan out without notifySafe + verifiedProviderType + coords.
 *   3. For each matched service.owner_id, INSERT a notifications row with
 *      kind='new_request' + data.deep_link (Cergio /results?req=<id>) +
 *      data.request_id (so useRequestActivity polls the right rows on the
 *      SRP).
 *
 * Returns { request, notified, error }. Best-effort fan-out — a failed
 * notification insert for one provider doesn't block the others. The
 * caller (HomeScreen) uses `request.id` to seed chat.state.request_id so
 * the SRP status ticker reads live counts via useRequestActivity.
 *
 * CERGIO-GUARD: the only place in the app that may write to
 * notifications with kind='new_request'. Locked by qa #28.
 */
/**
 * CERGIO-GUARD (2026-06-18, Tarik): ON-DEMAND CITY EXPANSION. When a request
 * lands in a city we have NO matching data for, enqueue a crawl_request so the
 * separate crawler service sources + onboards the best providers (10 nearest)
 * or influencers (5 adjacent, 10k–200k). The app NEVER crawls itself
 * (CRAWLER_BRIEF.md). Best-effort + idempotent: the DB partial-unique index
 * dedupes OPEN rows per (kind, city, service_type), so a duplicate insert is a
 * benign "already queued".
 */
export async function enqueueCityCrawl({
  kind, city = null, state = null, lat = null, lng = null,
  serviceType = null, targetCount = null, triggerRequestId = null,
  source = null,
} = {}) {
  if (!supabaseReady) return { data: null, error: null };
  if (kind !== 'services' && kind !== 'influencers') {
    return { data: null, error: { message: 'enqueueCityCrawl: bad kind' } };
  }
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id || null;
  if (!uid) return { data: null, error: null }; // RLS requires requested_by = self
  // CERGIO-GUARD (2026-07-15, SPEC-72 free-first): on-demand SERVICES crawls now
  // source from OpenStreetMap/Overpass (keyless, free) — NOT the paid, billing-
  // blocked Google Places API. fulfill-crawl drains source='osm' via Overpass and
  // returns ~20 matches fast. Influencer crawls keep their own pipeline (source
  // stays null; fulfill-crawl only handles kind='services').
  const src = source || (kind === 'services' ? 'osm' : null);
  const res = await supabase
    .from('crawl_requests')
    .insert({
      kind,
      city, state, lat, lng,
      service_type: serviceType,
      target_count: targetCount || (kind === 'influencers' ? 5 : 10),
      trigger_request_id: triggerRequestId,
      requested_by: uid,
      status: 'new',
      source: src,
    })
    .select('id')
    .maybeSingle();
  // Open crawl already queued for this city+kind+type → benign dedupe.
  if (res.error && /duplicate|unique/i.test(res.error.message || '')) {
    return { data: { deduped: true }, error: null };
  }
  return res;
}

export async function createRequestAndFanOut({
  query,
  provider_type,
  category,
  what,
  when_text,
  where_text,
  lat, lng,
  budget_cents,
  notifySafe,
  radiusMiles = 25,
} = {}) {
  if (!supabaseReady) return { request: null, notified: 0, error: NOT_WIRED.error };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) {
    return { request: null, notified: 0, error: { message: 'sign-in required to create a request' } };
  }
  const uid = userRes.user.id;

  // CERGIO-GUARD (2026-07-14, QA live walk — DUPLICATE REQUESTS): one submit
  // wrote TWO identical `requests` rows 753ms apart (verified live: two
  // "Electrician …" rows at 16:08:04.127 and 16:08:04.880). Same class as the
  // SPEC-60 duplicate-listings bug, same fix: before inserting, return any
  // PENDING request this user already made with the SAME query in the last 2
  // minutes — idempotent no matter how the caller fires (re-rendered effect,
  // double-tap, retry). Fan-out is skipped for the dupe: the first row already
  // notified the providers, so re-fanning would double-notify them.
  {
    const since = new Date(Date.now() - 120000).toISOString();
    const { data: dupes } = await supabase
      .from('requests')
      .select('*')
      .eq('requester_id', uid)
      .eq('status', 'pending')
      .eq('query', (query || '').slice(0, 500))
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (dupes && dupes.length) {
      return { request: dupes[0], notified: 0, error: null, deduped: true };
    }
  }

  // 1) Anchor the search as a real row so notifications + bids can
  //    point at it. RLS check (`auth.uid()=requester_id`) is satisfied
  //    by the insert payload.
  // CERGIO-GUARD (2026-05-28): the requests table already exists (per
  // db/schema-v1.sql) with requester_id + location_text + service_type
  // as the canonical columns. The 2026-05-28 migration ADDS query +
  // provider_type + category + what + when_text + lat + lng +
  // budget_cents. We write to ALL of them so the row carries both the
  // legacy + the new attribution shapes. service_type is required by
  // the existing schema — we set it to the resolved provider_type.
  const { data: request, error: insErr } = await supabase
    .from('requests')
    .insert({
      requester_id:  uid,
      service_type:  provider_type || (what || 'service'),
      description:   (query || '').slice(0, 500),
      location_text: where_text || null,
      status:        'pending',
      // New columns (added by 2026-05-28 migration):
      query:         (query || '').slice(0, 500),
      provider_type: provider_type || null,
      category:      category || null,
      what:          what || null,
      when_text:     when_text || null,
      lat:           (lat ?? null),
      lng:           (lng ?? null),
      budget_cents:  (typeof budget_cents === 'number') ? budget_cents : null,
    })
    .select()
    .single();
  if (insErr || !request) return { request: null, notified: 0, error: insErr };

  // 2) Resolve providers we're allowed to notify. The function refuses
  //    if any of (notifySafe, verifiedProviderType, lat/lng) is missing
  //    — the request row stays, the fan-out just skips.
  const { data: provs, error: provErr, blocked } = await getProvidersForNotify({
    verifiedProviderType: provider_type,
    notifySafe:           !!notifySafe,
    lat, lng,
    radiusMiles,
  });
  if (provErr) return { request, notified: 0, error: provErr };
  if (blocked) return { request, notified: 0, error: null, blocked };

  // 3) Fan out the notifications. data.deep_link routes the provider
  //    to /results?req=<id> when they tap. data.request_id is what
  //    useRequestActivity polls on the SRP — same anchor on both sides.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai';
  const deep_link = `${origin}/results?req=${request.id}`;
  // Exclude the requester themselves — a user who owns a matching service must
  // not be fanned out their own request (CERGIO-GUARD 2026-06-18).
  const ownerIds = Array.from(new Set((provs || []).map(s => s.owner_id).filter(Boolean)))
    .filter(id => id !== uid);
  if (ownerIds.length === 0) {
    // CERGIO-GUARD (2026-06-18): no provider matched in radius → a city we don't
    // cover yet. Enqueue an on-demand services crawl (10 best nearest) so the
    // crawler sources + onboards them. Best-effort; never blocks the request.
    if (provider_type && lat != null && lng != null) {
      enqueueCityCrawl({
        kind: 'services', city: where_text || null, lat, lng,
        serviceType: provider_type, targetCount: 10, triggerRequestId: request.id,
      }).catch(() => {});
    }
    return { request, notified: 0, error: null };
  }

  // Build one row per recipient — the insert is bulk for atomicity.
  const rows = ownerIds.map(owner_id => ({
    profile_id: owner_id,
    kind:       'new_request',
    body:       `New ${provider_type || 'service'} request near you`,
    data:       {
      request_id:    request.id,
      requester_id:  uid,
      provider_type: provider_type || null,
      query:         (query || '').slice(0, 200),
      where_text:    where_text || null,
      deep_link,
    },
  }));
  const { error: notifyErr } = await supabase.from('notifications').insert(rows);
  if (notifyErr) return { request, notified: 0, error: notifyErr };

  // CERGIO-GUARD (2026-06-12): email/SMS fan-out to the same providers,
  // best-effort via notify-request edge fn. In-app rows above remain the
  // source of truth; this never blocks or fails the request flow.
  fireRequestNotify({ event: 'created', requestId: request.id, providerIds: ownerIds });

  return { request, notified: ownerIds.length, error: null };
}

/**
 * createRequestToProvider — single-provider request from the PDP.
 *
 * Tarik (2026-05-30): "submit a request should open a request box...
 * to the specific service... it can also offer the ability to cross
 * post that to all services at the end post submission".
 *
 * Mirrors createRequestAndFanOut but only pings the one targeted
 * provider. Returns { request, error } so the UI can stash request.id
 * for the optional follow-up cross-post step.
 */
export async function createRequestToProvider({
  toProviderOwnerId,
  toServiceId = null,
  query,
  provider_type,
  category,
  what,
  when_text,
  where_text,
  lat, lng,
  budget_cents,
} = {}) {
  if (!supabaseReady) return { request: null, error: NOT_WIRED.error };
  if (!toProviderOwnerId) {
    return { request: null, error: { message: 'toProviderOwnerId required' } };
  }
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) {
    return { request: null, error: { message: 'sign-in required to submit a request' } };
  }
  const uid = userRes.user.id;

  // Anchor the request row — same shape as the fan-out path so any
  // future bid/booking tooling that joins on request_id works either way.
  const { data: request, error: insErr } = await supabase
    .from('requests')
    .insert({
      requester_id:  uid,
      service_type:  provider_type || (what || 'service'),
      description:   (query || '').slice(0, 500),
      location_text: where_text || null,
      status:        'pending',
      query:         (query || '').slice(0, 500),
      provider_type: provider_type || null,
      category:      category || null,
      what:          what || null,
      when_text:     when_text || null,
      lat:           (lat ?? null),
      lng:           (lng ?? null),
      budget_cents:  (typeof budget_cents === 'number') ? budget_cents : null,
    })
    .select()
    .single();
  if (insErr || !request) return { request: null, error: insErr };

  // Single-recipient notification — same shape as fan-out so the
  // provider's inbox renders it identically.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai';
  const deep_link = `${origin}/results?req=${request.id}`;
  // CERGIO-GUARD (2026-07-14, launch-05 — SELF-NOTIFY): requesting your OWN
  // listing (own PDP, or a stale owner id) must never notify you as the
  // provider. The request row still stands; only the self-notification is
  // suppressed. SPEC-78.
  if (toProviderOwnerId === uid) {
    return { request, error: null, selfNotifySuppressed: true };
  }
  await supabase.from('notifications').insert({
    profile_id: toProviderOwnerId,
    kind:       'new_request',
    body:       `New ${provider_type || 'service'} request — direct to you`,
    data: {
      request_id:    request.id,
      requester_id:  uid,
      provider_type: provider_type || null,
      service_id:    toServiceId,
      query:         (query || '').slice(0, 200),
      where_text:    where_text || null,
      deep_link,
    },
  });
  return { request, error: null };
}

/**
 * crossPostRequest — second step from the PDP request flow.
 *
 * After a single-provider request is sent, the user can opt to "also
 * notify other matching providers". This re-uses getProvidersForNotify
 * to find them, then inserts notifications pointing at the SAME
 * requests row so the consumer still sees one open thread (not N).
 *
 * `excludeOwnerId` skips the original targeted provider so they don't
 * get a duplicate notification.
 */
export async function crossPostRequest({
  requestId,
  provider_type,
  query,
  where_text,
  lat, lng,
  notifySafe,
  excludeOwnerId = null,
  radiusMiles = 25,
} = {}) {
  if (!supabaseReady) return { notified: 0, error: NOT_WIRED.error };
  if (!requestId) return { notified: 0, error: { message: 'requestId required' } };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user?.id) {
    return { notified: 0, error: { message: 'sign-in required' } };
  }
  const uid = userRes.user.id;

  const { data: provs, error: provErr, blocked } = await getProvidersForNotify({
    verifiedProviderType: provider_type,
    notifySafe:           !!notifySafe,
    lat, lng,
    radiusMiles,
  });
  if (provErr) return { notified: 0, error: provErr };
  if (blocked) return { notified: 0, error: null, blocked };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cergio.ai';
  const deep_link = `${origin}/results?req=${requestId}`;
  // CERGIO-GUARD (2026-07-14, launch-05 — SELF-NOTIFY): a requester who also
  // owns a matching listed service in radius was fanned out their OWN request
  // ("you have a new request near you" for a request they just made). The
  // fan-out path (createRequestAndFanOut) already excluded `uid`; this one only
  // excluded the originally-targeted provider, so the requester leaked back in.
  // The requester is NEVER a recipient of their own request — SPEC-78.
  const ownerIds = Array.from(new Set(
    (provs || [])
      .map(s => s.owner_id)
      .filter(Boolean)
      .filter(id => id !== excludeOwnerId)
      .filter(id => id !== uid)
  ));
  if (ownerIds.length === 0) return { notified: 0, error: null };

  const rows = ownerIds.map(owner_id => ({
    profile_id: owner_id,
    kind:       'new_request',
    body:       `New ${provider_type || 'service'} request near you`,
    data: {
      request_id:    requestId,
      requester_id:  uid,
      provider_type: provider_type || null,
      query:         (query || '').slice(0, 200),
      where_text:    where_text || null,
      deep_link,
      cross_post:    true,
    },
  }));
  const { error: notifyErr } = await supabase.from('notifications').insert(rows);
  if (notifyErr) return { notified: 0, error: notifyErr };

  return { notified: ownerIds.length, error: null };
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
  // CERGIO-GUARD (2026-06-12): true when the user explicitly picked a
  // day + time in the ScheduleSheet (calendar + Done) — per Tarik's
  // flow board. Stamps schedule_confirmed_at so both sides know the
  // time is real, not the +24h placeholder.
  scheduleConfirmed = false,
  // CERGIO-GUARD (2026-06-15, Tarik): book directly as 'confirmed' when the
  // booking comes off a provider's EXISTING offer — the provider already said
  // yes, so the redundant re-accept step is skipped and it lands in both
  // parties' Upcoming immediately ("ultra intuitive easy flow").
  confirmed = false,
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
      status:                confirmed ? 'confirmed' : 'pending',
      scheduled_at:          when.toISOString(),
      location_text:         locationText || null,
      notes:                 notes || null,
      total_cents:           totalCents || 0,
      is_free_for_rainmaker: !!isFreeForRainmaker,
      schedule_confirmed_at: scheduleConfirmed ? new Date().toISOString() : null,
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
      consumer:profiles!bookings_consumer_id_fkey ( id, display_name, instagram_handle, instagram_followers, cc_verified_at ),
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
      is_free_for_rainmaker, created_at, paid_at, completed_at,
      schedule_confirmed_at, post_url, posted_at, post_confirmed_at,
      post_flag_reason, post_flagged_at, spotlight_verified_at, spotlight_clicks,
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

/**
 * Open below-4★ disputes for the signed-in user (Tarik 2026-06-15). Returns one
 * row per unresolved <4★ review where I'm a party — role 'provider' (I was rated
 * low) or 'connector' (I gave the low rating) — with the rating, comment, other
 * party, and escalation flag. "Open" = the barter hasn't been confirmed yet.
 */
export async function getMyOpenDisputes() {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  const me = userRes.user.id;
  const { data: revs, error } = await supabase
    .from('reviews')
    .select('id, booking_id, rater_id, rated_id, stars, comment, created_at')
    .lt('stars', 4)
    .or(`rater_id.eq.${me},rated_id.eq.${me}`)
    .order('created_at', { ascending: false });
  if (error || !revs?.length) return { data: [], error };
  const bookingIds = [...new Set(revs.map(r => r.booking_id))];
  const { data: bks } = await supabase
    .from('bookings')
    .select('id, post_confirmed_at, dispute_escalated_at, service:services(id, title)')
    .in('id', bookingIds);
  const bkMap = Object.fromEntries((bks || []).map(b => [b.id, b]));
  const otherIds = [...new Set(revs.map(r => (r.rater_id === me ? r.rated_id : r.rater_id)).filter(Boolean))];
  let profMap = {};
  if (otherIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', otherIds);
    profMap = Object.fromEntries((profs || []).map(p => [p.id, p]));
  }
  const rows = revs.map(r => {
    const b = bkMap[r.booking_id] || {};
    const role = r.rated_id === me ? 'provider' : 'connector';
    const otherId = r.rater_id === me ? r.rated_id : r.rater_id;
    return {
      bookingId:    r.booking_id,
      role,
      stars:        r.stars,
      comment:      r.comment || '',
      otherName:    profMap[otherId]?.display_name || (role === 'provider' ? 'A Connector' : 'The provider'),
      serviceTitle: b.service?.title || 'service',
      escalated:    !!b.dispute_escalated_at,
      resolved:     !!b.post_confirmed_at,
    };
  }).filter(r => !r.resolved);
  return { data: rows, error: null };
}

/** The dispute back-and-forth for one booking (oldest first, with sender names). */
export async function listReviewThread(bookingId) {
  if (!supabaseReady || !bookingId) return { data: [], error: null };
  const { data, error } = await supabase
    .from('review_threads')
    .select('id, sender_id, body, is_escalation, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return { data: data || [], error };
  const ids = [...new Set(data.map(m => m.sender_id))];
  const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', ids);
  const pm = Object.fromEntries((profs || []).map(p => [p.id, p]));
  return { data: data.map(m => ({ ...m, senderName: pm[m.sender_id]?.display_name || 'User' })), error: null };
}

/** Post a reply (or escalation) on a dispute thread. Escalation stamps the
 *  booking + pings support (admin module handles it manually for now). */
export async function addReviewReply(bookingId, body, { escalate = false } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId || !(body || '').trim()) return { data: null, error: { message: 'Write something first.' } };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  const res = await supabase
    .from('review_threads')
    .insert({ booking_id: bookingId, sender_id: userRes.user.id, body: body.trim().slice(0, 2000), is_escalation: !!escalate })
    .select()
    .single();
  if (!res.error && escalate) {
    await supabase.from('bookings').update({ dispute_escalated_at: new Date().toISOString() }).eq('id', bookingId);
    fireBookingNotify(bookingId, 'dispute_escalated');
  } else if (!res.error) {
    fireBookingNotify(bookingId, 'dispute_reply');
  }
  return res;
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
      is_free_for_rainmaker, paid_at, completed_at,
      schedule_confirmed_at, post_url, posted_at, post_confirmed_at,
      post_flag_reason, post_flagged_at, spotlight_verified_at, spotlight_clicks,
      provider:profiles!bookings_provider_id_fkey ( id, display_name ),
      service:services ( id, title, category, photo_class )
    `)
    .eq('consumer_id', userRes.user.id)
    .order('scheduled_at', { ascending: false });
}

// CERGIO-GUARD (A1e, 2026-07-13 QA walk): the requester's OWN search
// requests (`requests` rows created by createRequestAndFanOut) had NO
// surface anywhere in the app. Activity's "Your open requests" block —
// which calls itself "the user's own outgoing pile" — only read
// `bookings` + `spotlight_requests`, so a search request was visible for
// exactly as long as the user stayed on /results. Live evidence: 33
// pending `requests` rows for the test account, every one of them
// invisible in the product. Leaving /results meant losing the request.
//
// This is the read side of that pile. Pending-only (a matched/cancelled
// request is not "open"), newest first, never mocked (SPEC-12).
export async function listMyOpenSearchRequests({ limit = 20 } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };

  // CERGIO-GUARD (2026-07-14, QA live walk — A1e was DEAD in production):
  // this select asked for `requests.city`, a column that DOES NOT EXIST
  // (verified live: PostgREST 400 / SQLSTATE 42703 "column requests.city
  // does not exist"). PostgREST rejects the WHOLE query on one unknown
  // column, so every user's "Your open requests" pile came back empty —
  // a request you just made never appeared, exactly the A1e failure the
  // spec forbids. The caller's .catch() swallowed it (SPEC-73/74: a
  // failure must never read as an empty success). Only columns verified
  // to exist on `requests` may be named here; the row renderer
  // (SearchRequestRow) needs service_type + scheduled_at + created_at.
  // `location_text` is the real column — there is no `city`.
  return await supabase
    .from('requests')
    // CERGIO-GUARD (2026-07-17, forensic ship — A1 honest schedule): `when_text`
    // is named here so the row can show the schedule the user actually typed
    // ("tomorrow afternoon") instead of a fabricated "As soon as possible" when
    // `scheduled_at` is null (SPEC-12: no invented ETA). SAFE: `when_text` is
    // written by the request INSERT (createSearchRequest, api.js ~L3300) and that
    // insert succeeds in prod (requests persist across Inbox/Activity), so the
    // column is PROVEN to exist — unlike `city`, which only lived in a SELECT and
    // 42703'd. Display-only, no new schema dependency.
    .select('id, created_at, status, service_type, description, scheduled_at, when_text, location_text, lat, lng')
    .eq('requester_id', userRes.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
}

// ─── Free-service barter loop (2026-06-12) ──────────────────────────────────
// Tarik's flow board: Connector books a free service (calendar-confirmed
// time) → provider accepts → job happens → Connector posts on Instagram
// and shares to the Cergio feed → provider accepts the post (or flags a
// problem) → barter complete. Until the post is uploaded AND accepted,
// the Connector cannot order other free services.

/** Fire-and-forget barter notification via the notify-request edge fn.
 *  action: 'accepted' | 'posted' | 'post_confirmed' | 'post_flagged'. */
function fireBookingNotify(bookingId, action) {
  const app_url = typeof window !== 'undefined' ? window.location.origin : undefined;
  supabase.functions
    .invoke('notify-request', { body: { event: 'booking', bookingId, action, app_url } })
    .catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[notify-request booking] best-effort send failed', err);
    });
}

/** Provider accepted the booking — used by RequestDetailScreen so the
 *  consumer hears about the confirm (email + in-app). */
export function notifyBookingAccepted(bookingId) {
  fireBookingNotify(bookingId, 'accepted');
}

/** CERGIO-GUARD (2026-06-12): optimistic paid marker — PaymentSheet
 *  stamps paid_at on client-side success; the stripe-webhook is the
 *  authoritative writer (sets it again server-side, idempotent). */
export async function markBookingPaid(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId) return { data: null, error: { message: 'bookingId required' } };
  return await supabase
    .from('bookings')
    .update({ paid_at: new Date().toISOString() })
    .eq('id', bookingId)
    .is('paid_at', null)
    .select()
    .maybeSingle();
}

/**
 * Connector marks the IG spotlight for a FREE booking as posted.
 * Saves the public post URL, stamps posted_at, clears any prior flag
 * (re-posting after a "something's wrong" resets the review), and
 * notifies the provider to review + accept.
 */
export async function markBookingPosted(bookingId, { postUrl } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId) return { data: null, error: { message: 'bookingId required' } };
  const clean = String(postUrl || '').trim();
  if (!/^https?:\/\//i.test(clean)) {
    return { data: null, error: { message: 'Paste the public link to your Instagram post.' } };
  }
  const res = await supabase
    .from('bookings')
    .update({
      post_url:         clean.slice(0, 500),
      posted_at:        new Date().toISOString(),
      post_flag_reason: null,
      post_flagged_at:  null,
    })
    .eq('id', bookingId)
    .select()
    .single();
  if (!res.error && res.data?.id) fireBookingNotify(bookingId, 'posted');
  return res;
}

/**
 * Provider accepts the Connector's IG post → barter complete.
 * Stamps post_confirmed_at and flips the booking to 'completed'.
 * This is what releases the Connector's free-service gate.
 */
export async function confirmBookingPost(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId) return { data: null, error: { message: 'bookingId required' } };
  const res = await supabase
    .from('bookings')
    .update({
      post_confirmed_at: new Date().toISOString(),
      status:            'completed',
      updated_at:        new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select()
    .single();
  if (!res.error && res.data?.id) fireBookingNotify(bookingId, 'post_confirmed');
  return res;
}

/**
 * Provider marks the JOB (service) complete — anytime, even before/at the start
 * (Tarik 2026-06-15). Distinct from confirmBookingPost: completed_at says the
 * service was delivered, which (a) nudges the Connector to make the IG post and
 * (b) starts the paid auto-release window. The barter still only closes when
 * the provider confirms the post (post_confirmed_at). Fires notify-request
 * (job_complete) → the Connector gets "post your spotlight" (email + in-app;
 * SMS once Twilio is wired).
 */
export async function markBookingComplete(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId) return { data: null, error: { message: 'bookingId required' } };

  // SPEC-47g auto-release window. Read scheduled_at so we can apply the guard:
  // if the provider marks complete BEFORE the job's start time, we do NOT start
  // the 3h release clock — the consumer must confirm the job actually happened
  // (confirmJobDone) first. These columns are inert for instant-mode bookings
  // (no transfer_group), so the release worker ignores them there.
  const RELEASE_HOURS = 3;
  const completedAt = new Date();
  const { data: existing } = await supabase
    .from('bookings')
    .select('scheduled_at')
    .eq('id', bookingId)
    .maybeSingle();
  const scheduledAt = existing?.scheduled_at ? new Date(existing.scheduled_at) : null;
  const completedEarly = scheduledAt ? completedAt < scheduledAt : false;

  const patch = {
    completed_at: completedAt.toISOString(),
    updated_at:   completedAt.toISOString(),
  };
  if (completedEarly) {
    // Suspicious early completion → hold until the consumer confirms.
    patch.release_requires_confirm = true;
    patch.release_due_at = null;
  } else {
    patch.release_requires_confirm = false;
    patch.release_due_at = new Date(completedAt.getTime() + RELEASE_HOURS * 3600 * 1000).toISOString();
  }

  const res = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', bookingId)
    .is('completed_at', null)
    .select()
    .maybeSingle();
  if (!res.error && res.data?.id) fireBookingNotify(bookingId, 'job_complete');
  return res;
}

/**
 * SPEC-47g — consumer confirms the job was actually done. Only meaningful when
 * the provider marked the job complete BEFORE its scheduled start time, which
 * holds the funds (release_requires_confirm). Confirming clears the hold and
 * starts the release immediately (release_due_at = now). Only the consumer on
 * the booking may call this (RLS enforces it; we also scope the update).
 */
export async function confirmJobDone(bookingId) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId) return { data: null, error: { message: 'bookingId required' } };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: null, error: { message: 'Not signed in' } };
  const now = new Date().toISOString();
  return await supabase
    .from('bookings')
    .update({
      consumer_confirmed_at:    now,
      release_requires_confirm: false,
      release_due_at:           now, // eligible on the next release sweep
      updated_at:               now,
    })
    .eq('id', bookingId)
    .eq('consumer_id', userRes.user.id)
    .select()
    .maybeSingle();
}

/**
 * SPEC-47g — bookings where I'm the consumer and the provider marked the job
 * complete early, so my confirmation is required before their funds release.
 * Drives the "Did this happen? Confirm to release payment" inbox action.
 */
export async function listBookingsAwaitingMyConfirm() {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { data: [], error: null };
  return await supabase
    .from('bookings')
    .select(`
      id, scheduled_at, completed_at, total_cents,
      service:services ( id, title ),
      provider:profiles!bookings_provider_id_fkey ( id, display_name )
    `)
    .eq('consumer_id', userRes.user.id)
    .eq('release_requires_confirm', true)
    .is('consumer_confirmed_at', null)
    .is('released_at', null)
    .order('completed_at', { ascending: false });
}

/**
 * Provider flags a problem with the post ("something's wrong").
 * Keeps the barter OPEN (gate stays on) and tells the Connector what
 * to fix. Re-running markBookingPosted clears the flag.
 */
export async function flagBookingPost(bookingId, { reason } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!bookingId) return { data: null, error: { message: 'bookingId required' } };
  const res = await supabase
    .from('bookings')
    .update({
      post_flag_reason: (reason || '').slice(0, 500) || 'Post needs an update.',
      post_flagged_at:  new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select()
    .single();
  if (!res.error && res.data?.id) fireBookingNotify(bookingId, 'post_flagged');
  return res;
}

/**
 * THE GATE — Tarik: "the connector cannot order other free services
 * until they upload a free IG post that the service will accept."
 *
 * Outstanding barter = any FREE booking where I'm the consumer, the
 * provider accepted it (status is past 'pending', not cancelled), and
 * the post hasn't been confirmed yet. Pending requests don't block —
 * the provider hasn't said yes, so no debt exists yet.
 *
 * Returns { outstanding: row|null, error } — row carries the service
 * title + post state so the blocking UI can say exactly what to do.
 */
export async function getOutstandingFreeBarter() {
  if (!supabaseReady) return { outstanding: null, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) return { outstanding: null, error: null };

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, status, scheduled_at, completed_at, posted_at, post_confirmed_at, post_flag_reason,
      service:services ( id, title ),
      provider:profiles!bookings_provider_id_fkey ( id, display_name )
    `)
    .eq('consumer_id', userRes.user.id)
    .eq('is_free_for_rainmaker', true)
    .in('status', ['confirmed', 'in_progress', 'completed'])
    .is('post_confirmed_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { outstanding: null, error };
  const outstanding = (data || [])[0] || null;
  // CERGIO-GUARD (2026-06-18, Tarik — SPEC-47i rev): the service has HAPPENED
  // (so the post is owed) once EITHER the provider marked it complete OR the
  // scheduled time has passed. Firing on "scheduled time passed" makes the
  // gate lock EARLIER — it no longer waits for the provider to remember to
  // mark complete. serviceHappened drives the hard block in BarterPostGate.
  if (outstanding) {
    const past = outstanding.scheduled_at && new Date(outstanding.scheduled_at).getTime() < Date.now();
    outstanding.serviceHappened = !!(outstanding.completed_at || past);
    // The Connector has done their turn (rated + posted, OR rated <4★ which
    // HOLDS the post) the moment a review by them exists — never block after
    // that. Compute it whenever the service has happened + not yet posted.
    if (outstanding.serviceHappened && !outstanding.posted_at) {
      const { count } = await supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', outstanding.id)
        .eq('rater_id', userRes.user.id);
      outstanding.reviewed = (count || 0) > 0;
    }
  }
  return { outstanding, error: null };
}

// IG post performance (Tarik 2026-06-16): total clicks on the user's spotlight
// links, split by role. asConnector = clicks on posts THEY made; asProvider =
// clicks the spotlights for THEIR service drove. One booking counter serves
// both sides. Real data only (0 when none).
export async function getMySpotlightClicks() {
  const zero = { asConnector: 0, asProvider: 0, total: 0 };
  if (!supabaseReady) return { data: zero, error: null };
  const { data: userRes } = await supabase.auth.getUser();
  const me = userRes?.user?.id;
  if (!me) return { data: zero, error: null };
  const { data, error } = await supabase
    .from('bookings')
    .select('consumer_id, provider_id, spotlight_clicks')
    .or(`consumer_id.eq.${me},provider_id.eq.${me}`)
    .eq('is_free_for_rainmaker', true)
    .gt('spotlight_clicks', 0);
  if (error) return { data: zero, error };
  let asConnector = 0, asProvider = 0;
  for (const b of data || []) {
    if (b.consumer_id === me) asConnector += b.spotlight_clicks || 0;
    if (b.provider_id === me) asProvider += b.spotlight_clicks || 0;
  }
  return { data: { asConnector, asProvider, total: asConnector + asProvider }, error: null };
}

// CERGIO-GUARD (2026-05-30): GOAT shares feed for the Activity screen.
// Real data, never mocked. Returns recommendations made BY Connectors
// (cc_verified_at NOT NULL) — these are the "GOATs sharing their
// go-to services" cards on the mockup. Empty array if no Connector
// recommendations exist yet — the UI then hides the section
// (never shows a fake feed; see feedback_no_fake_feeds in memory).
//
// Each card row contains:
//   id              recommendation id (stable key)
//   service:        { id, title, category, location_text, photo_class, cover_url, owner_display_name }
//   recommender:    { id, display_name, is_connector: true }
//   sent_at         when the recommendation was sent
//   message         the recommender's note (optional)
//
// NOT returned: follower counts. We don't track those today and won't
// stand in with fake numbers. The UI shows just "Shared by X, GOAT".
export async function listGoatShares({ limit = 24 } = {}) {
  if (!supabaseReady) return { data: [], error: null };

  // Step 1: recent recommendations.
  const { data: recs, error: recErr } = await supabase
    .from('recommendations')
    .select('id, recommender_id, service_id, message, sent_at')
    .order('sent_at', { ascending: false })
    .limit(limit * 3); // overfetch — we filter to Connector-only next
  if (recErr || !recs?.length) return { data: [], error: recErr || null };

  // Step 2: resolve recommender profiles, keep only Connectors.
  // CERGIO-GUARD (2026-05-30): pull follower_count so the activity-feed
  // card can render "Sabir was shared to 45,414 followers". Column is
  // NOT NULL DEFAULT 0 — when unset on a row, we render the
  // count-free fallback in the UI rather than "0 followers".
  const rIds = [...new Set(recs.map(r => r.recommender_id).filter(Boolean))];
  const { data: rProfs } = await supabase
    .from('profiles')
    .select('id, display_name, cc_verified_at, follower_count')
    .in('id', rIds);
  const goatMap = Object.fromEntries(
    (rProfs || [])
      .filter(p => !!p.cc_verified_at)
      .map(p => [p.id, p])
  );
  const goatRecs = recs.filter(r => goatMap[r.recommender_id]);
  if (!goatRecs.length) return { data: [], error: null };

  // Step 3: services for the kept recommendations.
  const sIds = [...new Set(goatRecs.map(r => r.service_id).filter(Boolean))];
  const { data: svcs } = await supabase
    .from('services')
    .select('id, title, category, taxonomy_provider_type, location_text, photo_class, cover_url, owner_id')
    .in('id', sIds);
  const svcMap = Object.fromEntries((svcs || []).map(s => [s.id, s]));

  // Step 4: service-owner display names ("Sabir was shared…").
  const oIds = [...new Set((svcs || []).map(s => s.owner_id).filter(Boolean))];
  const { data: oProfs } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', oIds);
  const oMap = Object.fromEntries((oProfs || []).map(p => [p.id, p]));

  // Step 5: shape + slice to `limit`.
  const rows = goatRecs
    .map(r => {
      const svc  = svcMap[r.service_id];
      const goat = goatMap[r.recommender_id];
      if (!svc || !goat) return null;
      const owner = oMap[svc.owner_id] || null;
      return {
        id:        r.id,
        sent_at:   r.sent_at,
        message:   r.message || null,
        service: {
          id:                  svc.id,
          title:               svc.title,
          category:            svc.category,
          location_text:       svc.location_text,
          photo_class:         svc.photo_class,
          cover_url:           svc.cover_url,
          // CERGIO-GUARD (2026-05-30): owner_id exposed so the
          // activity-feed card can link the owner avatar → /u/{ownerId}.
          owner_id:            svc.owner_id || null,
          owner_display_name:  owner?.display_name || null,
        },
        recommender: {
          id:             goat.id,
          display_name:   goat.display_name,
          is_connector:   true,
          follower_count: goat.follower_count ?? 0,
        },
      };
    })
    .filter(Boolean)
    .slice(0, limit);

  return { data: rows, error: null };
}

/**
 * Unified social activity feed — friend recommendations, Connector
 * shares, new sign-ups, new service listings, completed spotlights.
 *
 * Tarik (2026-05-30): the old feed only showed Connector go-to
 * shares (listGoatShares). He wants the full social view: "all
 * recommendations from friends, bookings, joining, spotlights...
 * friend announced a service, friend joined".
 *
 * Each returned row is shaped as { kind, at, ...payload } where kind
 * is 'reco' | 'join' | 'listing' | 'spotlight'. The caller renders
 * a different card per kind. All data is REAL (never mocked, per
 * feedback_no_fake_feeds) — sections collapse silently if zero rows.
 */
export async function listSocialFeed({ limit = 40, days = 60 } = {}) {
  if (!supabaseReady) return { data: [], error: null };

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Recommendations (friend AND Connector) ────────────────────
  const { data: recs } = await supabase
    .from('recommendations')
    .select('id, recommender_id, service_id, message, sent_at')
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
    .limit(limit);

  const recRecIds   = [...new Set((recs || []).map(r => r.recommender_id).filter(Boolean))];
  const recSvcIds   = [...new Set((recs || []).map(r => r.service_id).filter(Boolean))];
  const { data: recProfs } = recRecIds.length
    ? await supabase.from('profiles')
        .select('id, display_name, cc_verified_at, follower_count')
        .in('id', recRecIds)
    : { data: [] };
  const recProfMap = Object.fromEntries((recProfs || []).map(p => [p.id, p]));
  const { data: recSvcs } = recSvcIds.length
    ? await supabase.from('services')
        .select('id, title, category, taxonomy_provider_type, location_text, photo_class, cover_url, owner_id')
        .in('id', recSvcIds)
    : { data: [] };
  const recSvcMap = Object.fromEntries((recSvcs || []).map(s => [s.id, s]));
  const recOwnerIds = [...new Set((recSvcs || []).map(s => s.owner_id).filter(Boolean))];
  const { data: recOwners } = recOwnerIds.length
    ? await supabase.from('profiles')
        .select('id, display_name')
        .in('id', recOwnerIds)
    : { data: [] };
  const recOwnerMap = Object.fromEntries((recOwners || []).map(p => [p.id, p]));

  const recoEvents = (recs || [])
    .map(r => {
      const svc  = recSvcMap[r.service_id];
      const prof = recProfMap[r.recommender_id];
      if (!svc || !prof) return null;
      const owner = recOwnerMap[svc.owner_id] || null;
      return {
        kind: 'reco',
        at:   r.sent_at,
        id:   `reco-${r.id}`,
        message: r.message || null,
        service: {
          id:                     svc.id,
          title:                  svc.title,
          category:               svc.category,
          taxonomy_provider_type: svc.taxonomy_provider_type || null,
          location_text:          svc.location_text,
          photo_class:            svc.photo_class,
          cover_url:              svc.cover_url,
          owner_id:               svc.owner_id || null,
          owner_display_name:     owner?.display_name || null,
        },
        recommender: {
          id:             prof.id,
          display_name:   prof.display_name,
          is_connector:   !!prof.cc_verified_at,
          // CERGIO-GUARD (2026-05-31): friend graph not in DB yet;
          // wired as `false` for now. When we have a follower/friend
          // table, set this from a join on the viewer's id.
          is_friend:      false,
          follower_count: prof.follower_count ?? 0,
        },
      };
    })
    .filter(Boolean);

  // ── 2. Sign-ups (friend joined Cergio) ───────────────────────────
  // CERGIO-GUARD: profiles.created_at is the auth signup time when
  // the trigger ran. Some seed rows have created_at == NULL — exclude
  // those so they don't show "Joined unknown" cards.
  const { data: joins } = await supabase
    .from('profiles')
    .select('id, display_name, cc_verified_at, created_at')
    .not('display_name', 'is', null)
    .not('created_at', 'is', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(15);
  const joinEvents = (joins || []).map(p => ({
    kind: 'join',
    at:   p.created_at,
    id:   `join-${p.id}`,
    profile: { id: p.id, display_name: p.display_name, is_connector: !!p.cc_verified_at },
  }));

  // ── 3. New service listings ──────────────────────────────────────
  const { data: newSvcs } = await supabase
    .from('services')
    .select('id, title, category, taxonomy_provider_type, location_text, photo_class, cover_url, owner_id, created_at, status')
    .eq('status', 'listed')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(15);
  const listOwnerIds = [...new Set((newSvcs || []).map(s => s.owner_id).filter(Boolean))];
  const { data: listOwners } = listOwnerIds.length
    ? await supabase.from('profiles')
        .select('id, display_name, cc_verified_at')
        .in('id', listOwnerIds)
    : { data: [] };
  const listOwnerMap = Object.fromEntries((listOwners || []).map(p => [p.id, p]));
  const listingEvents = (newSvcs || []).map(s => {
    const o = listOwnerMap[s.owner_id] || null;
    return {
      kind: 'listing',
      at:   s.created_at,
      id:   `listing-${s.id}`,
      service: {
        id:                     s.id,
        title:                  s.title,
        category:               s.category,
        taxonomy_provider_type: s.taxonomy_provider_type || null,
        location_text:          s.location_text,
        photo_class:            s.photo_class,
        cover_url:              s.cover_url,
        owner_id:               s.owner_id || null,
      },
      owner: o ? { id: o.id, display_name: o.display_name, is_connector: !!o.cc_verified_at, is_friend: false } : null,
    };
  });

  // ── 4. Confirmed spotlights ──────────────────────────────────────
  // CERGIO-GUARD: pull spotlight_requests in any "live" terminal state
  // (posted / confirmed) — those are the ones worth surfacing. Quietly
  // skip if the table doesn't exist on this project.
  let spotEvents = [];
  try {
    const { data: spots } = await supabase
      .from('spotlight_requests')
      .select('id, connector_id, requester_id, platform, status, service_id, created_at, posted_at')
      .in('status', ['posted', 'confirmed'])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10);
    const spotProfIds = [...new Set([
      ...(spots || []).map(s => s.connector_id),
      ...(spots || []).map(s => s.requester_id),
    ].filter(Boolean))];
    const { data: spotProfs } = spotProfIds.length
      ? await supabase.from('profiles').select('id, display_name').in('id', spotProfIds)
      : { data: [] };
    const spotProfMap = Object.fromEntries((spotProfs || []).map(p => [p.id, p]));
    spotEvents = (spots || []).map(s => ({
      kind: 'spotlight',
      at:   s.posted_at || s.created_at,
      id:   `spotlight-${s.id}`,
      platform:  s.platform,
      connector: spotProfMap[s.connector_id]   ? { id: s.connector_id,  display_name: spotProfMap[s.connector_id].display_name } : null,
      requester: spotProfMap[s.requester_id]   ? { id: s.requester_id,  display_name: spotProfMap[s.requester_id].display_name } : null,
    }));
  } catch (e) {
    // table missing → silently skip
    spotEvents = [];
  }

  // ── 5. Free-service barters (2026-06-12) ─────────────────────────
  // CERGIO-GUARD: Connector completed a free service and posted the IG
  // spotlight — per Tarik's flow board this is "shared on the activity
  // feed of Cergio". Pulls FREE bookings with posted_at set; RLS scopes
  // bookings to the two parties (same visibility model as spotlight
  // events above), so each viewer sees their own barters.
  let barterEvents = [];
  try {
    const { data: barters } = await supabase
      .from('bookings')
      .select(`
        id, posted_at, post_confirmed_at, post_url,
        consumer:profiles!bookings_consumer_id_fkey ( id, display_name ),
        provider:profiles!bookings_provider_id_fkey ( id, display_name ),
        service:services ( id, title, taxonomy_provider_type, photo_class, cover_url )
      `)
      .eq('is_free_for_rainmaker', true)
      .not('posted_at', 'is', null)
      .gte('posted_at', sinceIso)
      .order('posted_at', { ascending: false })
      .limit(10);
    barterEvents = (barters || []).map(b => ({
      kind:      'barter',
      at:        b.posted_at,
      id:        `barter-${b.id}`,
      post_url:  b.post_url || null,
      confirmed: !!b.post_confirmed_at,
      connector: b.consumer ? { id: b.consumer.id, display_name: b.consumer.display_name } : null,
      provider:  b.provider ? { id: b.provider.id, display_name: b.provider.display_name } : null,
      service:   b.service ? {
        id:                     b.service.id,
        title:                  b.service.title,
        taxonomy_provider_type: b.service.taxonomy_provider_type || null,
        photo_class:            b.service.photo_class,
        cover_url:              b.service.cover_url,
      } : null,
    }));
  } catch {
    // columns not migrated yet → silently skip
    barterEvents = [];
  }

  // ── 6. Merge + sort by timestamp DESC + cap to `limit` ──────────
  const merged = [...recoEvents, ...joinEvents, ...listingEvents, ...spotEvents, ...barterEvents]
    .filter(ev => ev.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);

  return { data: merged, error: null };
}

/**
 * listInvitableProfiles — profiles the signed-in user can invite or
 * recommend to, scoped to people already in their network (followed_id).
 *
 * CERGIO-GUARD: do NOT query the full `profiles` table here. Doing so
 * dumps every seed/test user into the picker, which looks broken and
 * exposes strangers as fake "contacts". Only people the current user
 * explicitly follows (via the `network` table) should appear.
 *
 * If the user's network is empty the screen already shows an honest
 * "No one to invite yet — when friends sign up they'll appear here."
 * empty state. That is the correct experience, not a full-DB dump.
 *
 * Returns rows shaped { id, name, is_connector, initial, has_photo,
 * avatar_seed }.
 */
export async function listInvitableProfiles({ limit = 200 } = {}) {
  if (!supabaseReady) return { data: [], error: null };
  const { data: userRes } = await supabase.auth.getUser();
  const meId = userRes?.user?.id || null;
  if (!meId) return { data: [], error: null };

  // Step 1: get the IDs this user follows.
  const { data: netRows, error: netErr } = await supabase
    .from('network')
    .select('followed_id')
    .eq('follower_id', meId)
    .limit(limit);
  if (netErr) return { data: [], error: netErr };
  const followedIds = (netRows || []).map(r => r.followed_id).filter(Boolean);
  if (followedIds.length === 0) return { data: [], error: null };

  // Step 2: fetch profiles only for those followed IDs.
  const { data: profs, error } = await supabase
    .from('profiles')
    .select('id, display_name, cc_verified_at')
    .in('id', followedIds)
    .not('display_name', 'is', null)
    .order('display_name', { ascending: true });
  if (error) return { data: [], error };

  // CERGIO-GUARD: no synthesized phone/email — these are real network
  // contacts, not seed-data placeholders. Phone/email join from auth.users
  // is a future enhancement; for now only the profile display is needed.
  const rows = (profs || [])
    .filter(p => (p.display_name || '').trim().length > 0)
    .map(p => {
      const name = p.display_name.trim();
      return {
        id:           p.id,
        name,
        is_connector: !!p.cc_verified_at,
        initial:      (name[0] || '?').toUpperCase(),
        has_photo:    false,
        avatar_seed:  p.id,
      };
    });

  return { data: rows, error: null };
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

// ─── Cross-post / free profile distribution ─────────────────────────────────
// One-click push of a service's profile/offer to Google Business, Instagram,
// TikTok; Craigslist returns a copy-paste post + steps (no API). Backed by the
// `crosspost` edge function + service_channel_connections / crosspost_jobs.

const CROSSPOST_CHANNELS = ['google', 'instagram', 'tiktok', 'craigslist'];

/** Read all channel connection rows for a service (owner-scoped via RLS). */
export async function getChannelConnections(serviceId) {
  if (!supabaseReady) return { data: [], error: null };
  const { data, error } = await supabase
    .from('service_channel_connections')
    .select('channel, status, external_handle, external_id, connected_at, last_error')
    .eq('service_id', serviceId);
  if (error) return { data: [], error };
  const byChannel = Object.fromEntries((data || []).map((r) => [r.channel, r]));
  const rows = CROSSPOST_CHANNELS.map(
    (ch) => byChannel[ch] || { channel: ch, status: 'disconnected' },
  );
  return { data: rows, error: null };
}

/**
 * Record/refresh a channel connection for a service. Phase-1 manual entry of
 * the public handle/listing; flips status to 'connected' (API channels) or
 * 'manual' (Craigslist). Real OAuth swaps this for the edge-function token
 * exchange later — same row, status stays the source of truth.
 */
export async function connectServiceChannel(serviceId, channel, { handle, externalId, status } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!CROSSPOST_CHANNELS.includes(channel)) {
    return { data: null, error: { message: 'Unknown channel.' } };
  }
  const row = {
    service_id:      serviceId,
    channel,
    status:          status || (channel === 'craigslist' ? 'manual' : 'connected'),
    external_handle: handle ? String(handle).replace(/^@/, '').trim().slice(0, 120) : null,
    external_id:     externalId || null,
    connected_at:    new Date().toISOString(),
  };
  return await supabase
    .from('service_channel_connections')
    .upsert(row, { onConflict: 'service_id,channel' })
    .select()
    .single();
}

/**
 * Cross-post to one channel. Returns the edge function's result:
 *   { status: 'posted' | 'manual' | 'needs_connection' | 'pending_review' | 'error', ... }
 * For Craigslist, result.post + result.steps carry the copy-paste content.
 */
export async function crosspost({ serviceId, channel, asset = {} } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase.functions.invoke('crosspost', {
    body: { service_id: serviceId, channel, asset },
  });
  if (error) return { data: null, error };
  if (data?.error && data?.status !== 'error') return { data: null, error: { message: data.error } };
  return { data, error: null };
}

// ─── OPS & GROWTH CONSOLE — OUTREACH module (increment 1: build, no send) ─────
//
// The /ops console lets the founder BUILD an outreach audience from the SAME
// real lead tables the outreach-send edge function reads (leads_influencers for
// creators, leads_services for services) and compose a campaign off the SAME
// founding copy — WITHOUT sending. Increment 2 wires the gated dry-run + send.
//
// SENDABILITY INVARIANT (matches outreach-send + ops-metrics): only rows with
// outreach_status='queued' are ever contactable, so every count/preview here is
// scoped to 'queued'. No fake data — an empty audience returns count 0 + null
// sample, and the screen shows an honest empty state.
//
// These are AUTHENTICATED reads via the shared anon-key client (the same client
// pattern the app already uses to count leads_influencers in broadcastSpotlight-
// Request). They never touch the service-role key.

const OUTREACH_QUEUED = 'queued';

// The exact merge-field-relevant columns that exist on each lead table (verified
// against creator-harvest / fulfill-crawl / outreach-send). We NEVER select a
// column that isn't written by the pipeline.
const CREATOR_COLS = 'ig_handle, display_name, category, city, followers, email, phone';
const SERVICE_COLS = 'name, service_type, city, has_instagram, owner_email, phone';

/** Build a filtered, queued-only creator (leads_influencers) query. `sel` is the
 *  select spec + options (so counts and row fetches share one filter path);
 *  applies only the filters the caller set — empty filters are no-ops so the base
 *  is "all sendable creators". */
function creatorQuery(sel, filters = {}, selOpts) {
  let q = supabase.from('leads_influencers').select(sel, selOpts).eq('outreach_status', OUTREACH_QUEUED);
  if (filters.city)  q = q.ilike('city', `%${String(filters.city).trim()}%`);
  if (filters.niche) q = q.ilike('category', `%${String(filters.niche).trim()}%`);
  // Creators are sourced by IG handle, so has_instagram is intrinsic; a
  // hasInstagram:true filter simply requires a non-null ig_handle.
  if (filters.hasInstagram) q = q.not('ig_handle', 'is', null);
  if (Number.isFinite(filters.minFollowers)) q = q.gte('followers', filters.minFollowers);
  if (Number.isFinite(filters.maxFollowers)) q = q.lte('followers', filters.maxFollowers);
  return q;
}

/** Build a filtered, queued-only service (leads_services) query. */
function serviceQuery(sel, filters = {}, selOpts) {
  let q = supabase.from('leads_services').select(sel, selOpts).eq('outreach_status', OUTREACH_QUEUED);
  if (filters.city)        q = q.ilike('city', `%${String(filters.city).trim()}%`);
  if (filters.serviceType) q = q.ilike('service_type', `%${String(filters.serviceType).trim()}%`);
  if (filters.hasInstagram) q = q.eq('has_instagram', true);
  return q;
}

/** LIVE COUNT of sendable matches for the audience builder.
 *  @param audience 'creators' | 'services'
 *  @returns { data: { count }, error } — count is queued-only (sendable) rows. */
export async function countOutreachAudience(audience, filters = {}) {
  if (!supabaseReady) return { data: { count: 0 }, error: NOT_WIRED.error };
  try {
    const q = audience === 'services'
      ? serviceQuery('id', filters, { count: 'exact', head: true })
      : creatorQuery('id', filters, { count: 'exact', head: true });
    const { count, error } = await q;
    if (error) return { data: { count: 0 }, error };
    return { data: { count: count || 0 }, error: null };
  } catch (e) {
    return { data: { count: 0 }, error: { message: e?.message || 'count failed' } };
  }
}

/** One REAL sample recipient for the composer's live preview. Returns the first
 *  matching queued lead, normalized to merge fields {name, city, service_type,
 *  ig_handle}. Returns { data: null } (not an error) when the audience is empty —
 *  the screen then shows an honest "no sample" state instead of fake data. */
export async function sampleOutreachRecipient(audience, filters = {}) {
  if (!supabaseReady) return { data: null, error: NOT_WIRED.error };
  try {
    if (audience === 'services') {
      const { data, error } = await serviceQuery(SERVICE_COLS, filters).limit(1).maybeSingle();
      if (error) return { data: null, error };
      if (!data) return { data: null, error: null };
      return {
        data: {
          name:         data.name || '',
          city:         data.city || '',
          service_type: data.service_type || '',
          ig_handle:    '', // services are keyed by business, not an IG handle
          _channel:     data.owner_email ? 'email' : (data.phone ? 'sms/whatsapp' : 'no contact'),
        },
        error: null,
      };
    }
    const { data, error } = await creatorQuery(CREATOR_COLS, filters).order('followers', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    if (error) return { data: null, error };
    if (!data) return { data: null, error: null };
    return {
      data: {
        name:         data.display_name || data.ig_handle || '',
        city:         data.city || '',
        service_type: data.category || '', // for creators, "niche" maps to service_type merge field
        ig_handle:    data.ig_handle || '',
        followers:    Number.isFinite(data.followers) ? data.followers : null,
        _channel:     data.email ? 'email' : (data.phone ? 'sms/whatsapp' : 'no contact'),
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e?.message || 'sample failed' } };
  }
}

/** Real, distinct filter OPTIONS (cities + niches/service types) for the audience
 *  builder dropdowns — derived from a capped scan of queued rows so the founder
 *  filters against values that actually exist. No hardcoded lists. */
/** List real recipients (WITH a phone) for the P2P SMS tap-to-send queue (SPEC-84).
 *  Unlike the server-side A2P sender, this returns the list to the founder's own
 *  device so THEY send each text one at a time from their phone (genuine P2P — no
 *  10DLC, no A2P). Only phone-bearing rows; capped. Founder/admin only (leads_*
 *  are admin-scoped by RLS). Returns [{ name, phone, city, service_type, ig_handle }]. */
export async function listOutreachRecipients(audience, filters = {}, limit = 50) {
  if (!supabaseReady) return { data: [], error: NOT_WIRED.error };
  const cap = Math.min(Math.max(1, limit | 0), 200);
  try {
    if (audience === 'services') {
      const { data, error } = await serviceQuery(SERVICE_COLS, filters)
        .not('phone', 'is', null).limit(cap);
      if (error) return { data: [], error };
      return {
        data: (data || []).filter(r => r.phone).map(r => ({
          name: r.name || '', phone: String(r.phone), city: r.city || '',
          service_type: r.service_type || '', ig_handle: '',
        })),
        error: null,
      };
    }
    const { data, error } = await creatorQuery(CREATOR_COLS, filters)
      .not('phone', 'is', null)
      .order('followers', { ascending: false, nullsFirst: false }).limit(cap);
    if (error) return { data: [], error };
    return {
      data: (data || []).filter(r => r.phone).map(r => ({
        name: r.display_name || r.ig_handle || '', phone: String(r.phone), city: r.city || '',
        service_type: r.category || '', ig_handle: r.ig_handle || '',
      })),
      error: null,
    };
  } catch (e) {
    return { data: [], error: { message: e?.message || 'list failed' } };
  }
}

export async function getOutreachFilterOptions(audience) {
  if (!supabaseReady) return { data: { cities: [], niches: [] }, error: NOT_WIRED.error };
  try {
    const SCAN = 1000;
    if (audience === 'services') {
      const { data, error } = await supabase.from('leads_services')
        .select('city, service_type').eq('outreach_status', OUTREACH_QUEUED).limit(SCAN);
      if (error) return { data: { cities: [], niches: [] }, error };
      return {
        data: {
          cities: uniqSorted((data || []).map(r => r.city)),
          niches: uniqSorted((data || []).map(r => r.service_type)),
        },
        error: null,
      };
    }
    const { data, error } = await supabase.from('leads_influencers')
      .select('city, category').eq('outreach_status', OUTREACH_QUEUED).limit(SCAN);
    if (error) return { data: { cities: [], niches: [] }, error };
    return {
      data: {
        cities: uniqSorted((data || []).map(r => r.city)),
        niches: uniqSorted((data || []).map(r => r.category)),
      },
      error: null,
    };
  } catch (e) {
    return { data: { cities: [], niches: [] }, error: { message: e?.message || 'options failed' } };
  }
}

function uniqSorted(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// ─── HELP / SUPPORT (crack-help-haiku) ────────────────────────────────────────
// The in-app Help widget writes here. A ticket is inserted (RLS lets a user see
// only their own; the founder/admin sees all), then support-triage runs the
// Haiku→Opus→human ladder server-side. The AI is REPLY-ONLY — see
// supabase/functions/support-triage/index.ts.

/**
 * Open a support ticket + fire the AI triage ladder.
 *   const { data, error } = await createSupportTicket({ subject, body, email, screenshotUrl })
 * Works logged-out (user_id stays null; email is how we reach them). Returns
 * { data: { ticket, triage }, error } — triage carries the AI reply/stage when
 * the edge function answered inline, or null if triage couldn't be reached (the
 * ticket is still saved and will be handled).
 */
export async function createSupportTicket({ subject = '', body = '', email = '', screenshotUrl = null } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  if (!String(body).trim() && !String(subject).trim()) {
    return { data: null, error: { message: 'Please add a subject or a message.' } };
  }
  const { data: userRes } = await supabase.auth.getUser();
  const user  = userRes?.user || null;
  const uid   = user?.id || null;
  const email2 = String(email || user?.email || '').trim() || null;

  // Generate the id client-side so we don't need to read the row back — a
  // logged-out (anon) INSERT can't SELECT its own row under RLS (user_id is
  // null), so a `.select().single()` would falsely report failure. The opening
  // user message is written authoritatively by the service-role triage fn so
  // the thread is always complete regardless of auth.
  const id = (globalThis.crypto?.randomUUID?.()) || undefined;
  const row = {
    user_id:        uid,
    email:          email2,
    subject:        String(subject || '').slice(0, 200),
    body:           String(body || '').slice(0, 8000),
    screenshot_url: screenshotUrl || null,
    status:         'new',
  };
  if (id) row.id = id;

  const { error } = await supabase.from('support_tickets').insert(row);
  if (error) return { data: null, error };
  const ticket = { ...row, id: id || null };

  // Fire the AI ladder. It re-reads the ticket with the service role and returns
  // the reply inline when it resolved (so even logged-out users see the answer).
  let triage = null;
  if (ticket.id) {
    try {
      const app_url = typeof window !== 'undefined' ? window.location.origin : undefined;
      const { data: tri } = await supabase.functions.invoke('support-triage', {
        body: { ticketId: ticket.id, app_url },
      });
      triage = tri || null;
    } catch { triage = null; }
  }

  return { data: { ticket, triage }, error: null };
}

/** My tickets (RLS scopes to the caller). Newest first. */
export async function getMySupportTickets({ limit = 50 } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, subject, body, status, ai_stage, ai_reply, ai_reason, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

/** One ticket + its full message thread. RLS enforces owner-or-admin access. */
export async function getSupportThread(ticketId) {
  if (!supabaseReady) return NOT_WIRED;
  const { data: ticket, error: tErr } = await supabase
    .from('support_tickets').select('*').eq('id', ticketId).single();
  if (tErr) return { data: null, error: tErr };
  const { data: messages, error: mErr } = await supabase
    .from('support_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
  return { data: { ticket, messages: messages || [] }, error: mErr || null };
}

/** Founder inbox: ALL tickets (RLS lets an admin read them; a non-admin gets
 *  only their own, which is a safe no-op for this admin-gated screen). */
export async function listSupportTickets({ status = null, limit = 100 } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  let q = supabase
    .from('support_tickets')
    .select('id, subject, body, email, status, ai_stage, ai_reply, ai_reason, handled_by, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  return { data: data || [], error };
}

/** Founder reply → posts a founder message and closes the ticket. RLS admin-
 *  update policy gates this; a non-admin's update is rejected server-side. */
export async function postFounderReply(ticketId, bodyText, { close = true } = {}) {
  if (!supabaseReady) return NOT_WIRED;
  const text = String(bodyText || '').trim();
  if (!text) return { data: null, error: { message: 'Reply cannot be empty.' } };
  const { data: userRes } = await supabase.auth.getUser();
  const adminEmail = userRes?.user?.email || null;

  const { error: mErr } = await supabase
    .from('support_messages')
    .insert({ ticket_id: ticketId, sender: 'founder', body: text.slice(0, 8000) });
  if (mErr) return { data: null, error: mErr };

  const patch = { handled_by: adminEmail, updated_at: new Date().toISOString() };
  if (close) { patch.status = 'closed'; patch.resolved_at = new Date().toISOString(); }
  const { data, error } = await supabase
    .from('support_tickets').update(patch).eq('id', ticketId).select().single();
  return { data, error };
}
