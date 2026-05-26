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
  ['wedding',              'Wedding Bundle'],
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

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];
const MONTH_RE  = new RegExp(`\\b(${MONTHS.join('|')})\\b[a-z0-9 ,/.\\-:]*`, 'i');

// Day names — accept plural ("tuesdays") and optional "every" prefix
// ("every tuesday"). Previously the \b before the day name + \b after
// rejected "tuesdays" entirely, causing the bot to ignore the user's reply.
const DAY_NAMES   = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const DAY_RE      = new RegExp(`\\b(every\\s+)?${DAY_NAMES}s?\\b[^,.]*`, 'i');
const QUICK_WHEN  = /\b(today|tomorrow|tonight|this\s+(?:weekend|week|month)|next\s+(?:weekend|week|month))\b[^,.]*/i;

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
    details: state.details ?? null,
    flexible_time: flexible || state.flexible_time || null,
  };
}

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
};

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

    // Sanitize cloud output. If it mentions a bundle/coordinator/package
    // and we have a real local hit, prefer local.
    const isBundleish = (s) => !!s && /\b(bundle|coordinator|package)\b/i.test(s);
    const local = naiveParse(userMessage || '', prevState);
    if (local.what && isBundleish(fields.what)) {
      // eslint-disable-next-line no-console
      console.warn('[useChat] cloud parsed.what looked like a bundle ("%s") — overriding with local "%s"', fields.what, local.what);
      fields.what = local.what;
    }
    if (local.what && isBundleish(resolver.provider_type)) {
      // eslint-disable-next-line no-console
      console.warn('[useChat] cloud provider_type looked like a bundle ("%s") — overriding with local "%s"', resolver.provider_type, local.what);
      resolver.provider_type = local.what;
      // Drop a wrong offering_id too — it's almost certainly the bundle id.
      resolver.offering_id = null;
    }
    if (isBundleish(resolver.bundle?.name) || isBundleish(resolver.bundle)) {
      resolver.bundle = null;
    }

    const merged = {
      what:           fields.what          ?? prevState.what          ?? null,
      when:           fields.when          ?? prevState.when          ?? null,
      where:          fields.where         ?? prevState.where         ?? null,
      budget:         fields.budget        ?? prevState.budget        ?? null,
      details:        fields.details       ?? prevState.details       ?? null,
      flexible_time:  res.is_flexible_time ?? prevState.flexible_time ?? null,
      category:       resolver.category       ?? prevState.category       ?? null,
      provider_type:  resolver.provider_type  ?? prevState.provider_type  ?? null,
      offering_id:    resolver.offering_id    ?? prevState.offering_id    ?? null,
      bundle:         resolver.bundle         ?? prevState.bundle         ?? null,
      urgency:        res.urgency === true || prevState.urgency === true,
    };
    setState(merged);

    // Build a clean bot reply locally — no offering names, no field
    // dumps. Just the next thing we need from the user, or "all set".
    const whenSatisfied = !!merged.when || !!merged.flexible_time;
    let reply;
    if (!merged.what) {
      reply = "What service do you need? (e.g. plumber, sitter, cleaner, tutor…)";
    } else if (!whenSatisfied) {
      reply = "When do you need this? A date, time window, or just \"flexible\" works.";
    } else if (!merged.where) {
      reply = "Where should the provider come to? An address or area is fine.";
    } else {
      reply = "Got it — finding your best matches now.";
    }
    addMsg(reply, 'bot');
    setQR(Array.isArray(res.quick_replies) ? res.quick_replies : []);
    setLastBot(reply);

    if (res.switch_to_form) setNeedsForm(true);

    // Phase reflects what we actually have, not what the parser claims.
    const allCaptured = !!merged.what && whenSatisfied && !!merged.where;
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
    const seededState = {
      ...INITIAL_STATE,
      where: defaultAddress || null,
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
    await runParse({
      user_message:    trimmed,
      baseState:       state,
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
