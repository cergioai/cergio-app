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
const SERVICE_MAP = {
  clean: 'Cleaning', cleaning: 'Cleaning', housekeeper: 'Cleaning',
  handyman: 'Handyman', repair: 'Handyman', install: 'Installation',
  tv: 'TV Mounting',  nail: 'Nail Art', beauty: 'Beauty', hair: 'Hair',
  makeup: 'Makeup',  fit: 'Personal Training', train: 'Personal Training',
  cater: 'Catering', chef: 'Catering', cook: 'Catering',
  wedding: 'Wedding Bundle', event: 'Event Coordination',
  tutor: 'Tutoring', garden: 'Gardening', lawn: 'Gardening',
  paint: 'Painting', photo: 'Photography', move: 'Moving',
  yoga: 'Yoga', pilates: 'Pilates',
};

function naiveParse(text, state = {}) {
  const l = text.toLowerCase();
  const what = state.what
    || Object.entries(SERVICE_MAP).find(([k]) => l.includes(k))?.[1]
    || null;

  const whenMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|weekend)\b[^,.]*/i);
  const when = state.when || (whenMatch ? whenMatch[0].trim() : null);

  const budgetMatch = text.match(/\$\s*\d+/);
  const budget = state.budget || (budgetMatch ? budgetMatch[0].replace(/\s+/g, '') : null);

  const whereMatch = text.match(/\b\d+\s+[A-Za-z][A-Za-z\s]+(st|ave|blvd|rd|dr|lane|court|place|street)\b/i);
  const where = state.where || (whereMatch ? whereMatch[0] : null);

  return { what, when, where, budget, details: state.details ?? null };
}

function fallbackPlan(text, state) {
  const parsed = naiveParse(text, state);
  const missing =
    !parsed.what  ? 'what'  :
    !parsed.when  ? 'when'  :
    !parsed.where ? 'where' :
    'done';
  const promptByStep = {
    what:  "What service do you need? (e.g. handyman, cleaning, tutor…)",
    when:  "When do you need this done? A date, time, or open range works.",
    where: "Where should the provider come to?",
  };
  return {
    parsed,
    fits: true,
    is_flexible_time: null,
    next_step: missing,
    bot_reply: missing === 'done'
      ? "All set! Ready to find your best matches 🎯"
      : `Got it. ${promptByStep[missing]}`,
    quick_replies: missing === 'done' ? [] : [],
    switch_to_form: false,
    _offline: true,
  };
}

// ─── hook ───────────────────────────────────────────────────────────────────
const INITIAL_STATE = {
  what: null, when: null, where: null, budget: null, details: null,
  flexible_time: null,
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
    const merged = {
      what:           fields.what          ?? prevState.what          ?? null,
      when:           fields.when          ?? prevState.when          ?? null,
      where:          fields.where         ?? prevState.where         ?? null,
      budget:         fields.budget        ?? prevState.budget        ?? null,
      details:        fields.details       ?? prevState.details       ?? null,
      flexible_time:  res.is_flexible_time ?? prevState.flexible_time ?? null,
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
