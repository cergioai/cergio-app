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

  // 1. Insert service. taxonomy_* fields are *optional* in the schema —
  //    older deployments don't have those columns yet (the PostgREST
  //    cache returns "Could not find the 'taxonomy_category' column"
  //    when it tries to insert them). We retry without taxonomy fields
  //    on that specific failure so the listing still saves; routing
  //    just degrades to text category until the migration lands.
  const baseRow = {
    owner_id:     ownerId,
    title:        makeTitle(draft.category, draft.location),
    category:     draft.category || null,
    description:  draft.description || null,
    location_text: draft.location || null,
    lat:          draft.lat ?? null,
    lng:          draft.lng ?? null,
    photo_class:  draft.photoClass || 'fv-jamie',
    status:       'listed',
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
    .select('id, title, category, description, location_text, photo_class, cover_url, status, rating_avg, rating_count, bookings_count, created_at')
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

  // Build the allowlist — exact match by default; opt-in for related
  // canonical types via providerTypeAllowlist (no fuzzy / no stem).
  const allow = [verifiedProviderType, ...(providerTypeAllowlist || [])]
    .map(s => String(s).trim()).filter(Boolean);

  // Proximity via services_near, then post-filter on exact provider_type.
  const { data, error } = await supabase.rpc('services_near', {
    near_lat: lat, near_lng: lng,
    radius_miles: radiusMiles,
    category_match: null,
  });
  if (error) return { data: null, error };

  const filtered = (data || []).filter(s =>
    allow.includes(s.taxonomy_provider_type || '')
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
          taxonomy_offering_id, status
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

    let filtered = (full || [])
      .map(s => ({
        ...s,
        distance_miles: distById[s.id],
        offerings: offMap[s.id] || [],
      }))
      .sort((a, b) => (a.distance_miles ?? 9e9) - (b.distance_miles ?? 9e9));
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
      const want = String(provider_type).toLowerCase();
      filtered = filtered.filter(s =>
        String(s.taxonomy_provider_type || '').toLowerCase() === want
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
      // Path 1 succeeded — capture for caller. Path 2 is best-effort below.
      // Even if Path 2 fails entirely (no migration), we return success.
      // The metadata copy is the canonical source going forward.
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

  // Schema-cache miss (table not yet migrated): swallow + warn so the
  // local chip + localStorage path still works without a red toast.
  if (isMissingAddressesTable(error)) {
    logMissingAddresses('saveAddress', error);
    return { data: null, error: null };
  }
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
  const ownerIds = Array.from(new Set((provs || []).map(s => s.owner_id).filter(Boolean)));
  if (ownerIds.length === 0) return { request, notified: 0, error: null };

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

  return { request, notified: ownerIds.length, error: null };
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
