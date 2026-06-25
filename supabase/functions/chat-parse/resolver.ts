// Local resolution engine for Cergio's chat. Resolves a user query against
// the v3 taxonomy (3,002 search terms × 932 offerings × 26 bundles × fuzzy
// rules) BEFORE we consider calling Claude. Most queries (~95% per the
// taxonomy author's coverage estimate) resolve here with confidence ≥ 0.60,
// which means zero Anthropic spend for those turns.
//
// The 7-step pipeline (loosely the one in ENGINE_HANDOFF_INSTRUCTIONS.md):
//   1. Exact whole-string match in forward_index
//   2. Lowercase + strip punctuation → exact match
//   3. Per-token typo correction (typo_corrections) → exact match
//   4. Synonym clusters → canonical term match
//   5. Bundle trigger keywords (multi-step intents like "wedding planning")
//   6. Intent patterns (compiled regex: "fix.*sink" → Plumber, etc.)
//   7. Longest substring scan of forward_index (skips terms < 3 chars)
//
// Everything that fails all 7 steps comes back with confidence 0 and the
// edge function falls through to Claude WITH the resolver's top candidates
// as context so Claude doesn't generate from scratch.

// ── load + parse once at module init ────────────────────────────────────────
// We embed the taxonomy as a TS module (auto-generated from
// data/taxonomy.json) because Supabase's function bundler doesn't ship
// arbitrary data files — only .ts/.js. The TS module gets inlined into
// the bundle so the data is available at runtime in production.
import { TAXONOMY } from './taxonomy.ts';

interface ForwardEntry { ids: string[]; lang?: string; region?: string }
const FWD: Record<string, ForwardEntry> = TAXONOMY.forward_index ?? {};
const OFFERINGS: Record<string, any> = TAXONOMY.offering_master ?? {};
const BUNDLES: Record<string, any>   = TAXONOMY.bundle_map      ?? {};
const FUZZY: any                     = TAXONOMY.fuzzy_ontology  ?? {};
const TYPO: Record<string, string>   = FUZZY.typo_corrections   ?? {};
const SYNONYMS: Record<string, string[]> = FUZZY.synonym_clusters ?? {};
const STEM_RULES: Array<{ suffix: string; replace: string }> = FUZZY.stem_rules ?? [];
const NEGATION_RULES: any = FUZZY.negation_rules ?? null;

// Pre-compile intent regexes once. We separate two kinds of patterns:
//   - "routing" patterns: real service matches with provider_type + offering_ids
//   - "flag" patterns: things like urgency that should be captured as a side
//     signal but never returned as the primary match (e.g. "urgente",
//     "asap", "emergency"). The taxonomy author signals these via empty
//     offering_ids — so we sort them into the right bucket here.
interface IntentPattern { id: string; regex: RegExp; provider_type?: string; offering_ids?: string[]; confidence?: number; intent?: string }
const _allPatterns: IntentPattern[] = (FUZZY.intent_patterns ?? []).map((ip: any) => ({
  id: ip.id,
  regex: new RegExp(ip.pattern, 'i'),
  provider_type: ip.provider_type,
  offering_ids:  ip.offering_ids ?? [],
  confidence:    typeof ip.confidence === 'number' ? ip.confidence : 0.85,
  intent:        ip.intent,
}));
const INTENT_PATTERNS: IntentPattern[] = _allPatterns.filter(p =>
  p.provider_type && Array.isArray(p.offering_ids) && p.offering_ids.length > 0
);
const FLAG_PATTERNS: IntentPattern[] = _allPatterns.filter(p =>
  !p.provider_type || !p.offering_ids?.length
);

// Resolver-level synonyms for common terms the v3 forward_index doesn't
// have on its own. These map a bare common token to a known offering_id
// in the master file. Edit-friendly without touching the 1.3 MB taxonomy.
const EXTRA_SYNONYMS: Record<string, string> = {
  'driver':              'AUTO-DRIV-003',  // → Daily commute driver / Personal Driver
  'private driver':      'AUTO-DRIV-001',  // → Airport transfer
  'personal assistant':  'PERS-PA-001',    // → Scheduling & calendar management / PA
  'pa':                  'PERS-PA-001',    // common abbreviation
  'concierge':           'PERS-PA-001',
  'errand':              'PERS-PA-003',
  'errand runner':       'PERS-PA-003',
  'project coordinator': 'PERS-PA-004',
  'event helper':        'PERS-PA-005',
};

// Lowercase the forward_index for O(1) exact lookups.
const FWD_LOWER: Record<string, ForwardEntry & { originalKey: string }> = {};
for (const [k, v] of Object.entries(FWD)) {
  FWD_LOWER[k.toLowerCase()] = { ...v, originalKey: k };
}

// Pre-sort forward_index keys by length DESC. Longest-match-wins scan in
// step 7 stops false positives like "cat" matching "catering".
const TERMS_BY_LEN: string[] = Object.keys(FWD_LOWER).sort((a, b) => b.length - a.length);

// Derived UNIGRAM_INDEX: bare-token → { offering_id → frequency }. The v3
// taxonomy mostly indexes multi-word phrases ("blocked drain", "drain not
// draining"), so when a user types "my sink wont drain" the substring scan
// finds nothing — but the token "drain" appears in dozens of plumbing
// phrases. This index lets us fall back to a confident-but-soft match by
// picking the offering each token points at most often.
const UNIGRAM_INDEX: Record<string, Record<string, number>> = {};
// Common stopwords + tokens that show up in nearly every offering and would
// otherwise dominate the unigram score (e.g. "service", "near", "me").
const UNIGRAM_STOPWORDS = new Set([
  'service', 'services', 'near', 'around', 'find', 'get', 'need', 'want', 'looking',
  'for', 'the', 'and', 'with', 'from', 'in', 'on', 'at', 'to', 'of', 'a', 'an',
  'my', 'me', 'us', 'our', 'your', 'their', 'this', 'that', 'these', 'those',
  'pro', 'professional', 'help', 'someone', 'today', 'tomorrow', 'now',
  'cerca', 'de', 'mi', 'mí', 'pour', 'avec',
]);
for (const [phrase, entry] of Object.entries(FWD)) {
  const toks = phrase.toLowerCase().split(/[\s,/-]+/).filter(t => t.length >= 3 && !UNIGRAM_STOPWORDS.has(t));
  for (const tok of toks) {
    UNIGRAM_INDEX[tok] = UNIGRAM_INDEX[tok] || {};
    for (const id of (entry.ids || [])) {
      UNIGRAM_INDEX[tok][id] = (UNIGRAM_INDEX[tok][id] || 0) + 1;
    }
  }
}

// ── types ──────────────────────────────────────────────────────────────────
export interface ResolverResult {
  offering_id:   string | null;
  offering_name: string | null;
  provider_type: string | null;
  domain?:       string;
  category?:     string;
  confidence:    number;
  method:        'exact_match' | 'typo' | 'synonym' | 'bundle' | 'regex' | 'stem' | 'substring' | 'none';
  candidates:    string[];                // top offering IDs to pass to Claude as context
  bundle?: { id: string; name: string; step_count?: number };
  language?: string;
  matched_term?: string;
}

// ── helpers ────────────────────────────────────────────────────────────────
function stripPunct(s: string): string {
  return s.replace(/[^\w\sÀ-ſ]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

function applyStems(s: string): string[] {
  // Returns possible stem variations to try; first that hits forward_index wins.
  const variants = new Set<string>();
  variants.add(s);
  for (const rule of STEM_RULES) {
    if (s.endsWith(rule.suffix)) {
      const stem = s.slice(0, -rule.suffix.length) + rule.replace;
      if (stem) variants.add(stem);
    }
  }
  return Array.from(variants);
}

// CERGIO-GUARD (2026-06-25, Tarik — parser ontology audit): 450 of 932 offerings
// (48%) are tagged notify_as/provider_type_singular = "Service Provider", a
// generic catch-all that matches NO real provider listing (exact provider_type
// match) — so ~half of all searches silently notified nobody (e.g. "personal
// chef" → "Service Provider" instead of "Personal Chef"). Every such offering
// DOES carry a specific `category`. pickType() returns the real provider type:
// notify_as unless it's generic, in which case the offering's category.
const GENERIC_PROVIDER_TYPES = new Set([
  'service provider', 'service providers', 'provider', 'providers', 'general', '',
]);
function pickType(offering: any): string | null {
  if (!offering) return null;
  const na = offering.notify_as ?? offering.provider_type_singular ?? null;
  if (na && !GENERIC_PROVIDER_TYPES.has(String(na).trim().toLowerCase())) return na;
  return offering.category ?? na ?? null;
}

function buildResult(matchedTerm: string, entry: ForwardEntry, confidence: number, method: ResolverResult['method']): ResolverResult {
  const offeringId = entry.ids?.[0];
  const offering = offeringId ? OFFERINGS[offeringId] : null;
  return {
    offering_id:   offeringId ?? null,
    offering_name: offering?.name ?? null,
    provider_type: pickType(offering),
    domain:        offering?.domain,
    category:      offering?.category,
    confidence,
    method,
    candidates:    entry.ids?.slice(0, 3) ?? [],
    language:      entry.lang,
    matched_term:  matchedTerm,
  };
}

function empty(): ResolverResult {
  return { offering_id: null, offering_name: null, provider_type: null, confidence: 0, method: 'none', candidates: [] };
}

// Bonus signal — was the message flagged as urgent? Set independently of
// the main match so the UI can surface "URGENT" badges even when the
// service category came from a normal substring/typo match.
export function detectUrgency(rawMessage: string): boolean {
  if (!rawMessage) return false;
  const lower = rawMessage.toLowerCase();
  for (const fp of FLAG_PATTERNS) {
    if (fp.intent === 'urgency_flag' && fp.regex.test(lower)) return true;
  }
  return false;
}

// Helper — does a substring match a complete word in the source? Used to
// filter out garbage hits like "PR" matching inside "PROject".
function isWholeWordMatch(haystack: string, needle: string, startIdx: number): boolean {
  const before = startIdx > 0 ? haystack[startIdx - 1] : '';
  const after  = haystack[startIdx + needle.length] ?? '';
  const wordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  return !wordChar(before) && !wordChar(after);
}

// ── main resolver ──────────────────────────────────────────────────────────
export function resolveQuery(rawMessage: string): ResolverResult {
  if (!rawMessage || typeof rawMessage !== 'string') return empty();

  const lower    = rawMessage.toLowerCase().trim();
  const stripped = stripPunct(lower);
  // Normalize common apostrophe-less spellings so IP-001 catches "won't"
  // even when the user typed "wont".
  const apostroFix = lower
    .replace(/\bwont\b/g, "won't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\bcant\b/g, "can't")
    .replace(/\bdoesnt\b/g, "doesn't")
    .replace(/\bisnt\b/g, "isn't")
    .replace(/\bain['']?t\b/g, "isn't");
  if (!lower) return empty();

  // Step 1 — exact match (whole string)
  if (FWD_LOWER[lower])    return buildResult(lower, FWD_LOWER[lower], 0.98, 'exact_match');

  // Step 2 — strip punctuation, retry
  if (stripped && stripped !== lower && FWD_LOWER[stripped]) {
    return buildResult(stripped, FWD_LOWER[stripped], 0.96, 'exact_match');
  }

  // Step 3 — per-token typo correction
  const tokens   = tokenize(stripped || lower);
  const corrected = tokens.map(t => TYPO[t] ?? t).join(' ');
  if (corrected !== (stripped || lower) && FWD_LOWER[corrected]) {
    return buildResult(corrected, FWD_LOWER[corrected], 0.92, 'typo');
  }

  // Step 4 — synonym clusters. Format in this taxonomy: each entry is
  // canonical → array of synonyms. If any synonym appears in the message
  // and the canonical is in the forward_index, route there.
  for (const [canonical, syns] of Object.entries(SYNONYMS)) {
    if (!Array.isArray(syns)) continue;
    for (const syn of syns) {
      const sLower = String(syn).toLowerCase().trim();
      if (sLower && lower.includes(sLower)) {
        const cLower = canonical.toLowerCase();
        if (FWD_LOWER[cLower]) {
          return buildResult(canonical, FWD_LOWER[cLower], 0.88, 'synonym');
        }
      }
    }
  }

  // Step 5 — bundles (multi-step intents like wedding / kitchen reno / move)
  for (const [bundleId, bundle] of Object.entries(BUNDLES) as [string, any][]) {
    if (!Array.isArray(bundle?.trigger_keywords)) continue;
    for (const kw of bundle.trigger_keywords) {
      const kLower = String(kw).toLowerCase();
      if (kLower && lower.includes(kLower)) {
        return {
          offering_id:   null,
          offering_name: bundle.name,
          provider_type: 'Bundle Coordinator',
          confidence:    0.92,
          method:        'bundle',
          candidates:    [],
          bundle:        { id: bundleId, name: bundle.name, step_count: bundle.step_count },
          matched_term:  kLower,
        };
      }
    }
  }

  // Step 6 — intent patterns (regex). Only consider patterns that yield a
  // real offering + provider type (urgency_flag etc. are handled separately
  // via detectUrgency). Also require the regex match to span complete
  // words — guards against bare-tokens like "PR" matching "project".
  for (const ip of INTENT_PATTERNS) {
    const m = ip.regex.exec(apostroFix) ?? ip.regex.exec(lower);
    if (!m) continue;
    if (!isWholeWordMatch(apostroFix, m[0], m.index)) continue;
    const firstOff = ip.offering_ids?.[0];
    const offering = firstOff ? OFFERINGS[firstOff] : null;
    if (!offering) continue;  // ignore patterns that point at missing IDs
    return {
      offering_id:   firstOff!,
      offering_name: offering.name ?? ip.intent ?? null,
      provider_type: ip.provider_type ?? pickType(offering),
      domain:        offering.domain,
      category:      offering.category,
      confidence:    ip.confidence ?? 0.85,
      method:        'regex',
      candidates:    ip.offering_ids!.slice(0, 3),
      matched_term:  ip.id,
    };
  }

  // Step 6b — resolver-level EXTRA_SYNONYMS (gaps in the v3 taxonomy we
  // cover here without editing the 1.3 MB master file). Runs AFTER bundles
  // and intent patterns so multi-step intents and specific routing wins
  // first, but BEFORE the loose substring scan. We iterate longest-key
  // first so "personal assistant" beats bare "pa".
  const sortedExtras = Object.entries(EXTRA_SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  for (const [term, offeringId] of sortedExtras) {
    const t = term.toLowerCase();
    const idx = lower.indexOf(t);
    if (idx === -1) continue;
    if (!isWholeWordMatch(lower, t, idx)) continue;
    const offering = OFFERINGS[offeringId];
    if (!offering) continue;
    return {
      offering_id:   offeringId,
      offering_name: offering.name,
      provider_type: pickType(offering),
      domain:        offering.domain,
      category:      offering.category,
      confidence:    0.86,
      method:        'synonym',
      candidates:    [offeringId],
      matched_term:  term,
    };
  }

  // Step 7 — stem-then-exact (e.g. "cleaning" → "clean")
  for (const tok of tokens) {
    for (const variant of applyStems(tok)) {
      if (variant !== tok && FWD_LOWER[variant]) {
        return buildResult(variant, FWD_LOWER[variant], 0.78, 'stem');
      }
    }
  }

  // Step 8 — longest substring scan of forward_index. Try the typo-corrected
  // and apostrophe-fixed variants too so "plummer urgente" hits "plumber".
  const scanSources = [lower, apostroFix, corrected].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const source of scanSources) {
    for (const term of TERMS_BY_LEN) {
      if (term.length < 3) break;
      if (source.includes(term)) {
        return buildResult(term, FWD_LOWER[term], 0.78, 'substring');
      }
    }
  }

  // Step 8b — unigram score via derived index. Catches bare tokens like
  // "drain" / "sink" / "leak" that aren't standalone keys in forward_index
  // but appear inside many phrases that all point at the same offering.
  // Tally token → offering votes; only return if a single offering clearly
  // wins (>= 2 phrase occurrences AND ≥ 50% of the leading-token score).
  let bestId: string | null = null;
  let bestScore = 0;
  const scoreById: Record<string, number> = {};
  for (const source of scanSources) {
    for (const tok of source.split(/[\s,/.\-]+/).filter(t => t.length >= 3)) {
      const ids = UNIGRAM_INDEX[tok];
      if (!ids) continue;
      for (const [id, count] of Object.entries(ids)) {
        scoreById[id] = (scoreById[id] || 0) + count;
        if (scoreById[id] > bestScore) {
          bestScore = scoreById[id];
          bestId = id;
        }
      }
    }
  }
  if (bestId && bestScore >= 2) {
    const offering = OFFERINGS[bestId];
    if (offering) {
      // Confidence scales with score margin — capped at 0.78. Lower than
      // strict substring (0.78) when score is low, equal when it's clear.
      const runners = Object.entries(scoreById).sort((a, b) => b[1] - a[1]);
      const margin = runners.length > 1 ? runners[0][1] / (runners[0][1] + runners[1][1]) : 1;
      const conf = Math.min(0.78, 0.55 + 0.23 * margin);
      return {
        offering_id:   bestId,
        offering_name: offering.name,
        provider_type: pickType(offering),
        domain:        offering.domain,
        category:      offering.category,
        confidence:    conf,
        method:        'substring',
        candidates:    runners.slice(0, 3).map(([id]) => id),
        matched_term:  'unigram',
      };
    }
  }

  return empty();
}

// ── when / where / budget / flexible extraction (free, never hits Claude) ──
export interface Extras {
  when:     string | null;
  where:    string | null;
  budget:   string | null;
  flexible: boolean | null;
}

const MONTHS_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b[a-z0-9 ,/.\-:]*/i;
const DAY_RE    = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|weekend|next week|this week|next month|this month)\b[^,.]*/i;
const REL_RE    = /\b(in (?:\d+) (?:days?|weeks?|months?|hours?))\b/i;

const ADDR_STRICT = /\b\d{1,6}\s+[A-Za-z][A-Za-z .'-]+(st|ave|av|blvd|rd|dr|lane|court|place|street|hwy|highway|way)\b[^,.\n]*/i;
const ADDR_LOOSE  = /\b\d{2,6}\s+[A-Z][A-Za-z][A-Za-z .'-]+/;

const FLEX_RE = /\bflexible\b|\bany (?:time|day|evening|morning|afternoon|moment)\b|\bwhenever\b|\bopen (?:on (?:time|date))?\b/i;

export function parseExtras(text: string, state: any = {}): Extras {
  let when = state.when ?? null;
  if (!when) {
    when = (text.match(MONTHS_RE)?.[0]
         ?? text.match(DAY_RE)?.[0]
         ?? text.match(REL_RE)?.[0]
         ?? null);
    if (when) when = when.trim();
  }

  let where = state.where ?? null;
  if (!where) {
    where = (text.match(ADDR_STRICT)?.[0] ?? text.match(ADDR_LOOSE)?.[0] ?? null);
    if (where) where = where.trim();
  }

  let budget = state.budget ?? null;
  if (!budget) {
    const m = text.match(/(?:\$|under|max(?:imum)?|up to|budget(?: of)?)\s*\$?\s*(\d{2,5})\s*(?:dollars?|usd|bucks)?/i)
           ?? text.match(/\$\s*(\d{2,5})\b/);
    if (m && parseInt(m[1], 10) >= 10) budget = `$${m[1]}`;
  }

  const flexible = FLEX_RE.test(text) ? true : (state.flexible_time ?? null);

  return { when, where, budget, flexible };
}

// ── bot reply composition (no Claude needed for confident matches) ─────────
export function composeBotReply(merged: any, missing: string, local: ResolverResult): string {
  const ack = [
    merged.what  && `${merged.what} ✓`,
    merged.when  && `${merged.when} ✓`,
    merged.where && `📍 ${merged.where} ✓`,
    merged.budget && `Budget ${merged.budget} ✓`,
  ].filter(Boolean).join(' · ');

  if (missing === 'done') {
    const pt = local.provider_type;
    const tail = local.bundle
      ? `\n\nThis looks like a multi-step plan (${local.bundle.step_count || 'multiple'} steps). Ready to see your match?`
      : pt
        ? `\n\nReady — I'll line up ${pt}s near you 🎯`
        : `\n\nAll set! Ready to find your best matches 🎯`;
    return `${ack}${tail}`;
  }

  const prompts: Record<string, string> = {
    what:  "What service do you need? You can describe it however you want — handyman, cat sitter, wedding help, anything.",
    when:  "When do you need this done? A specific time or just \"any evening\" works.",
    where: "Where should the provider come to? An address or area is fine.",
  };

  return `${ack ? ack + '\n\n' : ''}${prompts[missing] ?? 'Tell me more?'}`;
}

export function defaultQuickReplies(missing: string): string[] {
  if (missing === 'when')  return ['Today', 'Tomorrow', 'This weekend', 'I\'m flexible'];
  if (missing === 'where') return [];
  if (missing === 'what')  return ['Cleaning 🧹', 'Handyman 🔧', 'Cat sitter 🐱', 'Personal trainer 💪'];
  return [];
}

// ── meta for the API to surface telemetry ──────────────────────────────────
export const ENGINE_META = {
  version:          TAXONOMY.meta?.version,
  total_terms:      TAXONOMY.meta?.total_terms,
  total_offerings:  TAXONOMY.meta?.total_offerings,
  total_bundles:    TAXONOMY.meta?.total_bundles,
  intent_pattern_count: INTENT_PATTERNS.length,
};
