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
  // mobility / drivers
  ['driver',               'Driver'],
  ['chauffeur',             'Driver'],
  ['ride',                 'Driver'],
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
const DAY_RE    = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|weekend|next week|this week)\b[^,.]*/i;

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

  // When: months OR day-words. Months catch "jan wedding", "start nov".
  let when = state.when;
  if (!when) {
    const mMatch = text.match(MONTH_RE);
    const dMatch = text.match(DAY_RE);
    when = (mMatch?.[0] || dMatch?.[0] || null);
    if (when) when = when.trim();
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
  const missing =
    !parsed.what  ? 'what'  :
    !parsed.when  ? 'when'  :
    !parsed.where ? 'where' :
    'done';
  const promptByStep = {
    what:  "What service do you need? (e.g. handyman, cleaning, tutor, cat sitter, driver, personal assistant…)",
    when:  "When do you need this done? A specific date, time, or open range like \"any evening next week\" works.",
    where: "Where should the provider come to? An address or area is fine.",
  };
  // Build an acknowledgement line for what WAS captured so the user knows
  // their query landed.
  const ack = [
    parsed.what  && `${parsed.what} ✓`,
    parsed.when  && `${parsed.when} ✓`,
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

  // Render Claude's response onto the chat surface.
  const applyParseResult = useCallback((res, prevState) => {
    const fields = res.parsed ?? {};
    const resolver = res._resolver ?? {};
    const merged = {
      what:           fields.what          ?? prevState.what          ?? null,
      when:           fields.when          ?? prevState.when          ?? null,
      where:          fields.where         ?? prevState.where         ?? null,
      budget:         fields.budget        ?? prevState.budget        ?? null,
      details:        fields.details       ?? prevState.details       ?? null,
      flexible_time:  res.is_flexible_time ?? prevState.flexible_time ?? null,
      // ── resolver-sourced fields. Carry forward when the new turn didn't
      // produce a fresh value so a follow-up "where is …" doesn't blank
      // out the offering_id we already locked in.
      category:       resolver.category       ?? prevState.category       ?? null,
      provider_type:  resolver.provider_type  ?? prevState.provider_type  ?? null,
      offering_id:    resolver.offering_id    ?? prevState.offering_id    ?? null,
      bundle:         resolver.bundle         ?? prevState.bundle         ?? null,
      urgency:        res.urgency === true || prevState.urgency === true,
    };
    setState(merged);

    addMsg(res.bot_reply || 'Got it.', 'bot');
    setQR(Array.isArray(res.quick_replies) ? res.quick_replies : []);
    setLastBot(res.bot_reply);

    if (res.switch_to_form) setNeedsForm(true);

    if (res.next_step === 'done') {
      setPhase('ready');
    } else {
      setPhase('chat');
    }

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
      return applyParseResult(fallbackPlan(user_message, baseState), baseState);
    }
    return applyParseResult(data, baseState);
  }, [applyParseResult]);

  // init — open the chat, optionally with a free-text initialMessage from
  // the Home search bar, or a category seedTask from a Home chip tap.
  const init = useCallback(async (arg = null) => {
    const seedTask       = typeof arg === 'string' ? arg : arg?.seedTask ?? null;
    const initialMessage = typeof arg === 'object' && arg ? arg.initialMessage : null;
    const defaultAddress = typeof arg === 'object' && arg ? arg.default_address ?? null : null;
    const isRepeatUser   = typeof arg === 'object' && arg ? !!arg.is_repeat_user      : false;

    setState(INITIAL_STATE);
    setMessages([]);
    setQR([]);
    setPhase('chat');
    setNeedsForm(false);
    attemptsRef.current = { what: 0, when: 0, where: 0, budget: 0 };

    if (initialMessage) {
      addMsg(initialMessage, 'user');
      await runParse({
        user_message:    initialMessage,
        baseState:       INITIAL_STATE,
        defaultAddress,
        isRepeatUser,
      });
      return;
    }

    if (seedTask) {
      addMsg(`I need help with: ${seedTask}`, 'user');
      await runParse({
        user_message:    seedTask,
        baseState:       INITIAL_STATE,
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
