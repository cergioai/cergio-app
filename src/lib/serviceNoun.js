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
 *  the best substring match. Returns the canonical type when one is a
 *  meaningful match, otherwise null so callers can fall back to the
 *  raw noun verbatim. Stems each token to 5 chars so "dog sitter"
 *  → "Pet Sitter" via the "sitt" stem match. */
export function matchProviderType(rawNoun, providerTypes) {
  if (!rawNoun || !providerTypes?.length) return null;
  const stop = new Set([
    'a','an','the','of','for','to','in','on','and','or','my','i','need','want',
    'service','services','please','looking','some','this','that','it','help',
    'speaking','english','spanish','french',
  ]);
  const tokens = String(rawNoun).toLowerCase().match(/[a-z]+/g)?.filter(
    t => t.length >= 3 && !stop.has(t)
  ) ?? [];
  if (tokens.length === 0) return null;
  const stems = tokens.map(t => t.length > 5 ? t.slice(0, 5) : t);

  // Score each provider type by # of stems it contains.
  let bestType = null, bestScore = 0;
  for (const pt of providerTypes) {
    const lc = pt.toLowerCase();
    let score = 0;
    for (const s of stems) if (lc.includes(s)) score++;
    if (score > bestScore) { bestScore = score; bestType = pt; }
  }
  // Require at least one stem match to claim it.
  return bestScore > 0 ? bestType : null;
}
