// ─── whereGuard — "is this actually a street address the user typed?" ────────
//
// WHY THIS EXISTS (QA 2026-07-13, A1c).
//
// The 2026-07-05 CERGIO-GUARD in useChat fixed a founder-visible bug: the cloud
// parser intermittently dropped a newly-typed address, so the search silently
// reverted to the previous city ("134 Henry St, New York" → "Miami Beach"). The
// fix: if the user's message contains a street address, the typed address WINS.
//
// But its matcher was `\b\d{1,6}\s+<word>(\s+<word>){1,7}` — "a number followed
// by some words." A budget followed by a date is also a number followed by some
// words. So "deep cleaning under $200 this tuesday" captured **"200 this
// tuesday"** as the address, and — because the typed address wins — it
// OVERWROTE the user's real, persisted address (134 Henry St). Live proof:
// the /results location chip read "200 this tuesday", the address chip was gone,
// and Google returned REQUEST_DENIED for it, surfacing a raw "Setup needed /
// geocoder denied" error to the user on a completely ordinary query. A request
// whose `where` is a date phrase geocodes to nothing, so services_near matches
// nobody: the request is silently unroutable. That is the A1 flow failing.
//
// So the guard must keep its original job (an explicit typed address ALWAYS
// holds) while refusing the two things that are never addresses: a number that
// is really the BUDGET, and a number followed only by DATE/TIME words.
//
// Pure + dependency-free so qa.mjs and whereGuard.test.mjs can exercise it
// directly. Both the parse fallback and the local-capture path in useChat call
// this — there must be exactly ONE definition of "looks like an address."

// Money phrases: "$200", "under 200", "max $1,500", "up to 80 bucks", "200 usd".
// Stripped BEFORE we look for an address so a budget can never masquerade as a
// house number. Keep this first — it is the single most common false positive.
const BUDGET_RE =
  /(?:\$|\b(?:under|below|max(?:imum)?|up\s+to|budget(?:\s+of)?|around|about|approx(?:\.|imately)?)\s*\$?)\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:k\b|dollars?\b|usd\b|bucks\b)?/gi;
const TRAILING_MONEY_RE = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:dollars?|usd|bucks)\b/gi;

// Words that can follow a number in a WHEN phrase but never form an address:
// "5th of august", "200 this tuesday", "3 pm friday", "2 weeks out".
const TIME_WORDS = new Set([
  'am', 'pm', 'oclock', "o'clock",
  'today', 'tonight', 'tomorrow', 'tmrw', 'now', 'asap', 'later',
  'this', 'next', 'last', 'coming', 'upcoming', 'the', 'of', 'on', 'at', 'by', 'in', 'for',
  'mon', 'monday', 'tue', 'tues', 'tuesday', 'wed', 'weds', 'wednesday',
  'thu', 'thur', 'thurs', 'thursday', 'fri', 'friday',
  'sat', 'saturday', 'sun', 'sunday',
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may',
  'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september',
  'oct', 'october', 'nov', 'november', 'dec', 'december',
  'weekend', 'weekday', 'week', 'weeks', 'day', 'days', 'month', 'months',
  'morning', 'afternoon', 'evening', 'night', 'noon', 'midnight',
  'hour', 'hours', 'hr', 'hrs', 'min', 'mins', 'minute', 'minutes',
  'early', 'late', 'anytime', 'whenever', 'flexible',
  // quantity/haggling words that trail a number in a job description
  'dollars', 'dollar', 'usd', 'bucks', 'max', 'budget', 'people', 'guests', 'ppl',
  'bedroom', 'bedrooms', 'bed', 'beds', 'bath', 'baths', 'sqft', 'sq', 'ft', 'hrs',
]);

// A real street address usually carries a street-type token. Not required (users
// type "5701 collins miami"), but its presence is decisive proof.
const STREET_SUFFIX_RE =
  /\b(st|street|ave|av|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|ter|terrace|way|hwy|highway|pkwy|parkway|cir|circle|sq|square|apt|unit|suite|ste|fl|floor)\b/i;

/**
 * Extract a street address the user actually typed, or null.
 * Guarantees: a budget is never an address; a date/time phrase is never an
 * address; an explicit street address always wins (the 07-05 guarantee).
 */
export function extractTypedAddress(input) {
  if (!input || typeof input !== 'string') return null;

  // 1) Remove money phrases so "$200" / "under 200" can't seed a house number.
  const text = input.replace(BUDGET_RE, ' ').replace(TRAILING_MONEY_RE, ' ');

  // 2) Look for "<number> <word> ...". Same shape as the original guard, so a
  //    real address still matches exactly as it did before.
  const m = text.match(/\b\d{1,6}\s+[A-Za-z0-9.'\-]+(?:\s+[A-Za-z0-9.'\-]+){0,7}/);
  if (!m) return null;

  const candidate = m[0].replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
  // 2b) CITY TAIL (QA 2026-07-13, A1). The match above stops at the comma, so
  //     "134 Henry St, New York" was captured as "134 Henry St" — a street with
  //     no city. Google geocodes a bare street against its own bias, so the
  //     request can silently land in the WRONG CITY: the same user-visible bug
  //     (the address reverted) by a different route. So: re-attach a comma tail
  //     when it reads as a PLACE and nothing else. Deliberately narrow —
  //       · 1–3 words, letters only (a city/state/borough, never a sentence)
  //       · no time word ("134 Henry St, this tuesday" → tail dropped)
  //       · no gerund ("134 Henry St, cleaning" → tail dropped; that's the job)
  //     Anything outside that shape leaves the street exactly as it was.
  const cityTail = (() => {
    const rest = text.slice(m.index + m[0].length);
    const t = rest.match(/^\s*,\s*([A-Za-z][A-Za-z.'\- ]*)/);
    if (!t) return '';
    const tail = t[1].trim().replace(/[.,;:!?]+$/, '');
    const parts = tail.split(/\s+/).filter(Boolean);
    const n = (w) => w.toLowerCase().replace(/[^a-z']/g, '');
    // Drop a trailing WHEN that rode in behind the city:
    // "…, miami beach tomorrow" → "miami beach".
    while (parts.length && TIME_WORDS.has(n(parts[parts.length - 1]))) parts.pop();
    if (!parts.length || parts.length > 3) return '';
    const bad = parts.some((w) => !n(w) || TIME_WORDS.has(n(w)) || /ing$/.test(n(w)));
    return bad ? '' : parts.join(' ');
  })();
  const tokens = candidate.split(' ');
  const words = tokens.slice(1); // everything after the leading number
  if (!words.length) return null;

  const norm = (w) => w.toLowerCase().replace(/[^a-z']/g, '');

  // 3) The candidate must carry at least one word that is NOT a date/time/
  //    quantity word — UNLESS it has a street suffix, which is decisive.
  //    "200 this tuesday" → ["this","tuesday"] → all time words → NOT an
  //    address. "5701 collins miami" → ["collins","miami"] → address.
  const hasStreetSuffix = STREET_SUFFIX_RE.test(candidate);
  const hasRealWord = words.some((w) => {
    const t = norm(w);
    return t.length > 1 && !TIME_WORDS.has(t);
  });
  if (!hasStreetSuffix && !hasRealWord) return null;

  // 4) Trim any trailing date/time tail so "134 Henry St this tuesday" geocodes
  //    the STREET and not the weekday. (Runs on the street-suffix path too —
  //    that was the whole point of the tail: it is never part of the address.)
  while (tokens.length > 2 && TIME_WORDS.has(norm(tokens[tokens.length - 1]))) {
    tokens.pop();
  }
  const street = tokens.join(' ').replace(/[.,;:!?]+$/, '').trim();
  if (!street) return null;
  return cityTail ? `${street}, ${cityTail}` : street;
}

// ─── hasTimeSignal — "does this string say anything about WHEN?" ─────────────
//
// WHY (QA 2026-07-13, A1i). Live repro on v680457c: at the "When do you need
// this?" step the user answered with an ADDRESS ("134 Henry St, New York") —
// the natural move when the app pre-filled the wrong saved address and never
// asked WHERE. The cloud parser echoed the reply straight back as `when`, so
// /results rendered a street address as the TIME pill and the request was
// written with a street address as its schedule. The address-capture guard had
// already (correctly) routed the same text to `where`; nothing was watching the
// other side of the leak.
//
// Only used to REFUSE a `when` that is really an address, so it is deliberately
// permissive: any digit-time ("2pm", "6/20", "at 3"), any TIME_WORD, or any
// bare weekday/month token counts as a time signal and the `when` is kept.
const CLOCK_RE = /\d\s*(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*\/\s*\d{1,2}\b/i;

export function hasTimeSignal(input) {
  if (!input || typeof input !== 'string') return false;
  if (CLOCK_RE.test(input)) return true;
  return input
    .toLowerCase()
    .split(/[^a-z']+/)
    .some((w) => w.length > 1 && TIME_WORDS.has(w));
}

/**
 * True when a value offered as the WHEN is really the user's ADDRESS.
 * Conservative by construction: it must read as a typed street address AND
 * carry no time signal at all. "134 Henry St, New York" → true.
 * "134 Henry St tomorrow 2pm" → false (it says when; keep it).
 */
export function isAddressNotATime(input) {
  if (!input || typeof input !== 'string') return false;
  if (hasTimeSignal(input)) return false;
  return extractTypedAddress(input) !== null;
}

export default extractTypedAddress;
