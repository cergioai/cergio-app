import { useState, useCallback } from 'react';

const SERVICE_MAP = {
  clean: 'Cleaning', cleaning: 'Cleaning', cleaner: 'Cleaning', housekeeper: 'Cleaning',
  handyman: 'Handyman', repair: 'Handyman', install: 'Installation', tv: 'TV Mounting',
  nail: 'Nail Art', beauty: 'Beauty', hair: 'Hair', makeup: 'Makeup',
  fit: 'Personal Training', gym: 'Personal Training', train: 'Personal Training',
  cater: 'Catering', chef: 'Catering', cook: 'Catering',
  wedding: 'Wedding Bundle', party: 'Event Coordination', event: 'Event Coordination',
  tutor: 'Tutoring', teach: 'Tutoring', garden: 'Gardening', lawn: 'Gardening',
  paint: 'Painting', photo: 'Photography', move: 'Moving',
};

function parseService(text) {
  const l = text.toLowerCase();
  for (const [k, v] of Object.entries(SERVICE_MAP)) if (l.includes(k)) return v;
  return null;
}

function parseWhen(text) {
  const l = text.toLowerCase();
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const combo = l.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (combo) return `${combo[1][0].toUpperCase() + combo[1].slice(1)} ${combo[2].trim()}`;
  for (const d of days) if (l.includes(d)) return d[0].toUpperCase() + d.slice(1);
  if (l.includes('tomorrow')) return 'Tomorrow';
  if (l.includes('today'))    return 'Today';
  if (l.includes('weekend'))  return 'This weekend';
  if (l.includes('flexible') || l.includes('anytime')) return 'Flexible';
  return null;
}

function parseBudget(text) {
  const m = text.match(/(?:under|max|around|~|up to)?\s*\$?\s*(\d+)/i);
  if (m) return `$${m[1]}`;
  if (/cheap|budget|low/i.test(text)) return 'Budget-friendly';
  if (/premium|best quality/i.test(text)) return 'Premium';
  return null;
}

function parseWhere(text) {
  const addr = text.match(/\b\d+\s+[A-Za-z][A-Za-z\s]+(st|ave|blvd|rd|dr|lane|court|place|street)\b/i);
  if (addr) return addr[0];
  if (/\bmy (home|house|apartment|place|condo)\b/i.test(text)) return 'Your home';
  const postal = text.match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{5}\b/i);
  if (postal) return postal[0];
  return null;
}

// Mandatory: what + where. Optional: when, budget, details.
function nextRequired(state) {
  if (!state.what)  return 'what';
  if (!state.where) return 'where';
  return 'done';
}

const PROMPTS = {
  what:    "Hi! I'm Cergio AI 👋  What service do you need — or just describe everything at once (service, date, budget, address).",
  where:   "Where should the provider come to? (address or area)",
  details: "Any extra details for the provider? (rooms, pets, notes…) — or tap Skip.",
};

const QUICK = {
  what:    ['Deep cleaning 🧹', 'Handyman 🔧', 'Nail art 💅', 'Personal trainer 💪', 'Catering 🍽️'],
  where:   ['My home', 'Use my location 📍', 'Skip →'],
  details: ['2 bedrooms', 'Have pets 🐶', 'Post-party clean', 'Skip →'],
};

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [state, setState]       = useState({ step: 'init', what: '', when: '', budget: '', where: '', details: '', fields: 0 });
  const [quickReplies, setQR]   = useState([]);
  const [phase, setPhase]       = useState('chat'); // 'chat' | 'ready'
  const [typing, setTyping]     = useState(false);

  const addMsg = useCallback((text, role, extra = {}) => {
    setMessages(m => [...m, { id: Date.now() + Math.random(), text, role, ...extra }]);
  }, []);

  const botSay = useCallback(async (text, ms = 700) => {
    setTyping(true);
    await new Promise(r => setTimeout(r, ms));
    setTyping(false);
    addMsg(text, 'bot');
  }, [addMsg]);

  // init — optionally seed with a pre-filled task OR a free-text initial message
  //   string  (legacy)              — seed `what` directly; ask where next
  //   {seedTask: string}            — same as above, object form
  //   {initialMessage: string}      — treat as the user's first chat turn;
  //                                   run full parsing (what / where / budget)
  //                                   so the chat can skip straight to whatever's
  //                                   still unknown. Powers the home search bar.
  const init = useCallback(async (arg = null) => {
    const seedTask       = typeof arg === 'string' ? arg : arg?.seedTask ?? null;
    const initialMessage = typeof arg === 'object' && arg ? arg.initialMessage : null;

    setState({ step: 'what', what: '', when: '', budget: '', where: '', details: '', fields: 0 });
    setMessages([]);
    setQR([]);
    setPhase('chat');

    if (initialMessage) {
      // Inlined parse — mirrors send()'s `what` branch so the chat can react
      // to a full free-text query like "deep clean my apt in Brooklyn under $200"
      // in one shot without a back-and-forth on what/where/budget.
      setTimeout(async () => {
        const text = initialMessage.trim();
        addMsg(text, 'user');

        const svc    = parseService(text) || text;
        const when   = parseWhen(text);
        const budget = parseBudget(text);
        const where  = parseWhere(text);

        const next = {
          step: 'what', what: svc, when: '', budget: '', where: '', details: '', fields: 1,
        };
        if (when)   { next.when   = when;   next.fields = Math.max(next.fields, 2); }
        if (budget) { next.budget = budget; }
        if (where)  { next.where  = where;  next.fields = 3; }

        const ack = [
          svc    && `${svc} ✓`,
          when   && `${when} ✓`,
          budget && `Budget ${budget} ✓`,
          where  && `📍 ${where} ✓`,
        ].filter(Boolean).join(' · ');

        const required = nextRequired(next);
        if (required === 'done') {
          // All required fields captured — skip ahead to details.
          setState({ ...next, step: 'details' });
          await botSay(`${ack}\n\nAnything else to tell the provider? (or skip)`, 500);
          setQR(QUICK.details);
        } else {
          setState({ ...next, step: required });
          await botSay(`${ack}\n\n${PROMPTS[required]}`, 500);
          setQR(QUICK[required] || []);
        }
      }, 200);
      return;
    }

    if (seedTask) {
      // Pre-filled category from Home chip tap — only sets `what`.
      setTimeout(async () => {
        addMsg(`I need help with: ${seedTask}`, 'user');
        const svc = seedTask;
        setState(s => ({ ...s, what: svc, fields: 1, step: 'where' }));
        await botSay(`${svc} ✓\n\nWhere should the provider come to?`, 500);
        setQR(QUICK.where);
      }, 400);
    } else {
      await botSay(PROMPTS.what, 300);
      setQR(QUICK.what);
    }
  }, [addMsg, botSay]);

  // send user message
  const send = useCallback(async (text) => {
    const skip = /^skip/i.test(text.trim());
    addMsg(text, 'user');
    setQR([]);

    const step = state.step;

    if (step === 'what') {
      const svc    = parseService(text) || text.trim();
      const when   = parseWhen(text);
      const budget = parseBudget(text);
      const where  = parseWhere(text);

      const next = { ...state, what: svc, fields: 1 };
      if (when)   { next.when   = when;   next.fields = Math.max(next.fields, 2); }
      if (budget) { next.budget = budget; }
      if (where)  { next.where  = where;  next.fields = 3; }

      setState(next);

      const ack = [
        svc    && `${svc} ✓`,
        when   && `${when} ✓`,
        budget && `Budget ${budget} ✓`,
        where  && `📍 ${where} ✓`,
      ].filter(Boolean).join(' · ');

      const required = nextRequired(next);
      if (required === 'done') {
        await botSay(`${ack}\n\nAnything else to tell the provider? (or skip)`, 600);
        setState(s => ({ ...s, step: 'details' }));
        setQR(QUICK.details);
      } else {
        await botSay(`${ack}\n\n${PROMPTS[required]}`, 600);
        setState(s => ({ ...s, step: required }));
        setQR(QUICK[required] || []);
      }
      return;
    }

    if (step === 'where') {
      const where = skip ? '' : (parseWhere(text) || text.trim());
      setState(s => ({ ...s, where, fields: Math.max(s.fields, 3), step: 'details' }));
      await botSay(`${where ? `📍 ${where} ✓\n\n` : ''}${PROMPTS.details}`, 600);
      setQR(QUICK.details);
      return;
    }

    if (step === 'details') {
      const details = skip ? '' : text.trim();
      setState(s => ({ ...s, details, step: 'done' }));
      await botSay('All set! Ready to find your best matches 🎯', 600);
      setPhase('ready');
      setQR([]);
      return;
    }
  }, [state, addMsg, botSay]);

  return { messages, state, quickReplies, phase, typing, init, send, QUICK };
}
