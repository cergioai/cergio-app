// CERGIO-GUARD: shared helpers to derive a clean, user-facing service
// noun from chat state. EVERY surface that displays "the thing the
// user asked for" (Results title, share/reco copy, recommendation
// form prefills) MUST funnel through here so we never echo a
// parser-mangled offering name back at the user.
//
// Source of truth precedence:
//   1. chat.state.originalQuery   — the user's RAW words
//   2. chat.state.provider_type   — only if NOT generic
//   3. chat.state.what            — last resort, often parser-mutated
//
// userServiceNoun() strips leading "need / want / looking for" verbs
// and cuts at the first time/budget/location signal so "Spanish-speaking
// dog sitter under 55 in Miami" → "Spanish-speaking dog sitter".

const GENERIC_PROVIDER_TYPES = new Set([
  'service', 'services', 'service provider', 'service providers',
  'provider', 'providers', 'professional', 'professionals',
  'expert', 'experts', 'specialist', 'specialists',
  'worker', 'workers', 'helper', 'helpers',
  'contractor', 'contractors', 'vendor', 'vendors',
  'business', 'businesses', 'company', 'companies',
  'freelancer', 'freelancers',
]);

export function isGenericProviderType(v) {
  if (!v) return true;
  return GENERIC_PROVIDER_TYPES.has(String(v).trim().toLowerCase());
}

/** Strip intent verbs + time/budget/location tails from raw query text. */
export function userServiceNoun(rawQuery) {
  if (!rawQuery) return null;
  let s = String(rawQuery).trim();
  // Strip leading intent verbs.
  s = s.replace(/^(i\s+)?(need|want|looking\s+for|find|book|hire|get)\s+(a|an|the)?\s*/i, '');
  // Cut at the first time / budget / location signal so the noun stays clean.
  const stopAt = s.search(/\b(today|tomorrow|tonight|this|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|on\s|at\s|for\s|in\s|under\s|max\s|max:|maximum|budget|\$|\d{2,5}\s*(?:dollars|usd|bucks))/i);
  if (stopAt > 2) s = s.slice(0, stopAt).trim();
  // Collapse whitespace, strip trailing punctuation.
  s = s.replace(/\s+/g, ' ').replace(/[.,;:!?]+$/g, '').trim();
  if (!s) return null;
  if (s.length > 48) s = s.slice(0, 46).trimEnd() + '…';
  return s;
}

/** Best-effort display noun pulled from the full chat state. */
export function deriveDisplayNoun(chatState) {
  if (!chatState) return null;
  // 1. Try the user's own words first.
  const fromQuery = userServiceNoun(chatState.originalQuery);
  if (fromQuery) return fromQuery;
  // 2. Provider type if it's specific.
  const pt = chatState.provider_type;
  if (pt && !isGenericProviderType(pt)) return pt;
  // 3. Last resort: whatever the parser put in `what`.
  if (chatState.what) return chatState.what;
  return null;
}

/** Given a free-text noun and a list of canonical PROVIDER_TYPES, find
 *  the best match. Returns the canonical type when one is a meaningful
 *  match, otherwise null so callers can fall back to the raw noun
 *  verbatim.
 *
 *  CERGIO-GUARD: scoring must prefer EXACT and SHORTER matches over
 *  longer compound variants — otherwise "nanny" → "Live-In Nanny"
 *  because the alphabetical sort picks the first equally-scoring
 *  candidate. The user asked for "nanny", not "live-in nanny"; the
 *  former is a strict subset and is what we should land on.
 *
 *  Scoring tiers (highest wins):
 *    1. Exact case-insensitive match of the whole noun     → 10000
 *    2. Provider type EQUALS one of the user's tokens      →  5000
 *    3. Provider type is contained in the user's noun      →  2000 + precision
 *    4. Stem-substring overlap (recall over user stems)    →   100 * matches
 *    Then subtract 1 per extra token in the provider type so
 *    "Nanny" beats "Live-In Nanny" beats "Nanny Share Coordinator"
 *    when the user typed just "nanny".
 */
export function matchProviderType(rawNoun, providerTypes) {
  if (!rawNoun || !providerTypes?.length) return null;
  const stop = new Set([
    'a','an','the','of','for','to','in','on','and','or','my','i','need','want',
    'service','services','please','looking','some','this','that','it','help',
    'speaking','english','spanish','french',
  ]);
  const rawLc  = String(rawNoun).toLowerCase().trim();
  const tokens = rawLc.match(/[a-z]+/g)?.filter(
    t => t.length >= 3 && !stop.has(t)
  ) ?? [];
  if (tokens.length === 0) return null;
  const stems = tokens.map(t => t.length > 5 ? t.slice(0, 5) : t);

  const scoreOf = (pt) => {
    const lc = pt.toLowerCase();
    let s = 0;
    // Tier 1: exact equality with whole noun
    if (lc === rawLc) s = 10000;
    // Tier 2: equals a single user token (e.g. "nanny" === "Nanny")
    else if (tokens.includes(lc)) s = 5000;
    // Tier 3: provider type fully contained in the user's noun
    //  ("Pet Sitter" contained in "Spanish-speaking pet sitter")
    else if (rawLc.includes(lc)) s = 2000;
    // Tier 4: stem overlap (recall)
    else {
      let hits = 0;
      for (const st of stems) if (lc.includes(st)) hits++;
      s = hits * 100;
    }
    if (s === 0) return 0;
    // Tiebreaker: prefer shorter / more-precise types so "Nanny" beats
    // "Live-In Nanny" when both have a Tier-2 hit. We subtract the
    // number of word tokens in the provider type past 1 — exactly the
    // signal that says "extra qualifiers we don't need".
    const ptTokens = lc.match(/[a-z]+/g)?.length ?? 1;
    return s - Math.max(0, ptTokens - 1);
  };

  let bestType = null, bestScore = 0;
  for (const pt of providerTypes) {
    const s = scoreOf(pt);
    if (s > bestScore) { bestScore = s; bestType = pt; }
  }
  return bestScore > 0 ? bestType : null;
}
