// useChat — Cergio's intake chat hook.
//
// Primary path: the user types a complete request on the Home search bar
// (e.g. "need a deep clean Monday 2pm, flexible, max $200") and we let
// Claude Haiku 4.5 do the parsing + decide what's still missing. The
// chat in /intake is the *gap-filler* for whatever wasn't captured up
// front, not a multi-step interrogation.
//
// Each turn:
//   1. Show the user's message immediately.
//   2. Toggle the typing indicator.
//   3. Call `chatParse` (the Claude-backed edge function) with the
//      current state. Claude returns parsed fields + the next step +
//      a natural bot reply.
//   4. Update state, render bot reply, surface its quick replies.
//
// If Claude errors out (Anthropic outage, missing API key, etc.) we
// fall back to a tiny regex parser so the chat doesn't deadlock.

import { useState, useCallback, useRef } from 'react';
import { chatParse } from '../lib/api';

// ─── tiny regex fallback (only used when Claude is unreachable) ─────────────
// Substring → display category. Order matters: more specific keys (e.g.
// "cat sitter") come BEFORE generic ones ("cat" → false positive on
// "catering") so the .find() short-circuits correctly.
const SERVICE_MAP = [
  // pet / personal services
  ['cat sitter',           'Pet Care'],
  ['cat sitting',          'Pet Care'],
  ['pet sitter',           'Pet Care'],
  ['pet sitting',          'Pet Care'],
  ['dog sitter',           'Pet Care'],
  ['dog walking',          'Dog Walking'],
  ['dog walker',           'Dog Walking'],
  ['nanny',                'Childcare'],
  ['babysitter',           'Childcare'],
  ['babysitting',          'Childcare'],
  ['child care',           'Childcare'],
  ['childcare',            'Childcare'],
  ['personal assistant',   'Personal Assistant'],
  ['errand',               'Personal Assistant'],
  ['concierge',            'Personal Assistant'],
  // mobility / drivers — keep broad. "go around the city",
  // "drive me to meetings", "airport pickup" should all map to Driver
  // even when Claude isn't reachable. Note: 'errand'/'errands' stay
  // mapped to Personal Assistant above to avoid duplicate-key collisions.
  ['driver',               'Driver'],
  ['chauffeur',            'Driver'],
  ['ride',                 'Driver'],
  ['drive me',             'Driver'],
  ['around the city',      'Driver'],
  ['around town',          'Driver'],
  ['airport pickup',       'Driver'],
  ['airport drop',         'Driver'],
  ['transportation',       'Driver'],
  ['city tour',            'Driver'],
  // home services
  ['housekeeper',          'Cleaning'],
  ['house cleaner',        'Cleaning'],
  ['deep clean',           'Cleaning'],
  ['cleaning',             'Cleaning'],
  ['clean',                'Cleaning'],
  ['handyman',             'Handyman'],
  ['repair',               'Handyman'],
  ['plumber',              'Plumbing'],
  ['plumbing',             'Plumbing'],
  ['electrician',          'Electrical'],
  ['electrical',           'Electrical'],
  ['hvac',                 'HVAC'],
  ['ac repair',            'HVAC'],
  ['tv mount',             'TV Mounting'],
  ['install',              'Installation'],
  ['assembly',             'Furniture Assembly'],
  ['ikea',                 'Furniture Assembly'],
  ['garden',               'Gardening'],
  ['lawn',                 'Gardening'],
  ['paint',                'Painting'],
  ['move',                 'Moving'],
  ['moving',               'Moving'],
  // beauty / wellness
  ['nail',                 'Nail Art'],
  ['beauty',               'Beauty'],
  ['hair',                 'Hair'],
  ['makeup',               'Makeup'],
  ['massage',              'Massage'],
  ['facial',               'Beauty'],
  ['barber',               'Barber'],
  // fitness
  ['personal trainer',     'Personal Training'],
  ['personal training',    'Personal Training'],
  ['trainer',              'Personal Training'],
  ['yoga',                 'Yoga'],
  ['pilates',              'Pilates'],
  ['coach',                'Coaching'],
  // food / events
  ['catering',             'Catering'],
  ['cater',                'Catering'],
  ['chef',                 'Catering'],
  ['bartender',            'Bartending'],
  ['bartending',           'Bartending'],
  // CERGIO-GUARD: 'Wedding' (not 'Wedding Bundle') — the local parser
  // must NEVER map a user request to a bundle/coordinator/package
  // phrase (regression test #10 in scripts/qa.mjs). The taxonomy
  // RESOLVER on the server can still route to a wedding-bundle
  // offering id internally; that's fine. What matters is the
  // user-facing 'what' value the chat exposes — that stays concrete.
  ['wedding',              'Wedding'],
  ['party',                'Event Coordination'],
  ['event',                'Event Coordination'],
  ['photographer',         'Photography'],
  ['photography',          'Photography'],
  ['videographer',         'Videography'],
  ['videography',          'Videography'],
  ['dj',                   'Event Coordination'],
  // services / lessons
  ['tutor',                'Tutoring'],
  ['tutoring',             'Tutoring'],
  ['lesson',               'Music Lessons'],
  ['piano',                'Music Lessons'],
  ['guitar',               'Music Lessons'],
];

// Pure-JS dependency-free taxonomy — keeps qa.mjs invariant #13
// importable without React/Vite resolution.
import { PROVIDER_TYPE_MAP, resolveProviderTypeLocal } from '../lib/serviceTaxonomy';

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];
const MONTH_RE  = new RegExp(`\\b(${MONTHS.join('|')})\\b[a-z0-9 ,/.\\-:]*`, 'i');

// Day names — accept plural ("tuesdays") and optional "every" prefix
// ("every tuesday"). Previously the \b before the day name + \b after
// rejected "tuesdays" entirely, causing the bot to ignore the user's reply.
// CERGIO-GUARD: the trailing group stops on comma/period/digit/$ AND on
// budget keywords ("under", "max", "maximum", "budget", "for $X"). This
// prevents "sunday lunch under 450" from being swept into the `when`
// field — the budget belongs in `budget`, not `when`.
const DAY_NAMES   = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const STOP_TAIL   = `[^,.$\\d]*?(?=\\s+(?:under|max|maximum|budget|for\\s+\\$)|[,.\\n]|\\d|\\$|$)`;
const DAY_RE      = new RegExp(`\\b(every\\s+)?${DAY_NAMES}s?\\b${STOP_TAIL}`, 'i');
const QUICK_WHEN  = new RegExp(`\\b(today|tomorrow|tonight|this\\s+(?:weekend|week|month)|next\\s+(?:weekend|week|month))\\b${STOP_TAIL}`, 'i');

// Time-of-day windows in plain English.
const TIME_OF_DAY_RE = /\b(morning|afternoon|evening|night|midday|noon|midnight)\b/i;

// Time ranges: "3-5pm", "3 to 5pm", "3:30-5:00pm", "from 3 to 5pm".
const TIME_RANGE_RE  = /\b(?:from\s+)?(\d{1,2})(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)\b/i;

// Single specific time: "3pm", "11:30am".
const SINGLE_TIME_RE = /\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/i;

function naiveParse(text, state = {}) {
  const l = text.toLowerCase();

  // Service: longest matching key wins so "personal trainer" beats "trainer".
  let what = state.what;
  if (!what) {
    let bestKey = null;
    for (const [k, v] of SERVICE_MAP) {
      if (l.includes(k) && (bestKey === null || k.length > bestKey[0].length)) {
        bestKey = [k, v];
      }
    }
    what = bestKey ? bestKey[1] : null;
  }

  // Provider type: deterministic local taxonomy (PROVIDER_TYPE_MAP) —
  // the canonical string services register themselves under. Longest
  // matching key wins so "deep clean" beats "clean" and "unclog toilet"
  // beats "unclog". This is what listServices STRICTLY filters by.
  let providerType = state.provider_type;
  if (!providerType) {
    let bestKey = null;
    for (const [k, v] of PROVIDER_TYPE_MAP) {
      if (l.includes(k) && (bestKey === null || k.length > bestKey[0].length)) {
        bestKey = [k, v];
      }
    }
    providerType = bestKey ? bestKey[1] : null;
  }

  // When: build it from any of the strongest signals we can find. We
  // prefer the richer string (e.g. "tuesdays 3-5pm") over a bare day name.
  // Previously this was a single .match() that missed plural days and
  // time ranges, so the chat would ask "When?" over and over.
  let when = state.when;
  if (!when) {
    const day        = text.match(DAY_RE);          // tuesday(s), every monday
    const quick      = text.match(QUICK_WHEN);      // today / tomorrow / this weekend
    const month      = text.match(MONTH_RE);        // jan 14
    const timeRange  = text.match(TIME_RANGE_RE);   // 3-5pm
    const singleTime = text.match(SINGLE_TIME_RE);  // 3pm
    const tod        = text.match(TIME_OF_DAY_RE);  // evening / morning

    const parts = [];
    if (day)        parts.push(day[0]);
    else if (quick) parts.push(quick[0]);
    else if (month) parts.push(month[0]);

    if (timeRange)        parts.push(timeRange[0]);
    else if (singleTime)  parts.push(singleTime[0]);
    else if (tod)         parts.push(tod[0]);

    if (parts.length) when = parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Budget: $200, 200 dollars, max 200
  let budget = state.budget;
  if (!budget) {
    const m = text.match(/(?:\$|under|max(?:imum)?|up to|budget)?\s*\$?\s*(\d{2,5})\s*(?:dollars?|usd|bucks)?/i);
    if (m && parseInt(m[1], 10) >= 10) budget = `$${m[1]}`;
  }

  // Where: street number + words. Loosened from strict suffix list so things
  // like "5701 collins ave miami" or "1145 Broadway" both catch.
  let where = state.where;
  if (!where) {
    // Try "<num> <words> <suffix>" first, then "<num> <words>" loose.
    const strict = text.match(/\b\d{1,6}\s+[A-Za-z][A-Za-z .'-]+(st|ave|av|blvd|rd|dr|lane|court|place|street|hwy|highway|way)\b[^,.\n]*/i);
    const loose  = text.match(/\b\d{2,6}\s+[A-Z][A-Za-z][A-Za-z .'-]+/);
    where = (strict?.[0] || loose?.[0] || null);
    if (where) where = where.trim();
  }

  const flexible = /\bflexible\b|\bany (?:time|day|evening|morning|afternoon)\b|\bwhenever\b|\bopen\b/i.test(text);

  return {
    what, when, where, budget,
    provider_type: providerType,
    details: state.details ?? null,
    flexible_time: flexible || state.flexible_time || null,
  };
}

// Re-export taxonomy helpers so call-sites can use a single import
// path. The pure-JS source of truth lives in src/lib/serviceTaxonomy.js.
export { PROVIDER_TYPE_MAP, resolveProviderTypeLocal };

function fallbackPlan(text, state) {
  const parsed = naiveParse(text, state);

  // A flexible answer ("I'm flexible", "anytime", "whenever") counts as
  // a satisfied when. Previously we still asked the user for a time even
  // after they said flexible, which led to the bot looping.
  const whenSatisfied = !!parsed.when || !!parsed.flexible_time;

  const missing =
    !parsed.what     ? 'what'  :
    !whenSatisfied   ? 'when'  :
    !parsed.where    ? 'where' :
    'done';
  const promptByStep = {
    what:  "What service do you need? (e.g. handyman, cleaning, tutor, cat sitter, driver, personal assistant…)",
    when:  "When do you need this done? A specific date, time, or open range like \"any evening next week\" works.",
    where: "Where should the provider come to? An address or area is fine.",
  };

  // Acknowledgement line — surface what we captured so the user trusts
  // their answer landed. Flexible counts: show "Flexible time ✓".
  const ack = [
    parsed.what  && `${parsed.what} ✓`,
    parsed.when  && `${parsed.when} ✓`,
    !parsed.when && parsed.flexible_time && 'Flexible time ✓',
    parsed.where && `📍 ${parsed.where} ✓`,
    parsed.budget && `Budget ${parsed.budget} ✓`,
  ].filter(Boolean).join(' · ');

  return {
    parsed,
    fits: true,
    is_flexible_time: parsed.flexible_time ?? null,
    next_step: missing,
    bot_reply: missing === 'done'
      ? `${ack ? ack + '\n\n' : ''}All set! Ready to find your best matches 🎯`
      : `${ack ? ack + '\n\n' : ''}${promptByStep[missing]}`,
    quick_replies: [],
    switch_to_form: false,
    _offline: true,
  };
}

// ─── hook ───────────────────────────────────────────────────────────────────
const INITIAL_STATE = {
  what: null, when: null, where: null, budget: null, details: null,
  flexible_time: null,
  // populated from the chat-parse resolver telemetry — used by ResultsScreen
  // to filter providers and by the status reel to say "Pinging local Plumbers"
  // instead of the generic copy.
  category:      null,   // broader taxonomy category, e.g. "Plumbing"
  provider_type: null,   // notify_as / singular, e.g. "Plumber"
  offering_id:   null,   // taxonomy id, e.g. "HOME-PLUMB-001"
  urgency:       false,
  bundle:        null,   // { id, name, step_count } when chat resolves to a bundle
  // CERGIO-GUARD: originalQuery is the user's first/raw message verbatim.
  // It is the SINGLE source of truth for any user-visible display (title,
  // share message, etc.). Parser output (`what`, `provider_type`, etc.)
  // is used ONLY for internal filtering. Never echo parser output back to
  // the user as the name of their service — it has been observed flipping
  // "personal chef" → "Weekly meal prep service". See CHECKLIST.md §2.
  originalQuery: null,
  // CERGIO-GUARD: notifySafe gates any code path that BLASTS notifications
  // to real providers (booking-request fan-outs, SMS pings, etc.). True
  // ONLY when:
  //   - resolver confidence >= 0.7, AND
  //   - provider_type is set and NOT generic, AND
  //   - the parsed `what` shares meaningful tokens with the user input
  //     (no drift / hallucinated offering names)
  // If notifySafe is FALSE, we must NOT fan out a notification — instead
  // surface a disambiguation step to the user ('Which kind of provider
  // should we ping? plumber / cleaner / driver / …'). Sending a toilet-
  // unclog request to a driver because the resolver was unsure is the
  // exact failure mode this flag exists to prevent.
  notifySafe: false,
  resolverConfidence: 0,
};

const NOTIFY_SAFE_CONFIDENCE = 0.7;

// CERGIO-GUARD: generic / catch-all values the cloud parser sometimes
// returns when it doesn't have a clean taxonomy hit. We refuse to set
// these as the user-visible provider_type — they read as parser garbage
// (e.g. "Looking for service providers") instead of the user's actual ask.
const GENERIC_PROVIDER_TYPES = new Set([
  'service', 'services', 'service provider', 'service providers',
  'provider', 'providers', 'professional', 'professionals',
  'expert', 'experts', 'specialist', 'specialists',
  'worker', 'workers', 'helper', 'helpers',
  'contractor', 'contractors', 'vendor', 'vendors',
  'business', 'businesses', 'company', 'companies',
  'freelancer', 'freelancers',
]);

function isGenericProviderType(v) {
  if (!v) return true;
  return GENERIC_PROVIDER_TYPES.has(String(v).trim().toLowerCase());
}

// Word-overlap check: does the parser's `what` share a meaningful token
// with the user's input? If not, the parser drifted (e.g. "personal chef"
// → "Weekly meal prep service") and we should not trust it for display.
function sharesWordsWith(parserWhat, userText) {
  if (!parserWhat || !userText) return false;
  const stop = new Set([
    'a','an','the','of','for','to','in','on','and','or','my','i','need','want',
    'service','services','please','some','someone','this','that','it','help',
  ]);
  const tokens = (s) =>
    String(s).toLowerCase().match(/[a-z]+/g)?.filter(t => t.length > 2 && !stop.has(t)) ?? [];
  const a = new Set(tokens(parserWhat));
  const b = new Set(tokens(userText));
  for (const t of a) if (b.has(t)) return true;
  return false;
}

export function useChat() {
  const [messages, setMessages]     = useState([]);
  const [state, setState]           = useState(INITIAL_STATE);
  const [quickReplies, setQR]       = useState([]);
  const [phase, setPhase]           = useState('chat');     // 'chat' | 'ready'
  const [typing, setTyping]         = useState(false);
  const [needsForm, setNeedsForm]   = useState(false);      // Claude wants us to bail to /intake-form
  const [lastBotReply, setLastBot]  = useState(null);
  // Track attempts per step so Claude (and the fallback) can decide when
  // to suggest switching to the form.
  const attemptsRef = useRef({ what: 0, when: 0, where: 0, budget: 0 });

  const addMsg = useCallback((text, role, extra = {}) => {
    setMessages(m => [...m, { id: `${Date.now()}-${Math.random()}`, text, role, ...extra }]);
  }, []);

  // Render the parsed result onto the chat surface.
  //
  // CERGIO-GUARD: taxonomy stays internal AND defensive. The chat-parse
  // edge function has been observed mapping single-service requests
  // ("Spanish-speaking babysitter") to nonsense bundle phrases like
  // "Bundle coordinator". Before we accept ANY parsed.what or
  // resolver.provider_type, we run the user's message through the local
  // SERVICE_MAP. If the local parser identifies a concrete service AND
  // the cloud's answer contains "bundle"/"coordinator"/"package", we
  // override with the local match. resolver.bundle is also dropped
  // unless explicitly handled later. See CHECKLIST.md §2.
  const applyParseResult = useCallback((res, prevState, userMessage = '') => {
    const fields = { ...(res.parsed ?? {}) };
    const resolver = { ...(res._resolver ?? {}) };

    // ── Sanitize cloud output (CERGIO-GUARD) ─────────────────────────────────
    // The cloud parser has been observed:
    //   (a) returning bundle/coordinator/package phrases for single services
    //   (b) generic provider_types like "Service provider" / "Professional"
    //   (c) renaming the user's request to an unrelated offering name
    //       (e.g. "personal chef" → "Weekly meal prep service")
    // All three rewrite the user's words into something they didn't ask for.
    // For display we always prefer the user's own text or the local
    // SERVICE_MAP hit. Taxonomy still flows through for backend filtering.
    const isBundleish = (s) => !!s && /\b(bundle|coordinator|package)\b/i.test(s);
    const userInput = userMessage || prevState.originalQuery || '';
    const local = naiveParse(userInput, prevState);

    if (local.what && isBundleish(fields.what)) {
      // eslint-disable-next-line no-console
      console.warn('[useChat] cloud parsed.what looked like a bundle ("%s") — overriding with local "%s"', fields.what, local.what);
      fields.what = local.what;
    }
    if (local.what && isBundleish(resolver.provider_type)) {
      // eslint-disable-next-line no-console
      console.warn('[useChat] cloud provider_type looked like a bundle ("%s") — overriding with local "%s"', resolver.provider_type, local.what);
      resolver.provider_type = local.what;
      resolver.offering_id = null;
    }
    if (isBundleish(resolver.bundle?.name) || isBundleish(resolver.bundle)) {
      resolver.bundle = null;
    }

    // Drop overly-generic provider types — they produce "Looking for service
    // providers" copy that erases the user's actual ask. Fall back to the
    // local SERVICE_MAP hit when available, otherwise leave it null so
    // ResultsScreen falls back to the user's originalQuery for display.
    if (isGenericProviderType(resolver.provider_type)) {
      // eslint-disable-next-line no-console
      console.warn('[useChat] cloud provider_type was generic ("%s") — dropping', resolver.provider_type);
      resolver.provider_type = local.what || null;
      resolver.offering_id = null;
    }

    // CERGIO-GUARD (2026-05-27): local taxonomy is PRIMARY.
    // Resolve user's input through the deterministic local map
    // (PROVIDER_TYPE_MAP in src/lib/serviceTaxonomy.js). If it returns
    // a concrete provider_type, that wins over whatever the Claude
    // resolver said — because the local map uses the EXACT strings
    // services register under (taxonomy_provider_type column). When
    // Claude returns a synonymic-but-wrong value like "Cleaning Service"
    // for a "deep cleaning" query, the strict-match search filter
    // would exclude every real provider. Local-primary fixes that.
    // Claude is now strictly the long-tail fallback.
    const localPT = resolveProviderTypeLocal(userInput);
    if (localPT && resolver.provider_type !== localPT) {
      // eslint-disable-next-line no-console
      console.info('[useChat] local taxonomy override: "%s" → "%s" (was cloud="%s")',
        userInput, localPT, resolver.provider_type);
      resolver.provider_type = localPT;
    }

    // Word-overlap drift check: if the parser's `what` shares NO meaningful
    // word with the user's input, the parser has wandered off (e.g.
    // "personal chef" → "Weekly meal prep service"). Prefer the local hit
    // or, failing that, drop `what` entirely so the user's originalQuery
    // becomes the display source. Skip this check on chat follow-ups where
    // the user is only answering a sub-question (when / where / budget) —
    // detected by prevState.what already being set.
    // CERGIO-GUARD: strip budget noise that drifted into `when`. The cloud
    // parser has been observed returning `when: "sunday lunch under 450"`
    // when the user's text was "personal chef sunday lunch under 450 at
    // 43 hamilton st max $450". Budget and address belong in their own
    // fields — surgically excise them so the `when` pill is clean.
    if (fields.when) {
      const cleanedWhen = String(fields.when)
        .replace(/\s+(under|max(?:imum)?|budget|for\s+\$?)\s*\$?\d{1,5}\b/gi, '')
        .replace(/\s+\$\d{1,5}\b/g, '')
        .replace(/\s+at\s+\d{1,6}\s+[A-Za-z][\w .'-]+/i, '')   // " at 43 hamilton st"
        .replace(/\s+in\s+\d{1,6}\s+[A-Za-z][\w .'-]+/i, '')
        .replace(/\s+,\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/[,.;:]+$/, '')
        .trim();
      if (cleanedWhen !== fields.when) {
        // eslint-disable-next-line no-console
        console.warn('[useChat] sanitized when "%s" → "%s"', fields.when, cleanedWhen);
        fields.when = cleanedWhen || null;
      }
    }

    if (
      fields.what &&
      userInput &&
      !prevState.what &&
      !sharesWordsWith(fields.what, userInput)
    ) {
      // eslint-disable-next-line no-console
      console.warn('[useChat] cloud parsed.what drifted from user input — input="%s" parsed="%s"', userInput, fields.what);
      if (local.what) {
        fields.what = local.what;
      } else {
        // No safe replacement → null it out and let display use originalQuery.
        fields.what = null;
        resolver.provider_type = null;
        resolver.offering_id = null;
      }
    }

    // CERGIO-GUARD: compute notifySafe BEFORE we set merged. It is the
    // SINGLE truth used to gate any "blast notification to providers"
    // path (today's Results screen still just READS services, but the
    // fanout edge function landing later MUST consult this flag). False
    // means "we are not confident enough to ping real providers — show
    // the user a disambiguation step instead of silently routing to
    // the wrong category". See PROVIDER_FANOUT_GUARD doc in api.js.
    const conf = typeof resolver.confidence === 'number' ? resolver.confidence : 0;
    const candidatePType = resolver.provider_type ?? prevState.provider_type ?? null;
    const finalWhat = fields.what ?? prevState.what ?? null;
    const safe =
      conf >= NOTIFY_SAFE_CONFIDENCE &&
      !!candidatePType &&
      !isGenericProviderType(candidatePType) &&
      // Word-overlap drift sanity: if we have raw user words and a
      // parser `what`, they MUST share a meaningful token.
      (!finalWhat || !userInput || sharesWordsWith(finalWhat, userInput));

    // CERGIO-GUARD (2026-05-27): FORCE local taxonomy at the merge
    // site, AFTER all earlier sanitization. Evidence from the user's
    // tab: even with the override at line ~440, merged.provider_type
    // landed as "Toilet replacement" (Claude returned the offering's
    // NAME, not its provider_type_singular). Re-resolving here ensures
    // a deterministic local hit ALWAYS wins. If local returns null
    // (long-tail), we keep resolver.provider_type (Claude's semantic
    // fallback). Never lets the offering NAME leak into provider_type.
    const finalLocalPT = resolveProviderTypeLocal(userInput);
    const mergedProviderType = finalLocalPT
      ?? resolver.provider_type
      ?? prevState.provider_type
      ?? null;
    if (finalLocalPT && resolver.provider_type !== finalLocalPT) {
      // eslint-disable-next-line no-console
      console.info('[useChat] MERGED override: "%s" → "%s" (cloud was "%s")',
        userInput, finalLocalPT, resolver.provider_type);
    }

    // CERGIO-GUARD (2026-05-28): when the cloud parser fails to extract
    // `what` (typos, actor-nouns like "houskeeper", short prompts) but
    // the local taxonomy DID resolve a provider_type, backfill `what`
    // from the provider_type so the bot-reply logic below doesn't fall
    // into the "What service do you need?" empty state. Real bug from
    // user tab: "need houskeeper under 200" resolved to "House Cleaner"
    // locally but Claude returned what=null → empty-state loop.
    const whatFromTaxonomy = (!fields.what && !prevState.what && mergedProviderType) ? mergedProviderType : null;

    // CERGIO-GUARD (2026-05-30): bare-number budget capture. The Claude
    // parser doesn't always extract plain numeric replies as budgets —
    // user types "400" in response to "What's your budget?" and the
    // parser returns budget=null, so the chat loops on the question.
    // Detect "we were asking about budget" from prevState (what/when/
    // where all set, budget missing) and locally capture a bare number
    // or flex word from the user's reply.
    const wasAskingBudget =
      !fields.budget &&
      (prevState.what || prevState.provider_type) &&
      (prevState.when || prevState.flexible_time) &&
      prevState.where &&
      !prevState.budget;
    if (wasAskingBudget && userInput) {
      const u = userInput.trim();
      const numMatch = u.match(/\$?\s*(\d{1,5})/);
      if (numMatch) {
        fields.budget = `$${numMatch[1]}`;
        // eslint-disable-next-line no-console
        console.info('[useChat] captured bare-number budget reply: "%s" → "%s"', u, fields.budget);
      } else if (/^(flexible|any|skip|none|no\s*max|nope|na|n\/?a)$/i.test(u)) {
        fields.budget = 'flexible';
        // eslint-disable-next-line no-console
        console.info('[useChat] captured flex-word budget reply: "%s" → flexible', u);
      }
    }

    const merged = {
      what:           fields.what          ?? prevState.what          ?? whatFromTaxonomy ?? null,
      when:           fields.when          ?? prevState.when          ?? null,
      where:          fields.where         ?? prevState.where         ?? null,
      budget:         fields.budget        ?? prevState.budget        ?? null,
      details:        fields.details       ?? prevState.details       ?? null,
      flexible_time:  res.is_flexible_time ?? prevState.flexible_time ?? null,
      category:       resolver.category       ?? prevState.category       ?? null,
      provider_type:  mergedProviderType,
      offering_id:    resolver.offering_id    ?? prevState.offering_id    ?? null,
      bundle:         resolver.bundle         ?? prevState.bundle         ?? null,
      urgency:        res.urgency === true || prevState.urgency === true,
      originalQuery:  prevState.originalQuery ?? null,
      notifySafe:     safe,
      resolverConfidence: conf,
    };
    setState(merged);

    // Build a clean bot reply locally — no offering names, no field
    // dumps. Just the next thing we need from the user, or "all set".
    // CERGIO-GUARD: a resolved provider_type is enough to know what
    // service the user wants, even if `what` (free-text) is empty.
    // Don't ask "What service do you need?" when local taxonomy already
    // pinned the provider type.
    const whenSatisfied = !!merged.when || !!merged.flexible_time;
    const whatKnown     = !!merged.what || !!merged.provider_type;
    // CERGIO-GUARD (2026-05-30): budget is now a chat prompt like when/where.
    // Asked AFTER where so the user's first answers cover the must-have
    // identifiers. "flexible" / "any" / empty all count as satisfied — we
    // never want to block the search on an optional number.
    const budgetRaw = String(merged.budget || '').trim().toLowerCase();
    const budgetSatisfied = !!budgetRaw && /\d|flex|any|none|no\s*max|skip/.test(budgetRaw);
    let reply;
    if (!whatKnown) {
      reply = "What service do you need? (e.g. plumber, sitter, cleaner, tutor…)";
    } else if (!whenSatisfied) {
      reply = "When do you need this? A date, time window, or just \"flexible\" works.";
    } else if (!merged.where) {
      reply = "Where should the provider come to? An address or area is fine.";
    } else if (!budgetSatisfied) {
      reply = "What's your budget? A max $ amount, or just \"flexible\" works.";
    } else {
      reply = "Got it — finding your best matches now.";
    }
    addMsg(reply, 'bot');
    setQR(Array.isArray(res.quick_replies) ? res.quick_replies : []);
    setLastBot(reply);

    if (res.switch_to_form) setNeedsForm(true);

    // Phase reflects what we actually have, not what the parser claims.
    // Budget IS included now so the user isn't surprised when "Got it"
    // fires before they've answered all four questions.
    const allCaptured = !!merged.what && whenSatisfied && !!merged.where && budgetSatisfied;
    setPhase(allCaptured ? 'ready' : 'chat');

    return merged;
  }, [addMsg]);

  // Wrapper that hits Claude with a typing indicator + offline fallback.
  const runParse = useCallback(async ({ user_message, baseState, defaultAddress = null, isRepeatUser = false }) => {
    setTyping(true);
    // Bump the attempt counter for the step we're trying to satisfy.
    const wantStep =
      !baseState.what  ? 'what'  :
      !baseState.when  ? 'when'  :
      !baseState.where ? 'where' :
      'budget';
    attemptsRef.current = {
      ...attemptsRef.current,
      [wantStep]: (attemptsRef.current[wantStep] || 0) + 1,
    };

    const { data, error } = await chatParse({
      user_message,
      state:           baseState,
      attempts:        attemptsRef.current,
      is_repeat_user:  isRepeatUser,
      default_address: defaultAddress,
    });

    setTyping(false);
    if (error || !data) {
      // Offline / Anthropic down — keep moving with the naive parser.
      return applyParseResult(fallbackPlan(user_message, baseState), baseState, user_message);
    }
    // Pass user_message so the bundle-sanitizer can compare against the
    // local SERVICE_MAP hit.
    return applyParseResult(data, baseState, user_message);
  }, [applyParseResult]);

  // init — open the chat, optionally with a free-text initialMessage from
  // the Home search bar, or a category seedTask from a Home chip tap.
  const init = useCallback(async (arg = null) => {
    const seedTask       = typeof arg === 'string' ? arg : arg?.seedTask ?? null;
    const initialMessage = typeof arg === 'object' && arg ? arg.initialMessage : null;
    const defaultAddress = typeof arg === 'object' && arg ? arg.default_address ?? null : null;
    const isRepeatUser   = typeof arg === 'object' && arg ? !!arg.is_repeat_user      : false;

    // Seed state with the user's saved default address so the parser
    // never re-asks "Where?" when we already know it. The cloud
    // resolver also gets defaultAddress via runParse for redundancy.
    // CERGIO-GUARD: seed originalQuery with the user's first message so
    // every later screen (Results, share card, title) can fall back to
    // the user's own words instead of parser output.
    const seededState = {
      ...INITIAL_STATE,
      where: defaultAddress || null,
      originalQuery: initialMessage || seedTask || null,
    };
    setState(seededState);
    setMessages([]);
    setQR([]);
    setPhase('chat');
    setNeedsForm(false);
    attemptsRef.current = { what: 0, when: 0, where: 0, budget: 0 };

    if (initialMessage) {
      addMsg(initialMessage, 'user');
      await runParse({
        user_message:    initialMessage,
        baseState:       seededState,
        defaultAddress,
        isRepeatUser,
      });
      return;
    }

    if (seedTask) {
      addMsg(`I need help with: ${seedTask}`, 'user');
      await runParse({
        user_message:    seedTask,
        baseState:       seededState,
        defaultAddress,
        isRepeatUser,
      });
      return;
    }

    // Blank open — show the welcome line per spec.
    addMsg(
      "Hi, I'm Cergio. Tell me what you want, when, where, and your maximum budget — " +
      "all in one go if you can. Add any detail that'll help the provider give you " +
      "an accurate offer.",
      'bot',
    );
    setQR(['Deep cleaning 🧹', 'Handyman 🔧', 'Personal trainer 💪', 'Catering 🍽️']);
  }, [addMsg, runParse]);

  // send — user typed a follow-up. Just route to Claude with current state.
  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    addMsg(trimmed, 'user');
    setQR([]);

    // Use the freshest state captured in the closure of this callback.
    // setState is async; reading `state` here gives the value at render time.
    // CERGIO-GUARD: if originalQuery hasn't been set yet (blank-open chat),
    // seed it now from the user's first typed message. This is the source
    // of truth for display so we never echo parser-mutated copy.
    const baseState = state.originalQuery
      ? state
      : { ...state, originalQuery: trimmed };

    await runParse({
      user_message:    trimmed,
      baseState,
      defaultAddress:  null,    // wire to profile when available
      isRepeatUser:    false,   // ditto
    });
  }, [addMsg, runParse, state]);

  return {
    messages,
    state,
    quickReplies,
    phase,
    typing,
    needsForm,
    lastBotReply,
    init,
    send,
  };
}
