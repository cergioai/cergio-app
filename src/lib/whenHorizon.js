// whenHorizon.js — scheduled-vs-instant detection for the search→request flow.
//
// FROZEN_SPEC / QA gate A1:
//   • Instant (near-term: now / today / tonight / tomorrow) → "Allow up to 15
//     minutes for nearby services to confirm and reply."
//   • Scheduled (clearly beyond ~32h out) → "We'll notify you — it can take up
//     to 24 hours to locate and negotiate offers."
//
// The parsed `when` phrase is free natural language ("next friday",
// "august 5th", "on the 12th", "in two weeks", "tonight"). The prior regex only
// caught relative phrases with digits/spelled numbers, so calendar dates,
// ordinal-of-month, and weekday names fell through to the 15-minute INSTANT
// copy — a launch-critical A1 miss the nightly walk reproduced.
//
// This helper is DATE-AWARE and CONSERVATIVE. It returns true (scheduled) only
// when it can either (a) match an unambiguous far-future relative phrase, or
// (b) confidently resolve an absolute calendar date/weekday that lands >32h from
// `now`. Anything it can't confidently place in the future falls through to
// INSTANT — today's safe behavior — so a near-term job is never made to look
// slow. Because it computes the real horizon, the ~32h boundary that made the
// old code avoid weekday phrasing is now handled correctly (a "friday" that is
// less than 32h out correctly stays instant).

const SCHEDULED_HORIZON_MS = 32 * 60 * 60 * 1000; // 24h SLA + 8h window

const NUM_TOKEN =
  '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple(?:\\s+of)?|few|several)';

// Unambiguously far-future regardless of the wall clock.
const RELATIVE_SCHEDULED = new RegExp(
  '\\b(?:' +
    'next\\s+(?:week|month)' +
    '|(?:in\\s+)?' + NUM_TOKEN + '\\s+(?:days?|weeks?|months?)' +
    '|\\bmonths?\\b' +
  ')\\b',
  'i'
);

// Near-term words dominate → always instant.
const NEAR_TERM =
  /\b(?:now|right\s+now|asap|immediately|today|tonight|this\s+(?:morning|afternoon|evening)|tomorrow)\b/i;

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
  sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5,
  saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4,
  thurs: 4, fri: 5, sat: 6,
};

const MONTH_RE = Object.keys(MONTHS).join('|');
const WEEKDAY_RE = Object.keys(WEEKDAYS).join('|');

function atNoon(y, m, d) {
  // Anchor resolved calendar dates at local noon so a same-day match is a small
  // (sub-32h) horizon rather than accidentally crossing the boundary at midnight.
  return new Date(y, m, d, 12, 0, 0, 0);
}

// Resolve an absolute calendar date from the phrase, or null if none/uncertain.
function resolveAbsolute(s, now) {
  // month + day  ("august 5th", "aug 5", "on august 12")
  let m = s.match(new RegExp('\\b(' + MONTH_RE + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b'));
  // day + month  ("5th of august", "12 aug")
  if (!m) {
    const m2 = s.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MONTH_RE + ')\\b'));
    if (m2) m = [m2[0], m2[2], m2[1]];
  }
  if (m) {
    const mon = MONTHS[m[1]];
    const day = parseInt(m[2], 10);
    if (day >= 1 && day <= 31) {
      let y = now.getFullYear();
      let target = atNoon(y, mon, day);
      // If that date already passed this year, it means next year.
      if (target.getTime() < now.getTime() - SCHEDULED_HORIZON_MS) target = atNoon(y + 1, mon, day);
      return target;
    }
  }

  // ordinal-of-month ("on the 12th", "the 5th")
  const om = s.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/);
  if (om) {
    const day = parseInt(om[1], 10);
    if (day >= 1 && day <= 31) {
      let y = now.getFullYear();
      let mon = now.getMonth();
      let target = atNoon(y, mon, day);
      // Passed already this month → next month.
      if (target.getTime() < now.getTime()) {
        mon += 1;
        if (mon > 11) { mon = 0; y += 1; }
        target = atNoon(y, mon, day);
      }
      return target;
    }
  }

  // weekday name ("friday", "next friday", "this monday", "on tuesday")
  const wd = s.match(new RegExp('\\b(next\\s+|this\\s+|on\\s+)?(' + WEEKDAY_RE + ')\\b'));
  if (wd) {
    const isNext = /next/.test(wd[1] || '');
    const targetDow = WEEKDAYS[wd[2]];
    let daysAhead = (targetDow - now.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7; // same weekday name → the upcoming one
    if (isNext) daysAhead += 7;         // "next friday" → the one after this week's
    const t = new Date(now);
    t.setDate(t.getDate() + daysAhead);
    return atNoon(t.getFullYear(), t.getMonth(), t.getDate());
  }

  // "this weekend" / "the weekend" / "weekend" → upcoming Saturday
  if (/\bweekend\b/.test(s)) {
    let daysAhead = (6 - now.getDay() + 7) % 7; // Saturday = 6
    if (daysAhead === 0) daysAhead = 7;
    const t = new Date(now);
    t.setDate(t.getDate() + daysAhead);
    return atNoon(t.getFullYear(), t.getMonth(), t.getDate());
  }

  return null;
}

export function isScheduledWhen(when, now = new Date()) {
  const s = String(when || '').toLowerCase().trim();
  if (!s) return false;

  // Explicit near-term wording always means instant.
  if (NEAR_TERM.test(s)) return false;

  // Unambiguous relative far-future phrase.
  if (RELATIVE_SCHEDULED.test(s)) return true;

  // Date-aware resolution: only scheduled when confidently >32h out.
  const resolved = resolveAbsolute(s, now);
  if (resolved) return (resolved.getTime() - now.getTime()) > SCHEDULED_HORIZON_MS;

  // Couldn't confidently place it → instant (safe default).
  return false;
}

export default isScheduledWhen;
